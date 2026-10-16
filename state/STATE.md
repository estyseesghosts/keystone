# STATE — resume pointer (mutable, keep current)

**HEAD:** `9bd393b` (pushed 2026-10-16) — docs refresh (README, router
×17 routes, plan). Prior: `740abde` stacked slices. Tree clean at push;
browser QA pending throughout (owner).

**Phase:** 4 — Visual polish (2026-10-16): sidebar icons + collapsible nav,
system-theme dark mode (owner override of the AGENTS.md §7 no-dark-mode
guard), composer card, button polish. See log `2026-10-16-polish.md`.
Visual browser QA pending (owner rig).
**Backends:** Misskey `2026.10.1-alpha.0` @ `127.0.0.1:3101`
(`KEYSTONE_BACKEND_ONLY=1`, web UI disabled, API verified) ·
Sharkey `2025.4.7` @ `127.0.0.1:3102` (same mode) ·
Pinetree default @ `127.0.0.1:3000`
**Frontends:** Keystone misskey-mode `:5176`, sharkey-mode `:5177`
(Vite `--mode misskey` / `--mode sharkey`); Pinetree-mode `:5173`
**Last session:** 2026-10-16 roadmap — all `docs/keystone_roadmap.md`
Keystone-side work landed (see log `2026-10-16-roadmap.md`); suites green
**This session (2026-10-16, implementer):** THREE items in order — (1) push
unpushed commits, (2) streaming client Stage A vs Misskey/Sharkey, (3) flip
on pinetree-mode capabilities as the server lands them. Human browser QA is
owner-handled, NOT this session; browser behavior stays "not yet verified".
**Then (2026-10-16, external-auth):** Slice 8 built (see log
`2026-10-16-external-auth.md`): Keystone as an external MiAuth client
(redirect on the host instance) + account card/menu + `/settings` +
external login tab. Internal flow pinned via `apiCallInternal`; suites NOT
re-run here (backend DB layer down) — re-verify on the test machine.
**Plus (2026-10-16, public-sharkey):** brought up on macOS with no local
backend (see log `2026-10-16-public-sharkey.md`): `npm run dev` on `:5173`
serves 200, `npm run build` green, public Sharkey `dvd.chat` (`2025.4.7`)
verified live (meta 200, miauth page 200, CORS `*`). Docs-only changes
(README quickstart, `docs/setup.md` §7); no code changes. Browser
approve-and-return round-trip still **not yet verified** (owner).
- 2026-10-16 (media-strip): 2+ images/videos render as a horizontal
  snap-scroll strip; a lone image/video keeps fit-to-width and never
  scrolls (see log `2026-10-16-media-strip.md`). Build green; visual
  browser QA **not yet verified** (owner).
- 2026-10-16 (drive-groups): Drive grouped into Images/Videos/Audio/Files;
  mosaic tiles for images/video (+inline preview), miniplayer audio rows
  with tags/duration when available (see log
  `2026-10-16-drive-groups.md`). tsc + build green; visual browser QA
  **not yet verified** (owner).
- 2026-10-16 (drive-cats): Drive landing is three category boxes + loose
  files below; categories page server-side; infinite-scroll sentinel
  replaces "Load older" in Drive; static skeletons for every data load
  (see log `2026-10-16-drive-cats-skeletons.md`). tsc + build green;
  visual browser QA **not yet verified** (owner).
- 2026-10-16 (mention-at): mentions rendered `@@user` because mfm-js
  already packs the leading `@` into `acct`; renderer now uses it
  verbatim (see log `2026-10-16-mention-at.md`). tsc + build green.
- 2026-10-16 (embed-cards): pasted URLs unfurl below the note text —
  profile URLs become rich profile cards (avatar/bio/counts/follow),
  first other URL becomes a link card via client-side OpenGraph fetch
  (direct, then proxy, then basic domain card). `url-preview` verified
  absent on Sharkey; Pinetree endpoint noted as the later workstream
  (see log `2026-10-16-embed-cards.md`). tsc + build green; visual
  browser QA **not yet verified** (owner).
- 2026-10-16 (profile-universal): profile cards resolve every software —
  `users/show`, then CORS-open Mastodon lookup, then an honest basic
  chip; 12s timeout so no stuck skeletons (see log
  `2026-10-16-profile-universal.md`). tsc + build green; the `@jm` post
  should now show a full card — browser confirmation **not yet verified**
  (owner).
- 2026-10-16 (profile-ref-prop): the chip's reason string exposed the
  real bug — `ref` is a compiler-reserved component prop, so the loader
  received a generated method instead of the profile object. Renamed to
  `profile`; pitfall recorded in `solidjs.md` §7 (see log
  `2026-10-16-profile-ref-prop.md`). tsc + build green; `@jm` card
  confirmation **not yet verified** (owner).
