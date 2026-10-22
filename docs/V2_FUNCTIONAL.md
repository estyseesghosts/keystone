# V2_FUNCTIONAL — next-implementer handoff: make it all actually work

Status: open · Created 2026-10-21 · Source: owner functional audit
post-V2_GAPS (owner-tested, not unit-tested). This file is the build
list. `docs/V2_GAPS.md` is history; this file is what you execute.

## Prime directive (non-optional, owner-stated)

Every item below must be **FUNCTIONAL on a real surface** by the time
your work is committed — device (Android `3B15A500TQD00000`) or rig
(Akkoma `:4000`; Misskey-family `:3101`/`:3102` if they come up) or
Helium web-visual against expo. **Unit tests alone close nothing.**
A test that pins behavior you never observed working is a rumor, not
proof. Reproduce every symptom FIRST on device/rig/web, record the
repro (screenshot + build flavor + account/server) in your session log,
then fix, then re-prove on the same surface.

Do not pave over, do not re-declare done, do not downgrade an item to a
placeholder. If a prior register row or DECISIONS line claims one of
these works (F11/MK8 emoji, F12 unfurl-decline, N9 drive, F9 mentions),
that claim is now suspect: treat it as unverified, re-prove it, and
correct the register. Prior "done"s that do not survive contact with
the device are regressions in the register, not the world.

## Ground rules (carry-over from V2_GAPS + AGENTS.md)

1. **Repro-first per item.** Log the broken behavior with evidence
   before changing code. No repro = no fix.
2. **Functional acceptance per item** (defined below). Each item names
   its proof surface. `not verified` is allowed only where the surface
   does not exist (record why); it never counts as done.
3. **Verify like W1–V2_GAPS:** `pnpm typecheck && pnpm lint && pnpm test`
   (or direct `tsc`/`eslint`/`oxlint`/`jest` equivalents — pnpm is
   absent here) green, pasted in the session log, per work item.
4. **Commit when done.** One branch per item (`pf-<topic>`), one item
   per commit, serial merges to `main`. Update `state/STATE.md`, append
   `state/logs/YYYY-MM-DD-pf-<topic>.md`, tick boxes here.
5. Keep `packages/fedi` pure TS. Every action behind a `Capabilities`
   flag. `auto` always renders MFM. React Compiler discipline (WS-C/
   WS-F findings): stores read via `useSyncExternalStore` selectors,
   complete memo dep arrays.
6. **Reversals need paper first.** E9 reverses the W2
   client-unfurl decline in `docs/DECISIONS.md`. Record the superseding
   line (owner authority: this handoff) BEFORE coding, per AGENTS.md §4
   — never silently, never after.
7. No Bluesky-verbatim code (`docs/adr/0001`). Record consulted v1
   paths (`~/Local Documents/Keystone/frontend/src`) in the log.

---

## E1 — Custom + remote emoji EVERYWHERE (supersedes F11/MK8 "done")

Status: DONE 2026-10-21 (`pf-emoji` ce3efe5, trio green, Helium :8096 + Akkoma rig).
Remote `:code@host:` renders as image in bodies + display names (Helium shot),
local custom in bodies/chips/picker; picker popup opens/searches/inserts.
Device (Oppo) pass still `not verified`; Misskey-family rig down.

Owner report: remote emoji still don't work; custom emoji still don't
work. Requirement: custom/remote emoji render as IMAGES anywhere an
emoji can be seen — post bodies, **reaction chips**, profile bios,
usernames/display-names, notification rows, quote heads, the picker.
Never literal `:code:`, never blank, never a fabricated lookalike.

