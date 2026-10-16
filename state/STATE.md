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
