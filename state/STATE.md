# STATE — resume pointer (mutable, keep current)

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