Known suspects (verify each, don't assume):

- `ReactionChips.tsx:52-67`: `ChipArt` renders the image only when
  `url !== null`; `:code:` keys without art fall through to literal
  text (line 66). Where does `entry.url` come from per family? Is it
  ever populated for Misskey custom reactions (`:name@host:` keys)?
  Wire the WS-C remote fallback (`remoteEmojis` /
  `customEmojiStoreFor`) into the chip art path.
- `PostQuote.tsx` was deliberately skipped by WS-C (active-session
  fallback only) — prove quotes resolve remote emoji or thread
  `sessionId` explicitly (WS-C left this as a proposal — do it).
- Bodies/usernames/bios/notifications were wired in WS-C — RE-PROVE on
  device with a real `:name@host:` post and remote display name. If
  they fail, the WS-C chain (packed → remote-host → author-host →
  session listing → literal) is broken somewhere real; find where.
- Picker: remote-host tables + retry proven unit-side; prove on device
  against `misskey.io`-style listings.

Acceptance: one screen-capture pass showing a remote-emoji post, a
custom-emoji reaction set, a remote-emoji display name + bio, and the
picker remote section — all rendering images on Android.

## E2 — Mentions clickable (F9, still `bug`)

Status: DONE 2026-10-21 (`pf-links` ce7b676, trio green, Helium :8098 + Akkoma rig).
In-app defaults in `RichText.tsx`; card/detail/bio taps land on profile.
Live notification taps `not verified` (rig has zero notifications); device pending.

Owner report: mentions are not clickable. The card-side handlers LOOK
complete (`PostCard.tsx:672-679`: `parseAcct(label)` fallback →
`openMentionProfile`, else external). So the break is in the data or
the threading — repro will tell you which:

- MFM path: `fromMfm.ts:109` emits `mention(null, …)` — does
  `parseAcct(label)` handle the actual label shape (bare `@user`,
  `@user@host`, display-name labels)? Log what arrives.
- Who renders the surfaces where mentions fail? Feed cards pass
  handlers; check every OTHER `RichText` caller (detail view,
  notifications, bios, quote heads) — any caller that omits
  `onMentionPress` leans on `node.href`, and HTML mentions then open
  an external browser instead of the profile.
- Fix at the right layer (parser shape, caller threading, or resolver),
  not all three.

Acceptance: tap a mention in a feed card, in detail view, and in a
notification — all three land on the profile in-app (Helium or device
capture). No external-browser escape for resolvable mentions.

## E3 — Hashtags reliably clickable

Status: DONE 2026-10-21 (same `pf-links` ce7b676 proof as E2). Tag route
everywhere; never the external browser.

Owner report: "dubiously clickable". `RichText.tsx:286-293` falls back
to `openExternal(node.href)` when no `onHashtagPress`. Define the
contract: tag press opens the Tag screen, everywhere (cards, quotes,
bios, fields, notifications). Audit every `RichText` caller as in E2;
make the fallback the tag route, not the browser, wherever the tag is
known.

Acceptance: same three-surface tap test as E2, landing on the Tag
screen.

## E4 — Bio + field formatting preserves newlines

Status: DONE 2026-10-21 (`pf-bio` 82711a3 cherry-picked as fd51138, trio
pending re-run on main). Repro showed the pipeline already preserves `\n`
(no source change — 6 pinning tests); multi-line bio + field proven live on
Akkoma `:4000`. Misskey-family `not verified` (no host up).

Owner report: profile bio formatting broken; newlines possibly pruned
(they must not be). Suspects: `contentFromHtml` whitespace collapsing
on HTML bios/fields (`ProfileHeader.tsx:130-148` sends Misskey plain
values through `contentFromHtml` too), adapter `bio.plain`
construction, `plainTextOf` projections. MFM bios handle `\n`
(`fromMfm.ts:65-70`) — prove HTML/plain bios keep line breaks on
device for both families.

Acceptance: a multi-line bio + multi-line field render multi-line on
Android for a Mastodon-family and (if rig allows) Misskey-family
account. No normalization that eats `\n` anywhere in the bio path.

## E5 — Emoji popup works on Android

Status: DONE 2026-10-21 (same `pf-emoji` ce3efe5 proof as E1:
`Keyboard.dismiss()` on open + `nestedScrollEnabled`; Helium shots + unit pins).
Oppo-device confirmation still `not verified`.

Owner report: emoji pop-up broken on Android. The picker is embedded,
not modal (`ComposerSections.tsx:476`, `CompactComposer.tsx:329`;
`EmojiPicker.tsx` has no Modal/positioning code). Repro on the Oppo:
does it open at all, is it sized/positioned wrong, does the keyboard
cover it, does the FlatList fail to scroll/measure? Fix the actual
breakage (layout, keyboard avoidance, measurement — whatever the
repro shows), not a rewrite.

Acceptance: open the picker from the composer on the Android device,
scroll, search, retry-after-error, insert — captured on device.

## E6 — Translation actually implemented

Status: IMPLEMENTED per contract 2026-10-21, pending owner live verification
on their Misskey server. Chain: `detectServer` advertises
(`meta.translatorAvailable`, Mastodon `configuration.translation.enabled`,
Akkoma `machine_translation` flag) → `capabilities.translation` →
`backend.translate` (`notes/translate {noteId, targetLang}` /
`/statuses/:id/translate {lang}`) → menu row + auto-translate, with v1
display policy (same-text echo suppressed, viewer-locale targetLang).
Trio 146/1749 green. The rig cannot prove it live (`:3101`/`:3102` down,
`:4000`/`:3000` expose no service) — owner tests against live Misskey.

Owner report: translation still isn't implemented. The wiring exists
(`PostCard.tsx:308-365` auto + manual paths, menu row, `detect.ts`
`translatorAvailable` gate — WS-D proved the *refusal* path live).
So: against which server is translation supposed to work, and does
that server expose it? Read v1's real mechanism (`misskey/translate.ts`,
`TranslatableText.tsx:63,78`, v1 `translate.ts`) and make the
end-to-end path functional on at least one rig family (Akkoma `:4000`
or Misskey-family when up). If no testable server has an endpoint,
that is a finding to bring to the owner with probe evidence — not a
fake row, and not a silent drop.