- **Next (handoff landed, browser QA owner-handled):** `docs/quote-polish-translate-handoff.md`
  quote-post visual parity + auto translation implemented (see log
  `2026-10-16-quote-polish-translate.md`): 16px quote cards with
  avatar/head/timestamp + 4-line clamp + flush quoted media, and
  `notes/translate` auto-translation (`translatorAvailable` flag, shape +
  targetLang sweep verified live on dvd.chat). `tsc` + build green; visual
  + toggle + logged-out + no-endpoint confirmation **not yet verified**
  (owner live-testing on dvd.chat).
- 2026-10-16 (translate-scope): token-scope refinement (see log
  `2026-10-16-translate-scope.md`) — no request without mfm-derived prose
  (mentions/hashtags/URLs/links/emoji never count), identical-output
  suppression (live German-misdetect case), distrusted-detection override
  with generic label (Ukrainian-labeled-English path), 90s failure TTL.
  Server-side hashtag/link-label translation + short-input hallucination
  observed live (dvd.chat translator is not DeepL) and recorded, not
  client-fixable. 39/39 policy checks, `tsc` + build green; browser QA
  **not yet verified** (owner).
- **Next (implemented 2026-10-16, browser QA owner-handled):**
  `docs/tag-bubbles-fold-scroll-handoff.md` — tag-block prune + `(#tag
  +N)` header bubble + popup over the PRUNED tags only (lone hashtags
  stay inline, unchippped, out of the bubble), monochrome inline chips
  for mentions/links only, 750-char timeline fold (links/mentions
  uncounted, hashtags counted, `Open post` link, detail unfolded),
  infinite scroll on all four paged sites (shared 800px sentinel; Drive
  keeps its own), CW translation probed once on dvd.chat (body-only
  result, no CW/separator → deferred, no code). Functionality only —
  no Beeline visuals. See log `2026-10-16-tag-bubbles-fold-scroll.md`:
  `tsc` + build green, 41/41 unit checks; browser QA **not yet verified**
  (owner live-testing on dvd.chat).
- **Plus (2026-10-16, committed `cb3b2b0`):** leading-`RE:` triple fix
  (`RE_PREFIX_PATTERN` + per-marker suppression + LinkCard dedupe, 45/45
  checks; residual id-scheme mismatch noted) and mention chips showing
  resolved avatar + display name. Local-backend probe not run here (no
  backends on this machine); owner live-tests both on dvd.chat. See log
  `2026-10-16-re-quote-prefix.md`.
- **Next (implemented 2026-10-16, PUSHED `bad20a2`, browser/live-API QA
  owner-handled):** `docs/replies.md` Slices A–C — ancestor chain via
  `notes/conversation` (oldest-first Thread section, incomplete marker,
  404 fallback to packed parent), per-branch `ReplyList`/`ReplyBranch`
  (`notes/replies` newest-first paged to exhaustion so an opened post
  shows every reply; lazy Show/Hide; per-branch error/cursor/dedupe;
  cycle + depth-32 guards), posted replies prepend via `injected`
  without refetch, route-param-driven reload with generation guard.
  `src/api/thread.ts` 19/19 checks, `tsc` + build green; API suites NOT
  re-run here (no backends on this machine). See log
  `2026-10-16-replies.md`.
- **Plus (2026-10-16, PUSHED `bad20a2`):** click-to-open posts (`NoteCard`
  body navigates to `/notes/:id` with link/button/media/selection
  guards, pointer cursor; detail route excluded) + avatar-column thread
  connectors on the ancestor chain and root replies (nested levels keep
  the indented edge connector). `tsc` + build green; browser click +
  connector visuals **not yet verified** (owner). See log
  `2026-10-16-click-open.md`.
- **Plus (2026-10-16, PUSHED `54f1304`):** composer refresh — detail-view
  self-link highlight fixed (time/reply-count render as spans there),
  avatar-led composer with audience pill (`Public`/`Unlisted`/`Followers
  only`/`Direct`), icon toolbar (media, poll, emoji insert-at-caret, CW;
  scheduling disabled with reason — no endpoint in the verified
  contract), compact→expanded reply row on detail. `tsc` + build green;
  browser QA **not yet verified** (owner). See log
  `2026-10-16-composer.md`.
- **Plus (2026-10-16, PUSHED `2c1ba76` + `c3862ff`):** composer round 2
  — borderless cohesive surface, custom floating audience popup, Local
  switch, floating composer with per-backend drafts + rail entry. `tsc`
  + build green, 8/8 drafts checks; browser QA **not yet verified**
  (owner). See log `2026-10-16-composer-v2.md`.
