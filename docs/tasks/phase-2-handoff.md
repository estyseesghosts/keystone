# Phase 2 handoff — data-layer port (`packages/fedi`)

Status: ready for pickup. Phase 1 is done on `main` (slices 1.1–1.5).
The block below is the paste-able prompt for the next implementer.

---

You are working in `/Users/terezi/Local Documents/keystonev2` (branch
`main`). This is Keystone v2: an Expo + React Native app (web, Android,
iOS) for federated social (Misskey/Mastodon families + Pinetree).
Phase 1 (skeleton, theme, components, shell) is done. Your job: **Phase 2
— port the old Keystone data layer into `packages/fedi`**, per
`rn-rebuild-plan.md` §5 Phase 2 (slices 2.1–2.6).

## First: mandatory read order (do not skip)

1. `AGENTS.md` (working rules, state protocol, product/arch rules)
2. `state/STATE.md`, then the latest logs in `state/logs/`
3. `docs/adr/0001-patterns-not-code.md` — study reference code, write
   your own; never vendor Bluesky or old-Keystone source verbatim
4. `rn-rebuild-plan.md` §2 (target arch) and §5 Phase 2 (your slices)
5. Old Keystone data layer: `~/Local Documents/Keystone/frontend/src/`
   (`core/` 9 files, `misskey/` 27 files, `mastodon/` 16 files, `api/`
   8 files), tests in `~/Local Documents/Keystone/frontend/test/`
   (~26 files) + `src/misskey/reactionActions.test.ts`, fixtures in
   `test/fixtures/` (`misskey/`, `sharkey/`, `mastodon/`, `akkoma/`,
   `pinetree/`, `manifest.json`)

## Hard constraints

- `packages/fedi` is pure TS. No `react`, `react-native`, `expo*`,
  `#/` imports, no `window`/`document`/`localStorage`, no Lingui
  (return `{code, params}` error codes; the UI localizes). Enforced by
  `lint-rules/no-ui-in-fedi` — your code must pass it.
- `src/` (when you touch it, only in 2.5) imports domain models from
  `@keystone/fedi` only — never `*/wire`. Enforced by
  `lint-rules/no-wire-in-app`.
- Work on `main` (owner waived per-slice branches). Commit at the end
  of each slice. One session log per slice in
  `state/logs/YYYY-MM-DD-p2.<n>-<topic>.md` (template in AGENTS.md §2).
- Create `docs/tasks/p2.<n>-<topic>.md` per slice (template in
  AGENTS.md §3), update `docs/tasks/README.md`, `state/STATE.md`, and
  `docs/DECISIONS.md` (one line per decision) as you go.
- Tests are Vitest in the old repo — convert to Jest (`vi` → `jest`).
  **Per-file test counts must match the originals**; list any delta
  with justification in the slice log.
- Toolchain: `export PATH="/Users/terezi/.npm-global/bin:$PATH"`,
  then `pnpm install`, `pnpm typecheck && pnpm lint && pnpm test`.
  Node 26, pnpm 12. `eventemitter3` is already a dependency.

## Slice order and key seams

- **2.1 Core** (`core/`: models, detect, backend, http, sessions,
  config, hosting, boot, quoteUri): strip i18n calls to error codes.
  Replace the `localStorage` seam in `sessions.ts` with an injected
  KV interface (MMKV/ SecureStore wiring lands in 2.5; define the
  interface now). Replace `window.location` uses in
  `config/hosting/boot` with a `getOrigin()` param.
- **2.2 Misskey adapter** (`misskey/`): replace Solid signals with
  `eventemitter3` (`customEmoji`, `translate`, `stream`); stream URL
  from the session origin (old code used `window.location`); replace
  `window.setTimeout` in `remotepost.ts` with globals. Keep all
  ported tests; add a mock-WebSocket `note`-event stream test.
- **2.3 Mastodon adapter** (`mastodon/`): `oauth.ts` takes the callback
  URL as a parameter (old code touched `window.location` /
  `document.querySelector`); replace SSE streaming with WebSocket
  (`/api/v1/streaming?stream=...`, keep polling fallback); `localStorage`
  in `oauth.ts` goes behind the 2.1 KV seam. Keep the Akkoma
  no-`/api/v2/instance` → v1-fallback-on-404/405 test. New
  WebSocket stream test.
- **2.4 Content AST** (`core/content/ast.ts`, `fromMfm.ts`,
  `fromHtml.ts`): node set = text, link, mention, hashtag, customEmoji,
  unicodeEmoji, bold, italic, strike, code, codeBlock, quote, br, plus
  MFM extras as `fn` nodes degrading to children. HTML via
  `htmlparser2` (add the dep; you pick the version), allow-list only.
  Port XSS cases from old `sanitize.ts`. Akkoma posts with MFM source
  take the MFM path.
- **2.5 Sessions + storage seam**: `sessions.ts` interfaces meet
  `src/storage/` (MMKV + zod schema, device + per-account scopes) and
  `src/state/session/` following the installed deps (MMKV is already
  installed; **add `expo-secure-store`** for tokens on native).
  Session = `{id, origin, family, flavor, accountId, token, grant,
  hosting}`. Include the cross-origin token test: a request built from
  session A never carries session B's token or origin.
- **2.6 Contract smoke** (`scripts/fedi-smoke.ts`): read-only calls
  (detect, meta/instance, public timeline, one note, one user) printed
  as a table. Rig per `docs/setup.md` (Misskey :3101, Sharkey :3102,
  Mastodon). Paste the table in the log; unavailable servers are
  recorded as `not verified`, never faked.

## Other notes

- `mastodon/stream.ts`, `misskey/importExport.ts`
  (`document.createElement('a')`), `api/linkpreview.ts` (`DOMParser`)
  need RN-safe replacements — record each swap in `docs/DECISIONS.md`.
- `misskey/reactionActions.ts` + `myReactions.ts` are reference only
  (replaced by post-shadow + toggle queue in Phase 4); keep their six
  test cases green, do not build on them.
- Every slice ends with `pnpm typecheck && pnpm lint && pnpm test`
  green, pasted into the log. Native/web runs: paste output or write
  `not verified`. Never claim unverified work.
- Owner review happens at Gate G2 (all ported tests green + smoke
  table); do not start Phase 3 until STATE.md says G2 passed.

Start with slice 2.1: create `docs/tasks/p2.1-core.md`, do the port,
verify, log, commit, update STATE.md.