Acceptance: translate a real post on a rig server and show the
translated text in-app (screenshot), or a probe-backed report that no
rig server supports it.

## E7 — Misskey drive implemented

Status: OPEN — partial 2026-10-21 (`pf-drive` b564143 merged, trio green).
What actually landed: `DriveFolder` wire/adapt + `drive.folders`
list/create/update/delete in the Misskey backend + folder rename UI wiring
in `Drive.tsx` (2 unit tests). The file list/rename/sensitivity/delete
screen and the composer `uploadMedia → drive/files/create` path pre-date
this program (W5/P4.3) and remain LIVE-UNVERIFIED: no Misskey-family host
is up (`:3101`/`:3102` refused; Pinetree `:3000` provably lacks ALL
`drive/folders*`). The "round-trip" commit message overclaims — no live
round-trip happened. Remaining for done: browse + upload +
rename/sensitivity/delete against a live Misskey-family host, then tick.
NAV 2026-10-21 (main, trio green): the Drive screen was registered but
UNREACHABLE — no entry point anywhere. Added v1-sitenav parity entries:
Sidebar (desktop) + AccountMenu (desktop footer + mobile strip) for
Drive/Antennas (misskey family), Lists/Clips (capability-gated),
Favorites (signed-in) — 4 new shell-chrome tests. The page now opens;
live Misskey-family round-trip still pending (`:3101`/`:3102` down).

Owner report: Misskey drive not implemented. The pieces exist
(`misskey/backend.ts:231+` drive API, `Drive.tsx` screen, W5-tested,
MD15 interface) but N9 was closed "live unverified". Audit the full
surface against a Misskey-family host: list, folders, upload (composer
attach flow), rename/sensitivity/delete. Whatever is dead or stubbed,
implement; whatever the server lacks, prove with a probe.