- **Plus (docs 2026-10-16):** README + router + plan refreshed to the
  tree (all 17 routes, appearance, streaming, external auth). See log
  `2026-10-16-docs-refresh.md`.
- **Next (implemented 2026-10-16, uncommitted, browser QA owner-handled):**
  RESPONSIVE rail sidebar (competitor behavior, Keystone look) — toggle
  deleted, icon rail driven by viewport width (721–1000px band), rail
  menu as measured fixed flyout, resize/scroll dismiss. `tsc` + build
  green. See log `2026-10-16-rail-sidebar.md`.
- **Next (implemented 2026-10-16, uncommitted, browser QA owner-handled):**
  NO viewport horizontal scroll (`overflow-x: clip` backstop + wrap/
  shrink pass on rows) + avatar-only sidebar footer (card gone, same
  32px avatar everywhere, menu untouched). `tsc` + build green. See
  log `2026-10-16-no-hscroll-avatar.md`.
- **Next (implemented 2026-10-16, uncommitted, browser QA owner-handled):**
  ADAPTIVE layout for text size — em-based spacing everywhere text
  breathes (1x pixel-identical), adaptive sidebar width (fit-to-label
  + cap + internal scroll, menu bleed capped), exact collapsed/expanded
  button-height parity (`min-height: 2.51em`), mobile bar scroll.
  `tsc` + build green. See log `2026-10-16-adaptive-layout.md`.
- **Next (implemented 2026-10-16, uncommitted, browser QA owner-handled):**
  GLOBAL text scaling (owner correction: prose-only was wrong) — all 68
  `font-size` declarations now multiply by `--text-scale`, layout fixed.
  `tsc` + build green. See log `2026-10-16-text-scale-global.md`.
- **Next (implemented 2026-10-16, uncommitted, browser QA owner-handled):**
  settings as pages (competitor-style index list → `/settings/account`
  session info + sign out, `/settings/display` appearance) — profile
  editor removed from client settings entirely (lives only on your own
  profile page). `tsc` + build green. See log
  `2026-10-16-settings-pages.md`.
- **Next (implemented 2026-10-16, uncommitted, browser QA owner-handled):**
  real `/settings` Appearance section — explicit colour mode
  (light/dark/follow-system, persisted, `data-theme` override of the
  system media query) + prose text size 50–400% (`--text-scale` on note
  bodies/bios/composer only, chrome untouched). Owner request overrides
  the AGENTS.md §7 no-toggle guard (explicit ask). `tsc` + build green,
  26/26 helper checks. See log `2026-10-16-settings-appearance.md`.
- **Next (handoff written, IMPLEMENTED 2026-10-16, uncommitted, browser/live-API QA
  owner-handled):** `docs/profile-handoff.md` — banner header + big
  overlapping avatar, clickable follow counters → list sub-routes, bio via
  `MfmRenderer`, Misskey-1:1 tabs (Featured SHIPPED ABSENT — no pinned
  source confirmed, never faked; Posts/All server-exact; Media
  client-filtered). `tsc` + build green; suites NOT re-run here (no
  backends on this machine). See log `2026-10-16-profile-tabs.md`.
- **Plus (2026-10-16, uncommitted, browser QA owner-handled):** emoji
  picker + favourites + custom like (see log
  `2026-10-16-emoji-picker.md`): shared floating `EmojiPickerButton`
  (reactions + composer), hosted Custom categories via public
  `POST /api/emojis` (verified live on dvd.chat; 404 → omitted on
  Pinetree), device-local favourites/recents/like-emoji, picker-cell
  right-click menu (vispick-styled), like sends the chosen emoji with
  a reduced-motion-guarded pop, `/settings/reactions` page. `tsc` +
  build green, 37/37 helper checks; API suites NOT re-run here.
- **Plus (2026-10-16, uncommitted, browser QA owner-handled):** emoji
  load fix + render everywhere (see log
  `2026-10-16-emoji-render.md`): `emojis` fetch via `apiCall`
  (fixes "Could not load custom emoji" with external accounts; `i`
  tolerance proven live) + hosted images in MFM text, display names
  (11 sites), CWs, poll choices, hover/unfurl bios. 42/42 helper
  checks, `tsc` + build green.
- **Plus (2026-10-16, uncommitted, browser QA owner-handled):** packed
  emoji maps (see log `2026-10-16-emoji-packed.md`) — the real cause
  of literal rendering was `:name@host:` reaction keys (live-verified
  the common case) with no resolver; per-object `reactionEmojis` /
  `emojis` maps now feed chips/like/text/names (listing as fallback),
  listing eager-loads at startup and is keyed per target. 59/59
  helper checks, `tsc` + build green.

## Decisions since stonekey

- One-step Misskey-family sign-in: the redundant Keystone grant screen is
  gone (first-party client, fixed least-privilege set — the password is the
  consent). Native `signin-flow` token documented as full-authority +
  memory-only (verified in `SigninService.ts`: `user.token` verbatim).
- Scoped permission set widened least-privilege-first: + `read:drive`,
  `write:drive`, `write:account`, `write:votes`, `read:following`,
  `write:notifications`. Pre-scope sessions 403 → UI shows re-sign-in hint.
- New routes: `/drive`, `/antennas`, `/antennas/:id`, `/search` (nav gated
  on signed-in where auth is required).
- Reactions: server normalizes ❤️→❤ (verified live); client sends ❤ so
  optimistic state matches reconciled state.
- Emoji prefs (favourites, recents, like emoji): device-local
  `keystone_emoji_*` localStorage for now; per-account storage arrives
  with the Pinetree server work. The configured like emoji never
  appears in the chips row (like-only, like hearts). Picker right-click
  menu is cells-only.
- Credential-packed fields (`myReaction`, `poll`/`isVoted`, `files` on
  non-public notes): always assert/read authenticated.
- Pinetree gaps (verified 404/reject, UI degrades honestly): no
  `drive/files` listing, no antennas endpoints, polls rejected. Pinetree
  *server* implementation (Drive listing contract, antenna storage +
  matching) is a separate-repo Rust project — explicitly out of this
  session, recorded as the next workstream.
- Streaming: deliberately unused; every feed has refresh + cursor paging.

## Decisions since init

- Targets are Misskey + Sharkey (backend-only) with Pinetree default kept;
  `docs/api-surface.md` is the authoritative endpoint matrix (supersedes
  `keystone.md` §§7–8 unsupported list for these backends).
- Auth is Keystone-owned: no redirect to instance `/miauth/*` pages, ever.
  Misskey-family login = `signin-flow` → Keystone permission screen →
  `miauth/gen-token` + check → scoped app token (temp native credential never
  stored). Doc correction: native route is `/api/signin-flow`, not `/api/signin`.
- Cross-backend params limited to `{limit, sinceId, untilId}` (+ ids/text);
  never Misskey-only `include*Renotes`; `i/notifications` has no `isRead`.
- Palette: black/white/grey only, no accent colors (owner; `keystone.md` §2
  pine-green brief superseded).
- Feeds: Home + Local + Global (global exists on both servers);
  profile notes via `users/notes`; replies via `notes/replies` (labeled partial).

## Current task

(1) Push: after `git fetch`, `origin/main..HEAD` = 0 commits — the 7 roadmap
commits are already on origin/main (pushed; STATE pointer was stale).
Re-verified: build green, flows 44/44, writes 14/14, streaming 27/27.
(2) DONE + pushed (`bf91cf4` client, `c5933d4` suite, Slice 7): streaming
Stage A vs Misskey/Sharkey, all suites green (flows 44/44, writes 14/14,
features 47/47, streaming 27/27; build green). Next streaming work is
Stage B vs pinetree when its /streaming lands.
(3) Pinetree enablement CHECKED 2026-10-16: only `notes/global-timeline`
is newly frozen+live (already enabled in Keystone, verified 200 + Note[]
via :5173). drive/files, antennas, users/notes, notes/replies,
followers, search, /streaming all still 404 on the running binary —
implementer's Phase 3 uncommitted/in-flight. No flips.
Previously scoped next: human browser QA pass (owner-handled).
- 2026-10-16: README rewritten (human-useful: features, quickstart, backend
  differences, layout, verification); `npm run build` green; pushed as
  `9b0ff36`.
- 2026-10-16 (renote/quote): pure reposts render retweet-style + renote menu
  (Repost/Quote, Undo repost/Quote) + inline quote composer; build green,
  probe 15/15 both servers, writes 14/14 + features 47/47 green; flows has 4
  pre-existing backend-UI-flag failures (see log). Uncommitted.
- 2026-10-16 (quote-posts): `docs/quote-posts.md` implemented Keystone-side
  (`src/api/quote.ts` normalizer + `RE:` fallback via authed `ap/show`,
  `NoteBody` single quote path, duplicate "Renoted" card removed, status
  labels display-only); `tsc` clean, build green, 64/64 unit checks, live
  `ap/show` + quote-shape probe both servers; browser QA + Pinetree-field
  verification owned by pinetree implementer (see log
  `2026-10-16-quote-posts.md`). Committed + pushed with the fixes below.