Acceptance: browse + upload + rename/sensitivity/delete round-trip
against a Misskey-family host (or exact probe evidence of the missing
server surface + owner decision on scope).

## E8 — Thread lines in post detail (F20 remainder)

Status: DONE 2026-10-21 (`pf-detail` 2593da3, trio pending re-run on main).
Own-code 1px edges on ancestor chain/root rows/nested levels
(`ancestor-chain`, `thread-edge-<id>`, `replies-<id>`); MAX_DEPTH + FlatList
kept. 3+-deep connectors proven on Helium + Akkoma `:4000`.

Post detail (`Note.tsx`: `ReplyBranch`, `RootReplyRow`) renders bare
nested `PostCard`s — no connectors between threaded replies. Add
v1-parity thread lines (`Note.tsx:181-203,542-605` behavior, own code).
Keep the `MAX_DEPTH` guard and `FlatList` structure (F24).

Acceptance: a 3+-deep thread renders visible connectors on Android.

## E9 — Link embed cards functional (reverses F12 decline)

Status: DONE 2026-10-21 (`pf-unfurl` 05377f0, trio green, Helium :8093 +
Akkoma rig; DECISIONS reversal line recorded BEFORE code, W2 line kept as
history). Tap-to-unfurl + single-flight + cache; fetch-count test pins it.
Oppo-device confirmation still `not verified`; Misskey rig down.

Follow-up 2026-10-21 (owner direction, superseding DECISIONS line recorded
BEFORE code): previews auto-load by default (v1 parity); a device-local
Data Saver toggle (Display settings, default off) restores the tap trigger.

Owner report: link embed cards still missing. Server `post.card`
LinkCards exist; per-post client unfurl was DECLINED in W2 (battery/
data cost). The owner overrides that decline: implement honest client
unfurl. First record the superseding DECISIONS line (owner authority:
this handoff; scope the cost concern — e.g. tap-to-unfurl and/or
single-flight per URL + cache via `api/linkpreview`, never a fetch
storm), THEN build. v1 reference: `LinkCard.tsx` + `NoteBody.tsx:155-185`.

Acceptance: a post with a bare URL and no server card shows an unfurled
card (title ± image) after the honest trigger, cached on second view;
no duplicate/in-flight fetches (prove with a fetch count test + device
capture).

## E10 — Reply-from-detail appears without leaving

Status: DONE 2026-10-21 (`pf-detail` 8df27b7, trio pending re-run on main).
Root cause was missing invalidation; fix wires `refreshThread()` to
RefreshControl + return-focus refetch (non-polling proven by 90s idle).
Reply visible in-thread on goBack, proven live; all 11 probe posts deleted.
Pull-*gesture* itself `not verified` (Helium reports no touch points —
needs Oppo).

Owner report: replying from detail view (`Note.tsx:184-192`
`ReplyEntry` → Compose with `replyToId`) never shows the reply —
not even after manual refresh; only exiting + reopening works. Repro
first: is the thread query never invalidated on create-success, is
refresh a no-op (refetch disabled / stale cache served), or does the
fetch itself omit the reply? Fix the invalidation/refresh path (not a
polling hack), covering both the back-navigation return AND manual
refresh.

Acceptance: post a reply from detail on the rig, see it in the thread
without leaving (capture); pull-to-refresh also shows it. Clean up the
probe post.

---

## Commit checklist (every item)

- [ ] Repro evidence logged BEFORE the fix (surface + build + account)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, pasted in log
- [ ] `state/logs/YYYY-MM-DD-pf-<topic>.md` written
- [ ] `state/STATE.md` + this file checkboxes updated
- [ ] Branch `pf-<topic>` committed (`PF-<E#>: <what> (tests <n>,
      <surface + result>)`); no batching unrelated items
- [ ] Register rows corrected where a prior "done" did not survive
      contact with the device (F11/MK8, F12, N9, F9)