- 2026-10-16 (quote-fixes): inline quote composer keyed by acted-on feed
  item (was target id — opened under every copy); Post-button contrast
  restored in the composer toolbar (dedicated `.btn-primary` rules beat
  the toolbar fill in all states); tsc + build green; committed + pushed
  with the two pending quote slices (see log `2026-10-16-quote-fixes.md`).
  Visual confirmation still needs the owner browser pass.
- 2026-10-16 (reactions): Misskey-style chips row + like/emoji split
  (stateless smiley picker button, hearts like-only, delete-then-create
  set-semantics, server-reconciled counts); 10/10 helper checks, live
  like/switch/remove verified both servers, tsc + build green (see log
  `2026-10-16-reactions.md`). Committed + pushed as `1be2700`.
- 2026-10-16 (reaction-flicker): feed rows keyed by stable note id so
  like/unlike reconciliation updates in place instead of remounting the
  card; tsc + build green (see log `2026-10-16-reaction-flicker.md`).
  Committed + pushed as `2e08944`.
- 2026-10-16 (reaction-flicker-2): stable chip identities + optimistic
  updates with silent guard killed the remaining flash sources; tsc +
  build green, `withReaction` 5/5 (see log
  `2026-10-16-reaction-flicker-2.md`). Committed + pushed as `7449ab4`.
- 2026-10-16 (repost-collapse): feeds hide an original shown with its pure
  reposts (first repost wins, banner aggregates renoters); quotes never
  collapse; `collapseReposts` extracted pure + 16/16 checks, tsc + build
  green (see log `2026-10-16-repost-collapse.md`). Committed + pushed
  as `7d0392d`.
- 2026-10-16 (user-hover): hover/focus profile popup on note avatars +
  names (`UserHoverCard.tsx` + `.hovercard` styles, wired in `NoteCard`):
  banner header (profile2.png), avatar-overlap + Follow + name/handle/bio +
  compact counts (profile.png), `users/show` cached per session, Lite
  fallback + retry, desktop-hover only. `tsc` + build green; browser QA
  **not yet verified** (owner). See log `2026-10-16-user-hover.md`.
  Uncommitted.

## Servers running (background, dev only)

- Misskey: `node built/entry.js` in `/root/fedifedifedi/misskey/packages/backend`
  (Node v24.22.0) with `MISSKEY_CONFIG_YML=/tmp/pinetree-interop/misskey.yml`,
  `KEYSTONE_BACKEND_ONLY=1` → `127.0.0.1:3101`
  (log `/tmp/pinetree-interop/misskey.log`)
- Sharkey: `node built/boot/entry.js` in `/root/fedifedifedi/sharkey/packages/backend`
  with `MISSKEY_CONFIG_YML=/tmp/pinetree-interop/sharkey.yml`,
  `KEYSTONE_BACKEND_ONLY=1` → `127.0.0.1:3102`
  (log `/tmp/pinetree-interop/sharkey.log`)
- Keystone Vite: misskey-mode `:5176` (log `/tmp/keystone-vite-misskey.log`),
  sharkey-mode `:5177` (log `/tmp/keystone-vite-sharkey.log`),
  Pinetree-mode `:5173`
- Test accounts: mk1 / `password123` (misskey), sk1 + sk2 / `password123` (sharkey)
- Backend source patch: `KEYSTONE_BACKEND_ONLY` guard around
  `clientServerService.createServer` registration in both
  `packages/backend/src/server/ServerService.ts` (+ matching built output:
  misskey `built/ServerService-BRIfgkyT.js`, sharkey
  `built/server/ServerService.js`)
- Smoke: `/tmp/keystone-smoke.py` + `/tmp/keystone-smoke2.py` all green
  (see `logs/2026-10-15-stonekey.md`); `npm run build` green

## Blockers / open questions

- License for this repo: not yet declared.
- No browser in this environment: verification is API-transport probes +
  static source checks (no screenshots, no console-error observation).
  Items needing a real browser pass are marked **not yet verified** in the log.

## How to resume

1. Read `AGENTS.md`, this file, then the latest `state/logs/` entry.
2. Check `git status`; backends via `curl -m 5 -X POST
   http://127.0.0.1:3101/api/meta -H 'content-type: application/json' -d '{}'`
   (and `:3102`); frontends `:5176` / `:5177`.
3. Restarting a backend? Relaunch with the env above (misskey needs Node
   v24.22.0 first on PATH — the system node v22 cannot load its `re2.node`).
