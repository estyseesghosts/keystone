# Repair plan — audit 2026-10-25

Agent-ready slices for every finding in `docs/audit_20261025/report.md` and
`docs/audit_20261025/results/*.md`. The result files are the source of truth
for *what is wrong* (file:line, scenario). This document is the source of
truth for *what to do, in what order, and what "done" is*.

## Scope decisions (from the owner)

- **Skipped on purpose:** iOS and Android release signing (security H1, and
  everything that needs a signing identity: App Links / Universal Links,
  `assetlinks.json`, entitlements). Do not touch signing config.
- **No translation work:** do not write translations for any non-English
  locale. Do make the app *translation-ready*: no user-visible string
  literal anywhere, enforced by lint (Wave 9 plus the ratchet rule in X0.2).
  English is the only catalog that gets filled.
- Everything else, including every low and info finding, is covered. The
  **Coverage matrix** at the bottom maps every finding ID to a slice. If you
  find a finding with no slice, add one before starting work and note it in
  your log.

## How to run a slice

1. Read `AGENTS.md`, `state/STATE.md`, the latest 1-3 logs, this file's
   slice, and the result sections the slice cites. Do not re-read the whole
   audit. State on disk is your only memory.
2. One slice per session. Branch `repair25-<id>-<topic>` (e.g.
   `repair25-x1.2-session-purge`) from current `main`. Do not merge until the
   slice acceptance is green and the owner says so.
3. Touch only the files the slice lists. Anything else is a deviation: stop
   if major, otherwise do it and record why under `Deviations` in the log.
4. Tests are part of every slice. Each fix ships a test that fails before
   the fix and passes after. Ported-test counts must not drop; list deltas
   in the log (AGENTS.md section 7).
5. Never claim a check you did not run. Rig Misskey `:3101` / Sharkey
   `:3102` are refused to agents: write `not verified (owner live-tests
   externally)`. Device checks the same: `not verified (device)`. Both go on
   the owner checklist in X12.1.
6. Load-bearing decisions (storage shape, model nullability, cache key
   shape, dependency adds) get an ADR in `docs/adr/` **before** the code, plus
   a one-line `docs/DECISIONS.md` entry. ADRs planned here: 0011 (X1.1), 0012 (X2.3); any other slice takes the next free number.
7. End of session: `state/logs/YYYY-MM-DD-repair25-<id>.md` (template in
   `AGENTS.md` section 2), flip this slice's `Status:` line, update
   `state/STATE.md` (keep it under 60 lines), paste
   `pnpm typecheck && pnpm lint && pnpm test`.
8. Patterns, not Bluesky source (`docs/adr/0001-patterns-not-code.md`). UI
   sees only `packages/fedi` domain models. `packages/fedi` stays pure TS.
   Every query key stays `sessionId`-first. No fake data. No inert controls.
9. **From X0.2 onward, no new user-visible string literals.** Every new UI
   string goes through Lingui (`msg` / `t` / `Trans` / `plural`). Errors from
   `packages/fedi` carry codes and params, never display text.

## Owner decisions (agents proceed with the default unless told otherwise)

| ID | Question | Default the agent uses | Blocks |
|----|----------|------------------------|--------|
| D1 | `ios/` is untracked and not ignored; `android/` is tracked. Pick one policy: commit both, or ignore both (CNG). | Commit both.
| D2 | Web build keeps tokens in `localStorage`-backed storage. | CSP guidance.
| D3 | After removing the active account, switch to the next stored account or drop to signed-out? | Switch to the most recently used remaining account. | X1.2 |
| D4 | Mastodon animated avatars/headers: keep static (`avatar_static`)? | Show animated avatars by default unless reduce motion enabled. | X4.4 |
| D5 | Link previews: auto-fetch or tap-to-unfurl? | Tap-to-unfurl; auto only on public posts and only if the user opts in. | X2.5 |
| D6 | App-switcher privacy shield default. | Opt-in setting, default off. | X2.5 |
| D7 | MiAuth `keystone://` callback can be intercepted on Android. Real fix needs App Links (needs signing + a domain). | Accepted risk, recorded as an ADR; mitigations in X2.3. | X2.3 |
| D8 | Build Mastodon notification requests/policy (4.3+) now? | Yes, as X4.5, behind its own slice. Skip if owner says no. | X4.5 |
| D9 | Strip EXIF/GPS on upload by re-encoding images. | this hits two different problems i want to address - we SHOULD strip exif by default and we SHOULD re-encode to compress on upload by default. both should be options at post time. | X7.4 |
| D10 | Online-status source for react-query: `@react-native-community/netinfo` or `expo-network`. | Whichever SDK 57 `bundledNativeModules.json` lists; record in DECISIONS. | X3.2 |

## Sequencing

Waves are ordered. Slices inside a wave are file-disjoint unless the
conflict table says otherwise and may run in parallel. A later wave must not
start on a file an earlier wave still owns.

| Wave | Intent | Slices |
|------|--------|--------|
| 0 | Guardrails first: lint, i18n ratchet, STATE reset, repo hygiene | X0.1-X0.4 |
| 1 | Data lifecycle and secrets: vault, purge, envelope, cache policy, 401, platform config | X1.1-X1.6 |
| 2 | Native runtime, transport, auth, URL policy, privacy defaults | X2.1-X2.5 |
| 3 | Networking resilience: cancel, online, paging, streams, boot | X3.1-X3.5 |
| 4 | Mastodon correctness | X4.1-X4.5 |
| 5 | Misskey/Sharkey correctness and real fixtures | X5.1-X5.6 |
| 6 | Content parser, link safety, composer | X6.1-X6.5 |
| 7 | Media: lightbox, players, images, uploads | X7.1-X7.4 |
| 8 | UI robustness and state-layer correctness | X8.1-X8.4 |
| 9 | i18n readiness: no literals anywhere | X9.1-X9.8 |
| 10 | Accessibility | X10.1-X10.2 |
| 11 | Dependencies, tests, docs | X11.1-X11.3 |
| 12 | Close-out: owner checklists, final verification | X12.1-X12.2 |

Conflict table (do not schedule together; order is left to right):

- `src/state/session/store.ts`: X1.1 -> X1.2 -> X1.5.
- `packages/fedi/src/core/sessions.ts`: X1.1 -> X1.3 -> X5.5.
- `src/state/queries/Provider.tsx`: X1.4 -> X1.5 -> X3.2.
- `packages/fedi/src/core/http.ts`: X2.1 (read only) -> X2.2 -> X3.1.
- `packages/fedi/src/mastodon/client.ts`: X2.2 -> X3.1.
- `packages/fedi/src/mastodon/backend.ts`: X2.1 -> X2.3 -> X3.4 -> X4.1 -> X4.2 -> X4.3 -> X4.4 -> X4.5 -> X7.4.
- `packages/fedi/src/misskey/backend.ts`: X3.4 -> X5.1 -> X5.2 -> X5.4.
- `packages/fedi/src/misskey/stream.ts` / `mastodon/stream.ts`: X3.4 only.
- `packages/fedi/src/core/models.ts` / `core/backend.ts` / `core/detect.ts`: X4.2 -> X4.3 -> X4.4 -> X5.4. (One at a time; model widenings need ADRs.)
- `packages/fedi/src/core/content/*` and `src/components/RichText.tsx`: X6.3 -> X6.4. Nothing else edits them, except the Wave 9 sweep which runs after.
- `src/components/Composer/Composer.tsx`, `src/state/queries/composer.ts`, `packages/fedi/src/api/composer.ts`: X6.1 -> X6.2 -> X7.4 -> Wave 9.
- `src/components/Lightbox.tsx`: X7.1 only, then Wave 9/10.
- `src/components/Post/PostMediaGrid.tsx`: X7.2 -> X7.3.
- `src/components/Post/PostCard.tsx`: X2.4 -> X2.5 -> X7.3 -> Wave 9.
- `src/screens/HomeFeed.tsx`: X3.3 -> X3.4 -> X8.4.
- `eslint.config.mjs` / `lint-rules/*`: X0.1 -> X0.2; after that only a slice that adds its own rule.
- `src/locale/*`, `lingui.config.ts`: X0.2 -> Wave 9.
- `android/` and `app.config.js`: X1.6 only.

---

# Wave 0 - guardrails

Put the rails down before anything else so later slices are enforced, not
trusted.

## X0.1 - Lint and test tooling gaps

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x0.1.md`; 219 suites / 3020 tests green at Wave-0 commit; exhaustive-deps warn count 13, owned by X8.4)
Branch: `repair25-x0.1-lint-gaps` (worked in shared tree per owner order; committed per slice, no merge)
Audit: sessions-cache 12; build 4, 5, 9; rn-ui M2; security (query-key / innerHTML rules)

**Goal.** Close every gap in the lint rules and test runner that the audit
found, so conventions are machine-enforced.

**Read first.** `eslint.config.mjs`, `lint-rules/index.js`,
`lint-rules/no-ui-in-fedi.js`, `lint-rules/no-wire-in-app.js`,
`lint-rules/__tests__/*`, `package.json` scripts, `docs/tasks/p1.2-lint-gates.md`.

**In scope.** `eslint.config.mjs`, `lint-rules/**`, `package.json`
(scripts and devDependencies only), `jest/jestSetup.js` (crypto mock only),
delete `packages/fedi/src/zz_audit_tmp.test.ts` if it exists.

**Steps.**
- [ ] 1. `no-ui-in-fedi`: replace the `react-native($|/)` matcher with a
  prefix ban covering `react-native`, `react-native-*`, `@react-native/*`,
  `@react-native-*/*`, `expo`, `expo-*`, `@expo/*`, `@tanstack/*`,
  `react`, `react-dom`. Add rule tests for each (`react-native-mmkv`,
  `@react-native-async-storage/async-storage`, `@expo/vector-icons`,
  `@tanstack/react-query`).
- [ ] 2. `eslint.config.mjs`: lint `packages/fedi/**/*.{ts,tsx}` (not just
  `.ts`).
- [ ] 3. `no-wire-in-app`: also reject deep imports `@keystone/fedi/<subpath>`
  from `src/` for `mastodon/*`, `misskey/*`, `core/http`, and any
  `wire`/`client`/`adapt`/`endpoints` basename. Add evasion tests.
- [ ] 4. New rule `keystone/query-key-session-first`: any `queryKey:` /
  `useQuery`/`useInfiniteQuery`/`setQueryData`/`invalidateQueries` key array
  literal in `src/` must start with a `sessionId` expression or call
  `createQueryKey(`. Allow the `'signed-out'` scope via `createQueryKey`
  only. Test file.
- [ ] 5. New rule `keystone/no-inner-html`: ban `innerHTML`,
  `dangerouslySetInnerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval`, `new Function`, and `react-native-webview`
  imports in `src/` and `packages/`. Test file.
- [ ] 6. Add `eslint-plugin-react-hooks`. `rules-of-hooks` = error.
  `exhaustive-deps` = **warn** for now (X8.4 raises it to error after the
  cleanup). Record the warning count in the log.
- [ ] 7. `package.json` `lint`: extend oxlint to `src packages scripts
  lint-rules`.
- [ ] 8. `package.json` `test`: remove `--bail`; keep `--forceExit` for now
  but add `test:handles` = `jest --detectOpenHandles`. Run it once, list
  leaking suites in the log, fix teardown in any suite that is a one-line
  fix (clear timers, close sockets); open a follow-up note for the rest.
- [ ] 9. `jest/jestSetup.js`: stop mocking `globalThis.crypto` as `{}`.
  Install Node's `webcrypto` (`require('node:crypto').webcrypto`) so
  `getRandomValues` and `randomUUID` exist in tests. Fix any test that relied
  on the empty mock.
- [ ] 10. Delete `packages/fedi/src/zz_audit_tmp.test.ts` if present (scratch
  file from a prior auditor; confirm untracked first).

**Deliverables.** Updated rules + a rule test per new/changed rule.

**Acceptance.**
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] Each new rule has at least one passing and one failing fixture.
- [ ] `pnpm lint` still exits 0 with `exhaustive-deps` as warn (count logged).

**Out of scope.** Fixing exhaustive-deps warnings (X8.4); the i18n rule (X0.2).

## X0.2 - i18n ratchet: lint rule, pseudo-locale, conventions

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x0.2.md`; baseline 80 files / 620 violations; 220 suites / 3053 tests green at Wave-0 commit)
Audit: a11y 2, 3, 4 (infra); user requirement "no string literals anywhere"

**Goal.** Make it impossible to add a new user-visible string literal, and
give the Wave 9 sweep a measurable burn-down.

**Read first.** `lingui.config.ts`, `src/locale/i18n.ts`, `src/locale/locale.test.ts`,
`lint-rules/no-hardcoded-color.js` (pattern for a ratcheted rule),
`AGENTS.md` section 5 (lint, not prose).

**In scope.** `lint-rules/no-literal-ui-string.js` (+ test),
`lint-rules/index.js`, `eslint.config.mjs`, `lingui.config.ts`,
`src/locale/i18n.ts`, new `docs/i18n.md`, new
`lint-rules/baselines/no-literal-ui-string.json`.

**Steps.**
- [ ] 1. Write rule `keystone/no-literal-ui-string` (error). It reports, in
  `src/**/*.tsx` and `.ts` (excluding tests, `src/locale/locales/**`, and
  files under `src/__tests__`):
  - JSX text nodes containing a letter (`\p{L}`), unless wrapped in
    `<Trans>`. Whitespace, digits, and pure punctuation/glyph-only text
    (`·`, `/`, `|`, `…`, `—`) are allowed.
  - String/template literals assigned to JSX props `label`, `title`,
    `placeholder`, `accessibilityLabel`, `accessibilityHint`,
    `accessibilityValue`, `aria-label`, `alt`, `tooltip`, `disabledReason`,
    `emptyText`, `description`, `headerTitle`, `subtitle`, `caption`.
  - String literals passed as the first argument of `showToast`,
    `toastError`, `Alert.alert`, `confirm`.
  - Allowed: anything inside `msg\`\``, `t\`\``, `i18n._()`, `plural()`,
    `<Trans>`; `testID`; `key`; `style`; URLs; icon names; string enum
    values compared against identifiers.
- [ ] 2. Add a **baseline** (`lint-rules/baselines/no-literal-ui-string.json`:
  `{file: count}`) produced by running the rule on the current tree. The rule
  fails when a file's count rises or when a new file has any violation. It
  passes when counts fall. A script `pnpm lint:i18n-baseline` rewrites the
  baseline downward only (refuses to raise it). This is the Wave 9 burn-down
  meter; log the total.
- [ ] 3. Pseudo-locale for development: add Lingui `pseudoLocale` support
  (`lingui.config.ts`, `pseudoLocale: 'pseudo'`) and a dev-only entry in
  `i18n.ts` (not in `SUPPORTED_LOCALES`, not in the production picker; reachable
  via `?locale=pseudo` on web and a `__DEV__` setting on native). Anything
  that still shows plain English under it is an untranslated literal.
- [ ] 4. Missing-translation behaviour: confirm and test that a message
  missing from a non-`en` catalog falls back to the source message (English)
  and never to the message id. Add the test in `locale.test.ts`.
- [ ] 5. `docs/i18n.md` conventions (short, enforceable): `msg` for
  descriptors, `t` inside components via `useLingui`, `Trans` for rich text,
  `plural`/`select` for counts and gender (never `n === 1 ? '' : 's'`), no
  string concatenation, include `context:`/`comment:` for ambiguous words,
  dates/numbers/sizes via the shared locale-aware formatters (built in X9.5),
  never translate server-supplied data, `packages/fedi` returns error codes
  and params only (see X9.7).

**Deliverables.** Rule, tests, baseline file, pseudo-locale, `docs/i18n.md`.

**Acceptance.**
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green with the baseline in place.
- [ ] Adding a literal `<Text>Hello</Text>` to a clean file makes lint fail (rule test).
- [ ] Baseline total recorded in the log.

**Out of scope.** Fixing existing literals (Wave 9); writing any non-English text.

## X0.3 - Reset `state/STATE.md`

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x0.3.md`; STATE 188 → 31 lines; counts refreshed from gate runs)
Audit: build 1, 2

**Goal.** Make `state/STATE.md` a real pointer again so every later session
starts from an unambiguous next step.

**In scope.** `state/STATE.md`, one new log. Do not edit old logs (append-only).

**Steps.**
- [ ] 1. Move the accreted changelog out of STATE.md into one new log
  `state/logs/<today>-repair25-state-reset.md` (verbatim copy under a heading).
  Do not modify existing logs.
- [ ] 2. Rewrite STATE.md to under 60 lines: current phase ("repair program
  2026-10-25"), active branch, next 3 steps (the next unstarted slices from
  this file), blockers (open owner decisions D1-D10 that are blocking),
  links (this file, the report, the latest 3 logs).
- [ ] 3. Correct the stale numbers using the actual gate run (record the
  real suite/test counts). Note in the log that some prior entries and logs
  carry dates after today's real date (2026-10-26 vs 2026-10-25) and that
  they were left as written.
- [ ] 4. Remove the ambiguous older "P6 Wave 3.2" mid-file pointer; if it
  still names a live next step, preserve it as one line under "Parked work".

**Acceptance.**
- [ ] `wc -l state/STATE.md` < 60.
- [ ] Gates green; counts in STATE match the run.

## X0.4 - `ios/` tracking policy

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x0.4.md`; D1=commit both applied, `git status` clean of `?? ios/`)
Branch: `repair25-x0.4-native-dirs`
Audit: build 3

**Goal.** One consistent policy for generated native directories.

**Steps.**
- [ ] 1. Read `app.config.js` comments and `docs/adr` for any existing
  prebuild/CNG decision. Present D1 to the owner with the evidence
  (android/ 36 tracked files; ios/ untracked).
- [ ] 2. After the owner answers: apply it (`.gitignore` both, or commit both
  and remove the "survives prebuild" comments). **Never delete either
  directory.**
- [ ] 3. Record in `docs/DECISIONS.md`.

**Acceptance.** `git status` no longer shows `?? ios/` (if ignoring) or shows it staged (if committing); decision logged. If D1 is unanswered, write `STATUS: blocked on D1` and stop.

---

# Wave 1 - data lifecycle and secrets

The highest-impact cluster: findings reported independently by up to five
audits. Land in order.

## X1.1 - Token vault that actually works; tokens out of plaintext

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x1.1.md`; ADR 0011; 222 suites / 3113 tests green at Wave-1 commit)
Branch: `repair25-x1.1-vault` (worked in shared tree per owner order; committed per slice, no merge)
Audit: storage S1, S2, S5 (vault half); security M1; privacy 3; sessions-cache 5

**Goal.** On native, bearer tokens and Mastodon `client_secret`s live only in
the OS secure store (and an in-memory map); nothing secret is written to
unencrypted MMKV.

**Read first.** `src/storage/tokens.ts`, `tokens.web.ts`, `src/storage/mmkv.ts`,
`src/state/session/store.ts:30-38,309-317,421-495`,
`packages/fedi/src/core/sessions.ts`, `packages/fedi/src/mastodon/oauth.ts:250-345`,
`node_modules/expo-secure-store/src/SecureStore.ts` (key validation),
`docs/adr/0008-sdk-57-pin.md`.

**In scope.** `src/storage/tokens*.ts`, `src/storage/mmkv.ts`,
`src/state/session/store.ts`, `packages/fedi/src/core/sessions.ts`,
`packages/fedi/src/mastodon/oauth.ts` (app-secret storage only), their tests,
`docs/adr/0011-token-storage.md`.

**Steps.**
- [ ] 1. **ADR 0011 first.** Decide and record: (a) native: tokens and app
  secrets only in SecureStore, mirrored in an in-memory map that request
  building reads synchronously; envelope stores no `token`. (b) Web: unchanged
  (`localStorage`-backed, dev-grade), documented as a release blocker (D2).
  (c) If a native vault write fails: the session stays usable in memory for
  this run, the failure is surfaced (toast via a `sessionVaultFailed` event),
  and next launch asks the user to sign in again. No silent plaintext fallback.
- [ ] 2. Fix `tokenKeyFor` to return only `[A-Za-z0-9._-]` characters
  (hex/base64url of the session id; prefix `keystone.vault.`). Add a test
  that runs the **real** `expo-secure-store` key regex against the output for
  ids containing `:`, `/`, spaces, unicode, and 300-character origins.
- [ ] 3. `setToken`/`getToken`/`removeToken` return success booleans (or
  throw typed errors). Stop swallowing. On `setToken` failure call
  `removeToken` for the id so a stale vault entry cannot win later.
- [ ] 4. Envelope migration: on first launch after this change, for every
  stored session that has a `token` in the envelope, write it to the vault,
  verify with a read-back, then rewrite the envelope without `token`.
  Idempotent; safe to re-run; never drops a session if the vault write fails
  (keeps the in-memory token, keeps the envelope copy **until** verified).
- [ ] 5. In-memory token map: populated by `hydrate()` (awaited in `Root`
  before first request, as today) and by `add()`. `findSession`/
  `resolveSessionBackend` get the token from the map. Add a test proving no
  request is built with an empty token after `hydrate`.
- [ ] 6. Move Mastodon app `client_secret` (`keystone_apps` rows) to the
  vault under a valid key; keep `client_id` and metadata in MMKV. Migrate
  existing rows the same way as step 4.
- [ ] 7. Update the doc comments in `store.ts`/`tokens.ts` so they describe
  what actually runs.

**Deliverables.** Working vault, migration, ADR 0011, tests including a
real-regex key test and a "no token in MMKV after add()" assertion that reads
the raw MMKV blob.

**Acceptance.**
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] Test: after `store.add(session)`, `JSON.stringify` of every MMKV key
  contains no token substring.
- [ ] Device: sign in on iOS/Android, kill, relaunch, still signed in -> `not verified (device)` unless run.

**Out of scope.** Encrypting MMKV wholesale (rejected in the ADR; mitigated
by X1.4's allowlist); web storage change.

## X1.2 - Purge everything on sign-out; fix session races

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x1.2.md`; D3 default recorded; 223 suites / 3127 tests green at Wave-1 commit)
Branch: `repair25-x1.2-session-purge` (worked in shared tree per owner order; committed per slice, no merge)
Audit: privacy 2, 7 (logout half); storage S3, S5, S6; networking H3; sessions-cache 1, 6, 7

**Goal.** Removing an account or signing out wipes every trace of it from
memory and disk, and the session store's own races are closed.

**Read first.** `src/state/session/store.ts:296-320,453-495`,
`src/state/cache/post-shadow.ts`, `src/state/queries/Provider.tsx`,
`src/storage/drafts.ts`, `schema.ts:127`, `graph.ts:101`, `recents.ts:13`,
`Home.tsx:39,97`, `src/state/streaming.ts`.

**In scope.** `src/state/session/*`, new `src/state/session/purge.ts`,
`src/state/queries/Provider.tsx` (register the purger only),
`src/storage/{drafts,recents,emojiPrefs,schema}.ts` (add `purgeSession`
helpers), `src/screens/Home.tsx` (homeTab key helper only), tests.

**Steps.**
- [ ] 1. `purgeSession(sessionId)` in `purge.ts`, driven by a registry so the
  store (outside React) can reach the `QueryClient`: `registerSessionPurger(fn)`
  called by `Provider.tsx`. The purger does, for the id:
  `queryClient.cancelQueries` + `removeQueries({predicate: key[0] === id})`,
  re-persist, `postShadowStore.clearSession(id)`, stop streaming handles for
  the session, delete `keystone.drafts.<sid>` (+ open pointer),
  `keystone.account.<sid>`, `keystone.softmute.<sid>`,
  `keystone.emojirecents.<sid>`, `keystone.emojifavs.*` and
  `keystone.likeemoji.*` for the id, `keystone.homeTab:<sid>`, and any other
  `<prefix>.<sid>` key found by grepping `appStorage` key builders. Keep a
  single exported list of per-session key builders (`sessionScopedKeys(id)`)
  so a new key cannot be forgotten; add a test that enumerates MMKV keys after
  purge and asserts none contain the id.
- [ ] 2. Call `purgeSession` from `remove`, `dropLocal` (401), and per id in
  `signOutEverywhere`. `signOutEverywhere` additionally calls
  `queryClient.clear()` and removes the persisted cache key.
- [ ] 3. `signOutEverywhere`: run revokes with `Promise.allSettled` (parallel,
  keep the per-revoke timeout); clear the active pointer / mirror **only if**
  the active id is among the removed ids (S6). Test: add a session while
  revokes are pending; it survives and stays active.
- [ ] 4. `hydrate()`: serialize with remove/dropLocal through a promise chain
  or version counter; re-read the session by id immediately before each write
  and skip if it is gone or its token changed (S5). Guard against
  `SessionProvider` calling `hydrate()` twice concurrently (single-flight).
  Do not reorder the list on hydrate. Tests for both races.
- [ ] 5. D3 default: when the removed session was active and others remain,
  activate the most recently used remaining one; if none, signed-out.
  Record in `docs/DECISIONS.md`.
- [ ] 6. Re-adding the same account within the old cache lifetime must show
  cold data (test: add, populate cache, remove, add again, assert no cached
  feed).

**Acceptance.**
- [ ] Gates green.
- [ ] Test enumerates all MMKV keys and the `QueryClient` after remove and finds nothing for the id.
- [ ] `postShadowStore.clearSession` has a non-test caller.

**Out of scope.** Cache allowlist (X1.4); envelope corruption (X1.3).

## X1.3 - Storage resilience

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x1.3.md`; 224 suites / 3163 tests green at Wave-1 commit)
Branch: `repair25-x1.3-storage-resilience` (worked in shared tree per owner order; committed per slice, no merge)
Audit: storage S4, S9, S10, S11, S12

**Goal.** Storage reads and writes never destroy data they could not parse,
and storage failures are visible.

**Read first.** `packages/fedi/src/core/sessions.ts:176-216,391-395,523`,
`src/storage/schema.ts:61-101`, `src/storage/drafts.ts`,
`src/storage/mmkv.ts`, `src/screens/LoginFlows.ts:316`, `recents.ts`,
`emojiPrefs.ts`.

**In scope.** `packages/fedi/src/core/sessions.ts`, `src/storage/*`,
`src/screens/LoginFlows.ts` (sweep call only), `src/state/session/store.ts`
(boot sweep hook only), tests.

**Steps.**
- [ ] 1. Session envelope (S4): never overwrite a non-empty value that failed
  to parse or has an unexpected version. Copy the raw value to
  `keystone_sessions.bak` first (once; do not overwrite an existing backup
  unless identical), then proceed. Do not write an empty envelope when a
  non-empty unreadable value exists. Version mismatch: attempt migration for
  `STORE_VERSION - 1`; for a newer version, read-only mode (use what parses,
  do not write) and surface a `storageNewerVersion` notice. Individual
  malformed sessions are preserved in a `.bak` before being dropped.
- [ ] 2. Device state and drafts (S9): same rule - back up the raw value
  before a first write over an unreadable-but-non-empty value; never null the
  active-session mirror because prefs failed to parse.
- [ ] 3. Sweep stale `keystone_pending_miauth_*` rows older than 15 minutes
  at boot (S10), without touching fresh rows.
- [ ] 4. Draft key (S11): move the open-draft pointer to a separate prefix
  `keystone.draftopen.<sid>` with a one-time migration from
  `keystone.drafts.<sid>.open`. Update the purge key list from X1.2.
- [ ] 5. Write failures (S12): `createMmkvStore.setItem` returns/throws a
  typed result; add a dev log and an app-level `storageWriteFailed` event
  (consumed by X8.1's logger). Draft autosave shows a non-blocking notice when
  the write fails. No new user-visible literal strings (use `msg`).

**Acceptance.**
- [ ] Gates green. Tests: corrupt JSON, version 99, partial entries, write throws.
- [ ] A test asserts the `.bak` key holds the original bytes after a corrupt read.

## X1.4 - Persisted query cache policy

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x1.4.md`; 222 suites / 3113 tests green at Wave-1 commit)
Branch: `repair25-x1.4-cache-policy` (worked in shared tree per owner order; committed per slice, no merge)
Audit: privacy 1; storage S7, S8; sessions-cache 8; security L4

**Goal.** Only an allowlist of non-private data is persisted, size-bounded,
and a schema change invalidates stale shapes automatically.

**Read first.** `src/state/queries/Provider.tsx:26-88`, `stale.ts`, `keys.ts`,
`src/state/queries/*.ts` (list every query kind), `docs/adr/0009*`.

**In scope.** `src/state/queries/{Provider,stale,keys}.tsx/ts`,
new `src/state/queries/persistPolicy.ts`, tests.

**Steps.**
- [ ] 1. `persistPolicy.ts`: a **default-deny** map from query kind (the second
  element of the key) to `{persist: boolean, maxPages?: number}`. Persist only
  public timelines (home/local/public feeds, first page), profiles, emoji,
  instance metadata, and `me`. Never persist: conversations, conversation,
  chat rooms/messages, notifications, bookmarks/favourites, drafts (scheduled
  and server), admin, search, moderation, and any post whose
  `visibility.kind` is `direct` or `followers` (strip those rows from persisted
  feed pages during dehydrate).
- [ ] 2. `Provider.tsx`: `dehydrateOptions.shouldDehydrateQuery` uses the
  policy; infinite queries are trimmed to `maxPages` before serialisation.
- [ ] 3. Size bound: cap the serialised blob (e.g. 2 MB); on overflow drop the
  largest queries first (use the persister's `retry` hook), never throw. Split
  per session: one MMKV key per `sessionId` so one account's churn does not
  rewrite everyone's blob, and `purgeSession` can delete exactly one key.
- [ ] 4. Buster (S8): derive `QUERY_BUSTER` from a single exported
  `SCHEMA_VERSION` constant bundled with the domain models; add a test that
  fails when the hash of the exported model type names changes without a bump
  (a snapshot of `Object.keys` of adapter outputs is enough).
- [ ] 5. A lint-style test: every query kind used in `src/state/queries/*`
  has an explicit policy entry (fails on a new unclassified kind).

**Acceptance.** Gates green; test proves a direct-message conversation and a
followers-only post never appear in the persisted blob.

## X1.5 - Runtime 401 handling

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x1.5.md`; 226 suites / 3188 tests green at Wave-1 commit)
Branch: `repair25-x1.5-runtime-401` (worked in shared tree per owner order; committed per slice, no merge)
Audit: sessions-cache 4

**Goal.** A token revoked while the app runs is detected and the session is
dropped (after confirmation), not left as an empty signed-in shell.

**In scope.** `src/state/queries/Provider.tsx` (QueryCache/MutationCache
`onError`), `src/state/session/store.ts` (`verifySession`), tests.

**Steps.**
- [ ] 1. Global `QueryCache`/`MutationCache` `onError`: when the error is an
  `ApiError` with status 401 and `queryKey[0]` is a known session id, call
  `store.verifySession(id)`, debounced per session (one in flight, 30 s
  cool-down).
- [ ] 2. `verifySession(id)` calls `me()` for that session; only a second 401
  drops the session (via X1.2's purge). 403/network/5xx never drop.
- [ ] 3. Inactive sessions are verified lazily when the user switches to them.
- [ ] 4. UI: when a session is dropped for a dead token, show one toast
  ("Signed out of <acct>: session expired", via `msg`) and route to Login if it
  was the last session.

**Acceptance.** Gates green; tests: 401 then 401 drops, 401 then 200 does not, 403 never drops, concurrent 401s verify once.

## X1.6 - Platform config: backup, permissions, cleartext

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x1.6.md`; 222 suites / 3113 tests green at Wave-1 commit)
Branch: `repair25-x1.6-platform-config` (worked in shared tree per owner order; committed per slice, no merge)
Audit: security M2, L3 (Android cleartext); privacy 3 (backup), 11

**Goal.** Reduce platform attack surface without touching signing.

**Read first.** `app.config.js`, `plugins/*`, `android/app/src/main/AndroidManifest.xml`,
`ios/*/Info.plist` (read only; untracked).

**In scope.** `app.config.js`, `plugins/*`, `android/app/src/main/AndroidManifest.xml`
and `android/**/res/xml/*` (to match the config). Do **not** edit `ios/`
directly; use config plugins.

**Steps.**
- [ ] 1. `android.allowBackup: false` in `app.config.js`; update the tracked
  `AndroidManifest.xml` to match. Add data-extraction rules excluding the MMKV
  directory for any future re-enable.
- [ ] 2. iOS: a config plugin that sets `NSURLIsExcludedFromBackupKey` on the
  MMKV storage directory at runtime (small native-free JS call at boot via
  `expo-file-system` if available) or documents why it is not possible.
- [ ] 3. Android cleartext: set `usesCleartextTraffic` false for release via
  `expo-build-properties` plus a network security config permitting cleartext
  only to localhost/`10.0.2.2`/RFC1918 in debug builds. (App-level URL policy
  is in X2.2.)
- [ ] 4. Permissions: configure the `expo-image-picker` plugin with
  `cameraPermission: false` and `microphonePermission: false` (no camera or
  recording code exists); confirm `RECORD_AUDIO` leaves the merged manifest.
  Ensure `SYSTEM_ALERT_WINDOW` is dev-client only (strip in release via the
  plugin or `tools:node="remove"` for non-debug). Make
  `NSLocalNetworkUsageDescription`/Bonjour entries debug-only.
- [ ] 5. Document what was verified how (`expo prebuild --no-install` into a
  scratch dir, diff the manifest/Info.plist). Do not commit regenerated
  native dirs beyond what D1/X0.4 allows.

**Acceptance.** Gates green; prebuild diff pasted in the log; `not verified (device)` for runtime behaviour.

**Out of scope.** Signing, App Links.

---

# Wave 2 - native runtime, transport, auth, URL policy, privacy defaults

## X2.1 - A real random source, everywhere

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x2.1.md`; ADR none (seam+polyfill, recorded in DECISIONS); 231 suites / 3301 tests green at Wave-2 commit)
Branch: `repair25-x2.1-crypto` (worked in shared tree per owner order; committed per slice, no merge)
Audit: networking H1, L2; mastodon 2, 8 (key stability); security L3 (PKCE half); misskey M8

**Goal.** No `Math.random` anywhere in a security path; the native
`crypto` global exists; the idempotency key survives retries.

**Read first.** `packages/fedi/src/mastodon/compose.ts:190-225`,
`mastodon/oauth.ts:440-460`, `misskey/auth.ts:60-72`, `misskey/external.ts:120-135`,
`src/platform/polyfills.ts`, `polyfills.web.ts`, `docs/adr/0008-sdk-57-pin.md`.

**In scope.** `package.json` (add `expo-crypto`, version from SDK 57
`bundledNativeModules.json`), `src/platform/polyfills.ts`, the four fedi
files above, a new pure-TS seam `packages/fedi/src/core/random.ts`, tests,
`docs/DECISIONS.md`.

**Steps.**
- [ ] 1. `core/random.ts` exports `randomBytes(n)`, `randomToken(bytes)`,
  `randomUuid()`. They read `globalThis.crypto` and **throw a typed
  `FediError('errors.crypto.unavailable')`** if absent. No `Math.random`
  fallback anywhere. Remove the fallbacks in `oauth.ts` (`randomToken`),
  `misskey/auth.ts` (`newSessionId`), `misskey/external.ts`
  (`newExternalSessionId`), and `compose.ts` (`newIdempotencyKey`).
- [ ] 2. `polyfills.ts`: import `expo-crypto` and install
  `globalThis.crypto = {getRandomValues, randomUUID}` when missing (only if
  absent; never overwrite a real one). Must run before any fedi import: verify
  import order from `index.ts`.
- [ ] 3. Idempotency (networking L2, mastodon 8): `PostDraft` gains an
  optional `attemptKey: string`. `createPost` and scheduled-create use it when
  present, mint a key only when absent. The composer (X6.2 wires the UI side;
  here add `attemptKeyFor` use inside `createPost` callers in `src/api/composer.ts`
  or keep a draft-fingerprint cache inside the backend) holds one key per
  logical attempt: same body + same session = same key for 5 minutes;
  a changed body = new key. Test: a simulated timeout followed by retry sends
  the same `Idempotency-Key`.
- [ ] 4. Tests: stub `globalThis.crypto = undefined` -> each of the four
  functions throws the typed error (no random output); with the webcrypto
  mock -> correct lengths and charset; PKCE verifier meets RFC 7636 (43-128
  chars, unreserved set).
- [ ] 5. DECISIONS line for the `expo-crypto` add.

**Acceptance.** Gates green; device: `createPost` on a Mastodon account and a
PKCE login on Android+iOS -> `not verified (device)` unless run.

## X2.2 - Transport hardening

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x2.2.md`; 243 suites / 3397 tests green at Wave-2 commit)
Branch: `repair25-x2.2-transport` (worked in shared tree per owner order; committed per slice, no merge)
Audit: security M4, L3 (http origin); networking M1, L1, L3; mastodon 3; misskey M9

**Goal.** Redirects cannot carry tokens to another origin, body reads obey
the timeout and abort, and plaintext `http` is limited to local targets.

**Read first.** `packages/fedi/src/core/http.ts` (whole), `core/errors.ts`,
`mastodon/client.ts:40-160,350-380`, `misskey/client.ts:200,292`,
`misskey/external.ts:80-100,160-190`, `core/detect.ts` (fetch sites).

**In scope.** The files above, `packages/fedi/src/core/errors.ts`, tests.

**Steps.**
- [ ] 1. Every `fetch` that can carry a credential sets `redirect: 'manual'`.
  A 3xx is mapped to a typed `FediError('errors.network.redirect', {status})`.
  Exception list (document in code): unauthenticated `.well-known`/NodeInfo
  discovery may follow same-origin redirects only (re-validate `response.url`
  origin; reject otherwise). Cover `core/http.ts`, `mastodon/client.ts`,
  `misskey/client.ts` (JSON and upload), `misskey/external.ts` `postDirect`,
  native username/password sign-in.
- [ ] 2. Keep `i` in the Misskey POST body (contract: Sharkey 400s on unknown
  fields; AGENTS.md). Record in DECISIONS that `Authorization: Bearer` was
  considered and rejected for contract reasons; the redirect refusal is the fix.
- [ ] 3. Body read inside the timeout/abort (M1): restructure so the timer
  and caller-abort listener are cleared in one outer `finally` after
  `response.text()` completes (core/http, mastodon/client, misskey/external
  `postDirect`, misskey upload). Fix the false "30s hard ceiling" comment.
  Test with a fake fetch whose body promise never resolves: the call rejects
  with `timeout` near the deadline.
- [ ] 4. `toApiError` (L1): map the transport error's `kind`/`code`/`params`
  through; never use free-form response `error` text as the stable code (keep
  it as `detail`). Align the Mastodon and Misskey families; add a shared test.
- [ ] 5. Replace `err instanceof DOMException` in `mastodon/client.ts` with the
  name check used in `core/http.ts` (mastodon 3 / networking L3). Test with
  `DOMException` deleted from the global.
- [ ] 6. `normalizeOrigin` / `normalizeHost` (security L3, misskey M9): accept
  `http:` only for `localhost`, `*.localhost`, loopback, RFC1918, link-local,
  `*.local`, and `10.0.2.2`; reject other `http` hosts with
  `FediError('errors.origin.insecure')`. Env escape hatch for the rig:
  `__DEV__` only. Update the login UI error mapping (code only).

**Acceptance.** Gates green; tests for 307/308 with a token (assert second request never made), body stall, http public host rejected, http localhost accepted.

## X2.3 - Auth, deep links, streaming origin

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x2.3.md`; ADR 0012; 243 suites / 3397 tests green at Wave-2 commit)
Branch: `repair25-x2.3-auth-links` (worked in shared tree per owner order; committed per slice, no merge)
Audit: security M3, M5, L1, L2; privacy 6; networking M5 (policy half), L5

**Goal.** No server-supplied string reaches `Linking.openURL` unvetted, the
streaming origin cannot exfiltrate the token, and the MiAuth callback risk is
recorded with every mitigation that does not need signing.

**Read first.** `src/screens/ChatThread.tsx:40-60`, `src/components/richtext/mentionRouting.ts`,
`packages/fedi/src/core/content/ast.ts:286-333`, `packages/fedi/src/mastodon/instance.ts:60-110`,
`mastodon/stream.ts:100-125`, `misskey/stream.ts:150-160`, `src/screens/Login.tsx:78-95`,
`AuthCallback.tsx:49-67`.

**In scope.** The files above, `docs/adr/0012-miauth-callback-risk.md`,
`docs/web-hosting.md` (new), tests.

**Steps.**
- [ ] 1. `openExternal` (and the one `Linking.openURL` in `ChatThread.tsx:51`)
  run the target through `safeUrl`/`safeHttpUrl` themselves (defence in depth);
  `ChatThread` vets `file.url` in the Misskey chat adapter too. Disallow
  `mailto:` in `openExternal` unless the caller passes `allowMailto`. Replace
  `showToast(String(e))` with a translated generic message (no URL echo).
  Test: `javascript:`, `tel:`, `intent://`, `file:`, `data:` are refused.
- [ ] 2. Streaming origin (privacy 6): accept `configuration.urls.streaming`
  only when its host equals the session origin host, is a subdomain of it, or
  is a sibling label under the same parent domain (>= 2 remaining labels);
  anything else is ignored and the REST origin is used, with the reason kept
  in `evidence` for the UI. Scheme-pin as today. Tests for equal, subdomain,
  sibling, foreign host, IP literal, and userinfo-bearing URLs.
- [ ] 3. Wiring the validated streaming origin into `createMastodonBackend` is
  X3.4 (it owns `api/client.ts`); here only the validator and the persisted
  field on the session `evidence` are added.
- [ ] 4. MiAuth (D7): write ADR 0012 recording the accepted risk (custom
  scheme interceptable on Android; fix needs App Links which need signing +
  a domain, out of scope). Mitigations in this slice: pending row must match
  host and scheme and be <= 15 min old; the callback is single-use
  (read-and-delete); Android `intentFilters` keep `autoVerify` off but
  restrict to exactly the `keystone` scheme + `auth` host/path; if the check
  returns an `account` whose host differs from the pending host, discard.
  Session id comes from X2.1's CSPRNG.
- [ ] 5. Misskey stream `?i=` (networking L5): add a test and a lint-style
  grep test that no `console`/logger call receives the stream URL; add a
  `redactUrl()` helper used by any debug output.
- [ ] 6. Web tokens (security L1, D2): `docs/web-hosting.md` documents that web
  tokens sit in `localStorage`, lists the required response headers (strict CSP
  with no `unsafe-inline`, `frame-ancestors 'none'`, `Referrer-Policy:
  no-referrer`, `X-Content-Type-Options`) and marks web as not
  release-ready without them.

**Acceptance.** Gates green; ADR 0012 written; tests per step.

## X2.4 - Outbound URL policy (SSRF / tracking)

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x2.4.md`; 231 suites / 3301 tests green at Wave-2 commit)
Branch: `repair25-x2.4-outbound-urls` (worked in shared tree per owner order; committed per slice, no merge)
Audit: privacy 5 (guard half); networking M9; richtext F7 (guard half)

**Goal.** One shared predicate decides whether the device may fetch a
server-influenced URL, and every such site uses it.

**Read first.** `packages/fedi/src/api/linkpreview.ts`, `misskey/remotepost.ts:100-130`,
`src/components/Post/PostCard.tsx:581,729-731,1065`, `src/components/Post/LinkCard.tsx`.

**In scope.** New `packages/fedi/src/core/urlPolicy.ts`, `api/linkpreview.ts`,
`misskey/remotepost.ts`, `src/components/Post/{LinkCard,PostCard}.tsx`
(call sites only), tests.

**Steps.**
- [ ] 1. `isPublicHttpsUrl(url)`: `https:` only (an `allowHttp` option for
  dev), no userinfo, port in {443, default}, host not an IP literal in
  loopback/RFC1918/CGNAT/link-local/ULA/multicast ranges (IPv4 and IPv6),
  not `localhost`, `*.localhost`, `*.local`, `*.internal`, no trailing-dot
  tricks, no decimal/hex/octal IP encodings (parse with `new URL`, then
  re-check `hostname`). Exhaustive table test (>= 40 cases including
  `http://[::1]/`, `http://2130706433/`, `https://127.1/`).
- [ ] 2. `linkpreview.ts`: use the predicate for the page URL **and** for
  preview image/icon URLs found in the fetched HTML. Stream-limit the body
  (read via `response.body` reader up to `PREVIEW_MAX_BYTES`, abort after);
  the timeout covers the body (reuse X2.2's pattern). `redirect: 'manual'`
  with a bounded manual follow that re-checks each hop with the predicate.
- [ ] 3. `remotepost.ts`: predicate before `fetch(uri)`; and stop resolving on
  mount for every card (networking M9): resolve lazily when the post menu
  opens (PostCard effect at ~729 removed; the menu action calls the resolver).
  Keep the existing bounded caches.
- [ ] 4. Test that a post containing `http://192.168.1.1/x` triggers no
  network call from either site.

**Acceptance.** Gates green; no request is made for a rendered feed row until the menu opens (test asserts the fetch mock call count is 0).

## X2.5 - Privacy defaults and surfaces

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x2.5.md`; 243 suites / 3397 tests green at Wave-2 commit)
Branch: `repair25-x2.5-privacy-defaults` (worked in shared tree per owner order; committed per slice, no merge)
Audit: privacy 5 (default half), 9, 10, 12, 13; richtext F7 (UI half)

**Goal.** Private content is not beaconed, translated, or shared by surprise.

**Read first.** `src/components/Post/{PostCard,LinkCard,useAutoTranslation}.ts(x)`,
`menuModel.ts:300-333`, `src/storage/schema.ts` (prefs), `src/components/Settings/*`
(pattern for a toggle).

**In scope.** The files above, a new `src/state/privacyShield.ts` + its host
component, `src/components/Settings/PrivacySection.tsx` (new or existing
equivalent), `src/components/Post/menuModel.ts`, tests.

**Steps.**
- [ ] 1. Link previews (D5): default to **tap-to-unfurl**. Pref
  `linkPreviews: 'tap' | 'auto-public' | 'off'`, default `'tap'`. Never auto
  unfurl for `direct`/`followers`/`specified` posts regardless of pref. The
  preview image/icon load only after the user taps. Server-provided cards
  (from the user's own server) keep working as today.
- [ ] 2. Auto-translate: no automatic translation for `direct`/`followers`/
  `specified` posts; manual translate shows a one-line notice the first time
  ("sent to your server") via `msg`.
- [ ] 3. Share/copy (privacy 10): for non-public posts the Share and Copy rows
  show a confirm ("This post isn't public") before invoking the sheet/clipboard.
- [ ] 4. Privacy shield (D6): pref `privacyShield: boolean`, default **off**.
  When on, an opaque overlay is drawn on `AppState` `inactive`/`background`
  (blur-free, branded), so the OS app-switcher snapshot shows nothing. Always
  on while a DM/chat/conversation screen is focused (flag from the screen).
  Android `FLAG_SECURE` is out of scope (needs a native module); note it.
- [ ] 5. Custom emoji tracking (richtext F7, UI half): `EmojiImage` only loads
  a node `src` that matches a URL in the post's `emojis[]`; otherwise render
  the `:code:` text. (The content-AST side is X6.4.)
- [ ] 6. Privacy 13: add a test asserting no logger call includes a request
  body or token (reuse the redact helper).

**Acceptance.** Gates green; tests for the pref matrix (`tap`/`auto-public`/`off` x visibility); overlay test with a mocked `AppState`.

---

# Wave 3 - networking resilience

## X3.1 - Cancellation end to end

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x3.1.md`; 248 suites / 3465 tests green at Wave-3 commit)
Branch: `repair25-x3.1-cancellation` (worked in shared tree per owner order; committed per slice, no merge)
Audit: networking M2

**Goal.** React Query's `signal` cancels in-flight network work.

**Read first.** `packages/fedi/src/core/backend.ts` (`PageOpts` and method
signatures), `core/http.ts` (`signal` support), `misskey/client.ts:88`,
`src/state/queries/usePostFeedQuery.ts:223`.

**In scope.** `core/backend.ts`, `mastodon/{backend,client,endpoints}.ts`,
`misskey/{backend,client}.ts`, `src/state/queries/*` (the `queryFn` bodies),
tests.

**Steps.**
- [ ] 1. Add `signal?: AbortSignal` to `PageOpts` and to single-shot read
  methods (`post`, `account`, `thread`, `relationship`, `search.*`,
  `notifications`, `me`). Mutations are **not** cancelled by unmount.
- [ ] 2. Thread `signal` through `MastoClient.request`, `MisskeyClient.call`,
  and uploads (uploads use X7.4's controller).
- [ ] 3. Every `queryFn: ({signal}) => backend.x(..., {signal})` in
  `src/state/queries/*`. A caller abort surfaces as `kind: 'aborted'` and is
  not retried and not shown as an error.
- [ ] 4. Tests: unmount a screen mid-request -> fetch mock sees `signal.aborted`;
  switching accounts aborts the previous session's requests.

**Acceptance.** Gates green; test count of `queryFn`s that ignore `signal` is zero (grep-style test).

## X3.2 - Online and foreground awareness

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x3.2.md`; 250 suites / 3496 tests green at Wave-3 commit)
Branch: `repair25-x3.2-online-focus` (worked in shared tree per owner order; committed per slice, no merge)
Audit: networking M3, M7

**Goal.** Offline queries pause and resume; the app refreshes on foreground;
streams catch up after a gap.

**Read first.** `src/state/queries/Provider.tsx`, `src/state/streaming.ts`,
`docs/adr/0008-sdk-57-pin.md`, SDK 57 `bundledNativeModules.json`.

**In scope.** `package.json` (one dep, per D10), `Provider.tsx`,
new `src/state/queries/lifecycle.ts`, `src/state/streaming.ts`, tests,
`docs/DECISIONS.md`.

**Steps.**
- [ ] 1. `onlineManager.setEventListener` wired to the chosen network lib;
  web uses `navigator.onLine` + events.
- [ ] 2. `focusManager` wired to `AppState` (native) and
  `visibilitychange` (web). Re-enable `refetchOnWindowFocus` only for feed,
  notifications, and `me` queries with a 60 s minimum gap (use per-query
  `staleTime`, not a global flip).
- [ ] 3. Stream handles listen to `AppState`: on background, close sockets
  after 30 s; on foreground, reconnect immediately.
- [ ] 4. Gap fill (M7): on `reconnecting -> connected`, invalidate that
  session's feed and notification queries (first page only).
- [ ] 5. Coalesce `onUpdate` fetches (M7): per-post-id trailing debounce
  (250 ms), keep only the latest in-flight request, and ignore a response
  older than the newest request's start. Test: burst of 20 events for one post
  produces <= 2 requests and the final state matches the last response.

**Acceptance.** Gates green; tests drive a fake `AppState`/network source.

## X3.3 - Paging storm and refetch fan-out

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x3.3.md`; 248 suites / 3465 tests green at Wave-3 commit)
Branch: `repair25-x3.3-paging` (worked in shared tree per owner order; committed per slice, no merge)
Audit: networking H2, L6; rn-ui L1, L4

**Goal.** A failed page never causes a request loop; 429 is honoured.

**Read first.** `src/screens/HomeFeed.tsx:220-240,405-445`,
`Notifications.tsx:430-440`, `Recommendations/RecommendationsFeed.tsx:65-80`,
`Conversations.tsx:115-125`, `ChatThread.tsx:205-215`,
`src/components/PostFeed/PostFeed.tsx:60-140`, `state/queries/retry.ts`.

**In scope.** Those files, `src/state/queries/retry.ts`, a new
`src/state/queries/usePagedLoad.ts` helper, tests.

**Steps.**
- [ ] 1. `usePagedLoad(query)` returns an `onEndReached` that no-ops when
  `!hasNextPage || isFetchingNextPage || isFetchNextPageError || coolingDown`.
  It latches with a ref until `isFetchingNextPage` goes true then false, so
  burst events call once. Use it in HomeFeed (both call sites), Notifications,
  RecommendationsFeed, Conversations, ChatThread, and PostFeed.
- [ ] 2. 429 handling: read `retryAfterMs` from the `ApiError`; `coolingDown`
  stays true until it elapses (visible countdown in the footer via `msg`/
  `plural`). Only the explicit Retry button clears `isFetchNextPageError`.
- [ ] 3. Pull-to-refresh on infinite queries: before `refetch()`, trim to the
  first page (`setQueryData` with `pages.slice(0,1)`), so refresh costs one
  request not N.
- [ ] 4. Pagination `end` heuristics (L6): Mastodon `parseLinkHeader` robust
  comma-safe parsing is X4.4; Misskey `pageOf` is X5.2. Here: document in the
  helper that only "no cursor or empty page" ends a feed.

**Acceptance.** Gates green; test: error state + 20 scroll events = 0 extra requests; 429 with `Retry-After: 30` suppresses paging for 30 s (fake timers).

## X3.4 - Streams

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x3.4.md`; 254 suites / 3520 tests green at Wave-3 commit)
Branch: `repair25-x3.4-streams` (worked in shared tree per owner order; committed per slice, no merge)
Audit: networking M4, M5, M6, L4, L7; misskey M12, M13; mastodon 13, 14

**Goal.** Streaming is stable, pooled, observable, and applies deletes.

**Read first.** `packages/fedi/src/mastodon/stream.ts`, `misskey/stream.ts`,
`mastodon/backend.ts:290-310,1423-1433`, `misskey/backend.ts:916-926`,
`api/client.ts:195-265`, `src/state/streaming.ts`,
`src/screens/HomeFeed.tsx:55-70`, `src/state/queries/usePostFeedQuery.ts:200-225`,
`docs/mastoapi-contract.md:370-376`.

**In scope.** The files above, tests.

**Steps.**
- [ ] 1. Breakers (M4): reset `fastCloses`/`attempt`/backoff only after the
  socket has stayed open longer than the fast-close window (decide in the
  `close` handler from `now - openedAt`), never in `open`. Both families.
  Test: server that accepts then closes immediately -> breaker trips after N
  cycles and status becomes `stopped`.
- [ ] 2. Misskey: connect timeout (10 s) and ping/pong liveness (two missed
  pongs -> reconnect). `armAckTimeout` starts only after the message is actually
  sent; queue subscribe messages until `open` (L4). `unavailable`
  subscriptions retry on the next `connected` (M13); `release()` on an idle
  pool reports `idle`, not `connecting`.
- [ ] 3. Wrap each handler in the dispatch loop in try/catch; validate `user`
  presence before `adaptNote` (M12). A malformed event is dropped and counted
  in a dev counter, never thrown out of the socket listener.
- [ ] 4. Pooling (M6): memoise one `Backend` and one stream handle per
  session id, keyed on `(sessionId, token, flavor, evidence hash)`, in a
  registry next to the token map. `backend.stream()` returns the shared
  pooled handle; N feeds + notifications + chat share one socket per family.
  `useBackendForSessionId` and `usePostFeedQuery` (L7) memoise on the session
  object, not the whole snapshot, so a permission-denied note or health
  refresh does not redial.
- [ ] 5. Wire `streamingOrigin` (M5): `backendForSession` / `activeBackend`
  pass the validated origin from X2.3. Test with a split-host fixture.
- [ ] 6. Mastodon stream deletes (mastodon 13): give `Entry` a real
  `deletes` subscription API; `streaming.ts` removes the post from the session's
  feed caches via `patchPostInCaches`. Update
  `mastodon-stream-delete.test.ts` to the new contract (record the changed
  expectation in the log).
- [ ] 7. Mastodon subprotocol auth (mastodon 14): do **not** add a token-in-
  URL fallback (privacy). Add a `scripts/fedi-smoke` probe that records whether
  the handshake succeeds on the rig; mark `not verified (owner live-tests
  externally)` and list it in X12.1.

**Acceptance.** Gates green; fake-socket tests for each numbered step.

## X3.5 - Boot never blocks

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x3.5.md`; 248 suites / 3465 tests green at Wave-3 commit)
Branch: `repair25-x3.5-boot` (worked in shared tree per owner order; committed per slice, no merge)
Audit: rn-ui M6

**Goal.** A stalled network can never leave a blank app.

**In scope.** `src/Root.tsx`, `packages/fedi/src/core/config.ts:153-189`,
`src/state/session/store.ts` (`verifyActive` timeout only), a boot `Loader`
component use, tests.

**Steps.**
- [ ] 1. Timeouts: `loadRuntimeConfig` 5 s (fail open to defaults);
  `verifyActive` 8 s (fail open as `network`, keep the session, never drop on
  timeout).
- [ ] 2. `Root` renders a `Loader` (translated accessible label) instead of
  `null` until ready; add a "Taking longer than usual" line after 3 s (`msg`).
- [ ] 3. Test with fetch mocks that never resolve (fake timers): app reaches
  `ready` after the cap.

**Acceptance.** Gates green; blank-screen repro `not verified (device)`.

---

# Wave 4 - Mastodon correctness

Run in order (shared `backend.ts`). Read the cited sections of
`results/mastodon.md` before each slice. Where server behaviour is cited
from API docs only, add the fixture-based test **and** list a live-server
check in X12.1.

## X4.1 - Notification dismiss and types

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x4.1.md`; 254 suites / 3530 tests green at Wave-4 commit)
Branch: `repair25-x4.1-notif-dismiss` (worked in shared tree per owner order; committed per slice, no merge)
Audit: mastodon 1, 12

**Steps.**
- [ ] 1. Keep `group_key` and `most_recent_notification_id` on the adapted
  `Notification` `ext`. For a grouped row: `DELETE /api/v2/notifications/:group_key`
  (capability-gated on v2); ungrouped: v1 `POST .../dismiss` with the numeric id.
- [ ] 2. `Notifications.tsx:252-264`: stop treating any 404/405 as "unsupported".
  Unsupported is decided by capability/probe only; a 404 on a specific id is a
  normal "already gone" result (remove the row, no hiding).
- [ ] 3. Map the missing types (`status`, `update`, `quoted_update`,
  `admin.sign_up`, `admin.report`, `severed_relationships`,
  `moderation_warning`, Akkoma `move`) to core kinds (`status` -> existing
  `note`; others to new kinds with account-less rendering). `rawType` is never
  shown to the user: unknown types render a translated generic row ("New
  activity") - the literal comes from Wave 9 but add it now via `msg`.
- [ ] 4. Tests: add grouped dismiss and the new types to
  `mastodon-grouped.test.ts` and `NotificationsActions.test.tsx`.

**Acceptance.** Gates green; live check listed.

## X4.2 - Search resolve, capabilities, family detection

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x4.2.md`; 254 suites / 3541 tests green at Wave-4 commit)
Branch: `repair25-x4.2-search-caps` (worked in shared tree per owner order; committed per slice, no merge)
Audit: mastodon 4, 5, 6, 16

**Steps.**
- [ ] 1. `SearchV2Options.resolve`; `search.accounts`/`search.posts` send
  `resolve=true` when the query is a URL or contains a handle shape, only for
  authenticated sessions. Autocomplete `@` suggestions stay local (no resolve).
- [ ] 2. `accountFeaturedPosts` allowed for `mastodon` (and keep Akkoma);
  fix the `endpoints.ts:593` comment.
- [ ] 3. `polls_multi: "supported"` for mastodon in `core/detect.ts:461`;
  Akkoma/Pleroma `unknown` -> confirm via fixtures or leave `unknown`
  (honest, not a guess). Composer already reads the flag.
- [ ] 4. Family detection (16): when NodeInfo fails, a v2 `/instance` body with
  `configuration.urls.streaming` and no `pleroma` key resolves to `mastodon`
  with `evidence: 'instance-v2-shape'`. Add a fixture.
- [ ] 5. Tests for each.

## X4.3 - Polls

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x4.3.md`; ADR 0013; 254 suites / 3549 tests green at Wave-4 commit)
Branch: `repair25-x4.3-polls` (worked in shared tree per owner order; committed per slice, no merge)
Audit: mastodon 7, 20, 22 (poll min); misskey M16

**Steps.**
- [ ] 1. **ADR first** (next free number after 0012; check `docs/adr/README.md`): `PollOption.votesCount`
  widens to `number | null` (null = hidden). Mastodon adapt stops defaulting to
  0; Misskey adapt keeps numbers.
- [ ] 2. `PostPoll.tsx`: render "hidden until closed" (via `msg`) for null; no
  bar, no fake zero.
- [ ] 3. Map `poll.emojis`; render option titles through the shared emoji
  pipeline.
- [ ] 4. `poll.expired`/closing computed at render time from `expiresAt`
  (both families); remove the frozen `expired` snapshot reliance.
- [ ] 5. Compose side: clamp `expires_in` to Mastodon's minimum (300 s) and
  validate in the composer (message through `msg`); never send `0`.
- [ ] 6. Tests: hidden totals, emojis, expiry crossing the deadline with fake timers.

## X4.4 - Notifications read state, lists, drafts, pagination, robustness

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x4.4.md`; steps 1-6+8+9 landed, step 7 revocation blocked → tracked follow-up; 258 suites / 3597 tests green at Wave-4 commit)
Branch: `repair25-x4.4-mastodon-misc` (worked in shared tree per owner order; committed per slice, no merge)
Audit: mastodon 9, 10, 11 (backend half), 15, 17, 18, 19, 21, 22

**Steps.**
- [ ] 1. Read state (9): read `GET /api/v1/markers?timeline[]=notifications`
  and derive `read` per row (compare against `last_read_id`; for v2 groups use
  `page_max_id`/`most_recent_notification_id`). If a server has no markers,
  hide "mark read" (capability) rather than ship an inert control.
- [ ] 2. `lists.timeline` honours `cursors` continuations via the same helper
  `bookmarks.list` uses (10). Test with the Akkoma cross-origin Link fixture.
- [ ] 3. `PostDraft` gains `sensitive?: boolean` and `language?: string`;
  `StatusBody` sends them; `uploadMedia`'s ignored `isSensitive` is removed from
  the Mastodon signature (11). The composer toggle is in X6.2.
- [ ] 4. Nested quotes (15): when a quote lacks `quoted_status` but has
  `quoted_status_id`, mark `quoteUnavailable: false, quoteRef: id` and let the
  quote resolver fetch it lazily; add `quoted_status_id` to `wire.ts`.
- [ ] 5. Robustness (17): wrap per-row adaptation in `endpoints.ts`
  (`timeline`, `account statuses`, `search`, `conversations`) with `isStatusRow`
  guards that **skip and count** a bad row instead of failing the page.
- [ ] 6. `parseLinkHeader` (18): regex-based entry parsing (no comma split);
  add `pagination.test.ts` covering commas in hrefs, missing rel, relative URLs,
  cross-origin fallback. Delete the dead exports named in the audit
  (`fallbackMaxId`, `nextLink`, `prevLink`, `writeCapabilities`,
  `buildStatusBody`, `feedClient`) if unused outside tests; if a test is their
  only caller, delete the test with them and record the count delta.
- [ ] 7. Token revocation (19): store the `client_id`/`client_secret` that
  issued each token on the session (vault) and revoke with those, not the
  current cached app.
- [ ] 8. D4: keep `avatar_static`; add a pref `animateAvatars` only if it is
  a < 20-line change; otherwise record the decision in DECISIONS.
- [ ] 9. Small gaps (22): multi-tag timelines (`any[]`/`all[]`), featured tags
  for other accounts, scheduled-status edit (`PUT`), `favourited_by` list.
  Each is capability-gated and added only where an existing UI surface already
  has a slot; otherwise file `docs/tasks/mastodon-small-gaps.md` listing them
  as follow-ups with the audit reference (explicitly tracked, not silently dropped).

**Acceptance.** Gates green; fixtures added for each path.

## X4.5 - Notification requests and policy (feature, D8)

Status: done (2026-10-25; log `state/logs/2026-10-25-repair25-x4.5.md`; D8=yes built; 260 suites / 3634 tests green at Wave-4 commit)
Branch: `repair25-x4.5-notif-requests` (worked in shared tree per owner order; committed per slice, no merge)
Audit: mastodon 12 (policy/requests)

**Goal.** Mastodon 4.3+ files non-follower notifications under "requests";
without support they are invisible. Make them reachable.

**Steps.**
- [ ] 1. Task file `docs/tasks/p-notification-requests.md`.
- [ ] 2. Backend: `GET /api/v1/notifications/requests`, accept/dismiss
  (`.../:id/accept`, `.../dismiss`), `GET/PATCH /api/v2/notifications/policy`,
  capability `notification_requests` (probe, not flavor guess).
- [ ] 3. UI: a "Filtered notifications" entry on the Notifications screen
  with a count badge, a list, accept/dismiss actions, and a small policy
  settings section. All strings via `msg`.
- [ ] 4. Tests with fixtures; live check listed for X12.1.

**Acceptance.** Gates green. If the owner says no on D8, mark `won't do (D8)` and skip.

---

# Wave 5 - Misskey / Sharkey correctness

Misskey/Sharkey sources are not in the repo and the rig is refused to
agents. Every wire-shape change here is **tolerant** (accept both the old and
new shape) and ships a fixture; X5.6 gets real fixtures from the owner.

## X5.1 - Wrapper-row account lists

Status: not started
Branch: `repair25-x5.1-wrapper-rows`
Audit: misskey M1

**Steps.**
- [ ] 1. `users/followers` -> unwrap `follower`; `users/following` -> `followee`;
  `mute/list` -> `mutee`; `blocking/list` -> `blockee`. Page cursor stays the
  **row** id (`untilId`); map after `pageOf`. Skip rows without a string-id
  user (same guard as `renoteMutes.ts`).
- [ ] 2. Tolerant: if a row already looks like a bare user (has `username` and
  no wrapper key), adapt it as-is, so a fork returning bare users still works.
- [ ] 3. Fix `misskey/mutes.ts` (or delete the dead helpers and export the
  backend path instead); fix `docs/api-surface.md:88,92`.
- [ ] 4. Tests: wrapper rows (followers, following, mutes, blocks), bare rows,
  mixed, malformed. Row id vs user id: assert follow/unfollow targets the user id.

## X5.2 - Search paging, end detection, guards

Status: not started
Branch: `repair25-x5.2-misskey-paging`
Audit: misskey M2, M10, M15; networking L6 (Misskey half)

**Steps.**
- [ ] 1. `users/search`: page by `offset` (cursor encodes the offset); drop
  the unused `untilId` cursor; apply to `suggestAccounts` as well.
- [ ] 2. `pageOf`: `end` only when the page is empty (or a server `hasMore`
  flag exists); a short non-empty page does not end the feed. Review every
  caller for loops (a page that returns the same items must still terminate:
  stop when a page adds no new ids).
- [ ] 3. Guards: `isPureRenote` uses `(note.fileIds ?? [])`; skip favourite rows
  without a note; `res?.count` in `serverDrafts`; `adaptNote(row.note)` guarded.
- [ ] 4. Tests: >= 2 pages of search, short-page-not-end, missing `fileIds`.

## X5.3 - Reaction emoji URL lookup

Status: not started
Branch: `repair25-x5.3-reaction-emoji`
Audit: misskey M3

**Steps.**
- [ ] 1. `adaptReactions` resolves `url` with the tolerant
  `lookupPackedEmojis` (exact key, then bare `name@host`, then `name`); move the
  helper into `core` so both adapter and UI share it.
- [ ] 2. `postActions.ts:150-156,208-213` use the same lookup so a custom
  reaction coming back from the server is not treated as unresolved.
- [ ] 3. Fixtures: add a bare-key packed-map fixture next to the colon-wrapped
  one; both must resolve. (Real capture: X5.6.)

## X5.4 - Capabilities and edit semantics

Status: not started
Branch: `repair25-x5.4-misskey-caps-edit`
Audit: misskey M4, M5, M6, M17 (like)

**Steps.**
- [ ] 1. `status_editing`: `supported` only for Sharkey/Catodon-family flavors;
  stock `misskey` = `unknown` resolved by an endpoint probe (`notes/edit`
  OPTIONS/422 probe, recorded in `evidence`). Same review for
  `scheduled_posts` and `server_drafts` on the plain `misskey` row. Never rely
  on a failing call for gating.
- [ ] 2. `notes/edit` tolerant parse: accept `{createdNote}` or a bare note;
  send both `noteId` and `editId` only if a fixture/probe shows both are
  needed - default to the documented param and record `not verified (owner
  live-tests externally)`.
- [ ] 3. Edit that removes all attachments or clears a poll: send explicit
  `fileIds: []` and `poll: null` when the edit state says "none" (consistent
  with the explicit-null rule for text/cw); keep omit-when-unchanged otherwise.
- [ ] 4. `like`: capability `unknown` (not `unsupported`) for Misskey rows so
  the lazy `backend.like.isSupported()` probe can raise it; UI gates on the
  resolved value.
- [ ] 5. Tests with both response shapes; capability matrix test.

## X5.5 - Auth, quote resolver, account fields

Status: not started
Branch: `repair25-x5.5-misskey-misc`
Audit: misskey M7, M11, M14

**Steps.**
- [ ] 1. `revokeSessionToken`: POST `i/revoke-token` with `{i, token}`
  (and `tokenId` if known); return `false` on non-2xx and surface it to the
  caller so sign-out can show "couldn't revoke on server" (message via `msg`).
  Fix the test that pins `{i}` only.
- [ ] 2. `quote.ts:355-375`: `try/finally` around `adaptNote`; always delete
  the in-flight entry; cap `failedAt` with `evictOldest`; add a TTL to
  failures. Test: adapt throws once, the next call retries.
- [ ] 3. `movedTo` mapped from the wire (`movedTo` URI) with the account-moved
  banner enabled; `alsoKnownAs` stays in `ext`. Fixture + test.

## X5.6 - Real fixtures and a capture script

Status: not started
Branch: `repair25-x5.6-capture-fixtures`
Audit: misskey test/fixture gaps; mastodon test gaps

**Goal.** Replace synthesised Misskey/Sharkey fixtures with recorded ones so
tests can catch wire-shape errors. Agents cannot reach the rig; the owner runs
the script.

**Steps.**
- [ ] 1. `scripts/fedi-capture.ts`: against a given server and token, records
  (redacted: tokens, emails, IPs) responses for the endpoints touched in X5.1-
  X5.5 plus `i`, `notes/create`, `notes/edit`, a reaction note, `users/followers`,
  `mute/list`, `blocking/list`, `users/search`, chat, and Mastodon
  `notifications` v1/v2, markers, `statuses` with polls (hidden totals), nested
  quotes. Writes to `packages/fedi/test/fixtures/<family>/` with
  `source: recorded`, server version and date in `manifest.json`.
- [ ] 2. A redaction unit test (golden): no `Bearer`, `token`, or email-shaped
  string survives.
- [ ] 3. `docs/setup.md` section "Recording fixtures"; add the exact owner
  command to X12.1.
- [ ] 4. Add the missing test files listed in `results/misskey.md` ("Test and
  fixture gaps") and `results/mastodon.md` (last bullet): signinFlow/mintAppToken
  error branches, `normalizeHost` http handling, revoke body, malformed stream
  events, ack-timeout recovery, quote adapt failure, dismiss grouped, shallow
  quote, hidden polls, list cursors, `parseLinkHeader`, `resolve=true`, abort
  behaviour. Where an earlier slice already added one, do not duplicate.

**Acceptance.** Gates green; the capture script's dry-run mode (against a local stub server) passes in CI.

---

# Wave 6 - content, link safety, composer

## X6.1 - Composer edit mode

Status: not started
Branch: `repair25-x6.1-composer-edit`
Audit: richtext F1, F2, F3

**Read first.** `src/components/Composer/Composer.tsx:230-300,330-350,480-540,660-745`,
`ComposerSections.tsx:230-290`, `src/state/queries/composer.ts:230-270`.

**Steps.**
- [ ] 1. F1: `keepMediaIds = [...state.media.map(m => m.id), ...uploadedIds]`
  always (an empty array means "no media" and the backend sends it explicitly,
  per X5.4); fall back to `editing.mediaIds` only when the seed is missing.
  Tests: 2 existing + 1 new keeps 3; removing the only attachment removes it.
- [ ] 2. F2: in edit mode, no autosave, no open-draft pointer writes, no
  "Save as draft"; `isCloseDirty` is a diff against the seeded post (text, CW,
  media ids, poll, visibility). Tests: unedited edit closes silently; a killed
  edit does not prefill the next new post.
- [ ] 3. F3: while `busy`, disable Remove, alt-text, add-media, poll,
  visibility, and CW controls (with `disabledReason` via `msg`).
  `uploadAll` skips keys no longer in `files` and never attaches a removed
  upload's id. Alt edits read from a ref, not a stale closure.

**Acceptance.** Gates green; each numbered behaviour has a failing-before test.

## X6.2 - Composer limits, validation, drafts, defaults

Status: not started
Branch: `repair25-x6.2-composer-validation`
Audit: richtext F9, F10, F11, F12, F13 (drafts, insertCreatedPost); media M8; privacy 4, 7; rn-ui L2; mastodon 8 (UI half), 11 (UI half)

**Read first.** `packages/fedi/src/api/composer.ts` (whole), `Composer.tsx`,
`src/state/queries/composer.ts`, `src/storage/drafts.ts`,
`Composer/pickMedia.ts`.

**Steps.**
- [ ] 1. `fetchComposeLimits` returns a full `ComposeLimits`: chars, CW chars,
  max attachments, image/video byte caps (Mastodon
  `configuration.media_attachments`, Misskey meta/`i` drive capacity), poll
  limits (max options, option length, min/max expiry). Limits carry
  `source: 'server' | 'fallback'`. Retry on failure (backoff). When
  `fallback`, the composer shows "limit unverified" (via `msg`) and **does not
  hard-block** posting (F10).
- [ ] 2. Replace the hard-coded `MAX_MEDIA_BYTES` with per-kind server caps;
  messages use the real number (formatted by the X9.5 size formatter; until
  then via `Intl.NumberFormat`, no literal "10 MB"). Keep a conservative
  heap-protection cap only where `fileSize` is unknown *and* the platform
  cannot stream (X7.4 removes the whole-file read on native).
- [ ] 3. Validation (F11): Misskey CW length; poll option length, duplicates,
  duration bounds, option count from limits; scheduled time >= 5 minutes ahead
  for Mastodon; Mastodon URL counting trims trailing punctuation the way the
  server does (fixture: `see https://x.y/a.` counts 23 + the rest); Misskey
  `specified` recipients validated against the picked recipient list, not a
  `/@\w/` text match.
- [ ] 4. Default visibility (privacy 4): read Mastodon
  `verify_credentials.source.privacy`/`source.sensitive`/`source.language` and
  Misskey `i.defaultNoteVisibility`/`defaultNoteLocalOnly`; pass `preferredRaw`
  to `defaultVisibilityFor` in `Composer.tsx:301,441` and `Note.tsx:353`.
  Replies still never widen the parent. Tests for each preference value and
  an unknown raw value (falls to the narrowest known, never `public`).
- [ ] 5. Sensitive/language UI (mastodon 11): a "Mark media sensitive" toggle
  and a language picker (capability-gated), wired to X4.4's draft fields.
- [ ] 6. Idempotency (mastodon 8): the composer holds one `attemptKey` per
  logical attempt, resets it on any body change, and passes it in the draft
  (backend side in X2.1).
- [ ] 7. Drafts (privacy 7, F13, rn-ui L2): 30-day TTL (swept at boot);
  `direct`/`specified` drafts are not autosaved to disk unless the user taps
  Save (and are labelled); a notice (via `msg`) when the 26th draft evicts the
  oldest; flush the pending autosave in the effect cleanup when not posted.
- [ ] 8. Autocomplete regex uses `[\p{L}\p{N}_.@-]` with the `u` flag (F12) and
  computes the replace range from the same pattern; test `#日本語`, `#café`, `@josé`.
- [ ] 9. `insertCreatedPost` (F13) routes by visibility/type: `direct` and
  `followers` posts never prepend to Home/Social caches; replies only to their
  thread/profile caches; `home`/`unlisted` never into Social.

**Acceptance.** Gates green; table-driven tests for limits and validation.

## X6.3 - Content parser hardening

Status: not started
Branch: `repair25-x6.3-parser`
Audit: richtext F4, F5, F13 (fidelity, quadratic); misskey M17 (fn)

**Read first.** `packages/fedi/src/core/content/{fromHtml,fromMfm,ast,fields}.ts`,
`src/components/RichText.tsx:100-145`.

**Steps.**
- [ ] 1. HTML depth (F5): iterative or depth-capped walkers; past depth 32
  degrade to the node's plain text; whole `contentFromHtml` wrapped so it
  returns `[text(plain)]` on any throw (contract: never throws); input cap
  200 KB. Replace repeated string concatenation in `pushText`/`pushFieldText`
  with an array join (quadratic fix). Tests from the measured cases:
  `"<b>".repeat(5000)`, `"<ul><li>".repeat(3000)`, `"<blockquote>".repeat(3000)`,
  100k adjacent spans (assert < 300 ms).
- [ ] 2. MFM size (F4): clamp accumulated size in `RichText.tsx` to
  `baseSize * 4`; in `fromMfm.convertNode` flatten `fn` size names (`x2`..`x4`,
  `scale`) past nesting depth 2 and cap total fn depth at 8. Test: 20 nested
  `$[x4 ]` renders <= 4x base.
- [ ] 3. MFM functions: add `ruby`, `unixtime`, `fg`, `bg`, `border`,
  `position`, `crop`, `flip`, `mirror`, `sparkle`, `jump`, `twitch` to
  `KNOWN_FN`; `ruby`/`unixtime`/`fg` render properly (unixtime formatted via
  the X9.5 formatter), purely decorative ones degrade to children without losing
  text. Colour/numeric args stay allow-listed and clamped.
- [ ] 4. Fidelity (F13): ordered lists number their items; table cells get
  separators; non-emoji `<img alt>` falls back to its alt text as text.

**Acceptance.** Gates green; perf assertions in tests.

## X6.4 - Link and emoji disclosure, line clamp

Status: not started
Branch: `repair25-x6.4-link-disclosure`
Audit: richtext F6, F7 (AST half), F8

**Steps.**
- [ ] 1. Link label vs target (F6): when a link's visible text looks like a
  URL or host and its host differs from `href`'s host, the AST marks the node
  `mismatch: {labelHost, targetHost}`; `RichText` shows the real host after the
  label (e.g. "bank.com -> evil.example") and opens normally; on press for a
  mismatch, show a one-tap confirm with the real URL (strings via `msg`).
- [ ] 2. Mention chips (F6): render the profile chip only when the label parses
  as a handle or `acctFromProfileUrl(href)` succeeds; else render a plain
  link (with step 1's disclosure).
- [ ] 3. Emoji image (F7 AST half): `convertEmojiImage` keeps `src` only when
  `https:`; the renderer-side match against `emojis[]` is X2.5 step 5. Test:
  `http://tracker/p.gif` becomes literal `:a:` text.
- [ ] 4. `numberOfLines` (F8): when set and the tree has block nodes, render
  the plain-text projection clamped to N lines (or truncate to the first N
  blocks and apply the clamp to the first text run). Tests: code fence and
  blockquote previews stay within N lines.

**Acceptance.** Gates green; component tests for the three link cases.

## X6.5 - Composer UI layout checks

Status: not started
Branch: `repair25-x6.5-composer-device`
Audit: rn-ui L5

**Goal.** One keyboard-compensation mechanism per platform.

**Steps.**
- [ ] 1. In `Compose.tsx:66-131` and `Composer.tsx:84-100` choose one of
  `KeyboardAvoidingView` / explicit padding / maxHeight per platform; set
  `android.softwareKeyboardLayoutMode` in `app.config.js` explicitly
  (note: `app.config.js` is owned by X1.6 earlier; this is a one-line change
  after it merges).
- [ ] 2. Document the chosen mechanism in a comment and a short note in the
  log. Behaviour on device is `not verified (device)` and goes on the X12.1
  checklist.

**Acceptance.** Gates green; unit test that exactly one mechanism is active per `Platform.OS` (render-prop inspection).

---

# Wave 7 - media

## X7.1 - Lightbox rewrite

Status: not started
Branch: `repair25-x7.1-lightbox`
Audit: media M1, M2, M3, M4, M14 (re-check), M15 (lightbox half); rn-ui H1; a11y 1, 13

**Read first.** `src/components/Lightbox.tsx` (whole), `PostCard.tsx:1030-1050`,
`motion.ts`, `docs/image-sizing.md`.

**Steps.**
- [ ] 1. **Open at the tapped index** (the headline bug): initial offset and
  `scrollTo` on `[index, width]` change. Regression test: open with `index=2`
  on 4 frames, assert the visible frame, counter, caption, and the *playing*
  video are all frame 2 (test through the extracted pure `frameOffset` +
  a component render with a mocked `ScrollView`).
- [ ] 2. Windowed rendering: mount only active +/-1 frames (FlatList with
  `initialScrollIndex`, `getItemLayout`, `windowSize` 3); a player exists only
  for the active (and prefetch) frame and is released otherwise.
- [ ] 3. Rotation/resize: re-sync offset to the current frame.
- [ ] 4. Web paging: Prev/Next buttons, ArrowLeft/ArrowRight, Escape, Home/End;
  focus is trapped in the lightbox while open and returns to the opener on
  close.
- [ ] 5. Zoom/pan/dismiss: pinch-to-zoom and double-tap on native (gesture
  handler or `ScrollView` zoom on iOS), wheel/pinch zoom on web, swipe-down to
  dismiss (respect reduced motion).
- [ ] 6. Sensitive re-check inside the lightbox: if a frame is sensitive and
  not yet revealed in the opener, show the cover (not the media).
- [ ] 7. Accessibility: `accessibilityViewIsModal`, `role="dialog"`/`aria-modal`,
  counter is a live region ("Image 3 of 4" via `plural`/`msg`), Close label via
  `msg`, `accessibilityLabel` falls back to `mediaAlt` not the bare kind.
- [ ] 8. Image source: use `previewUrl` first, upgrade to full on settle.

**Acceptance.** Gates green; tests for each; device gestures `not verified (device)` on the X12.1 list.

## X7.2 - Player lifecycle

Status: not started
Branch: `repair25-x7.2-players`
Audit: media M5, M15 (audio target)

**Steps.**
- [ ] 1. `src/state/activePlayer.ts`: global "one playing at a time" store;
  starting a player pauses the previous one.
- [ ] 2. Viewability-driven `active` for `LoopTile` (gifv) via the list's
  viewability callback passed down from the feed (`autoplayIndex` removed);
  pause on scroll-off, blur (navigation focus), unmount, and `AppState` !=
  active.
- [ ] 3. Autoplay respects reduce-motion and the data-saver pref (no autoplay;
  show a play affordance).
- [ ] 4. Audio player: `hitSlop` and a 44 pt min target, a real icon + label
  (`msg`), not unicode glyph text.
- [ ] 5. Tests with a fake player: N visible gifv posts decode at most the
  configured maximum (default 1).

## X7.3 - Images: expo-image, blurhash, sizing, sensitive cover

Status: not started
Branch: `repair25-x7.3-images`
Audit: media M6, M7, M14, M15 (alt fallback), M16 (avatars/emoji), M17; richtext (none)

**Steps.**
- [ ] 1. Migrate feed media, `PostCard` avatars, `ProfileAvatar`,
  `ProfileBanner`, `EmojiImage`, `RichText` inline emoji, and the remaining
  `<Image` hits (grep) to `expo-image` via one `src/components/Image.tsx`
  wrapper: `cachePolicy="memory-disk"`, `recyclingKey`, `transition` (respect
  reduce-motion), `placeholder={{blurhash}}`, `contentFit`, and GIF/WebP
  animation on iOS. Emoji use a small fixed `decodeSize`.
- [ ] 2. Layout stability: reserve space with the blurhash/aspect placeholder;
  strip tile aspect clamped to 0.75-2; panoramas/portraits crop sensibly;
  prefer `previewUrl`, never decode the original at 220 px.
- [ ] 3. Sensitive media: render a blurred blurhash cover (not a blank box)
  with a "Show" control; reveal state keyed by post+media id so it survives row
  recycling; optional re-hide.
- [ ] 4. `onError` fallbacks for avatar/banner (letter/gradient fallback like
  `PostCard`); `CustomEmojiGlyph` resets its candidate index when `candidates`
  change.
- [ ] 5. Delete the legacy `MediaGrid.tsx`; move `mediaAlt` to
  `src/lib/mediaAlt.ts`; update tests (record count delta).
- [ ] 6. Alt text fallback: `mediaAlt` ("Image 2 of 4") replaces the bare
  `item.kind` label; strings via `msg`.

**Acceptance.** Gates green; `grep -R "from 'react-native'" ... Image` for feed paths shows none left; snapshot-free component tests.

## X7.4 - Uploads

Status: not started (D9 default applies)
Branch: `repair25-x7.4-uploads`
Audit: media M8 (platform half), M9, M10, M11, M12, M13, M16 (profile images); networking M8; privacy 8

**Read first.** `src/components/Composer/pickMedia.ts`, `src/state/queries/composer.ts`,
`mastodon/backend.ts:1137-1165`, `mastodon/endpoints.ts:779`, `misskey/client.ts:240-300`,
`Profile/pickProfileImage.ts`, `Drive.tsx:166`.

**Steps.**
- [ ] 1. Abort + progress: `AbortSignal` on `uploadMedia` for both families;
  a per-item Cancel button in the composer; removing an item aborts the
  request and, if the server already stored it, issues a best-effort delete
  (Misskey `drive/files/delete`; Mastodon media has no delete: just drop). Byte
  progress via XHR `upload.onprogress` on web and the native fetch-with-progress
  adapter on RN; fall back to indeterminate with an honest label.
- [ ] 2. Timeouts (networking M8): multipart uploads use a size-scaled
  deadline (min 60 s, +30 s per 10 MB, max 15 min) and stall detection
  (no bytes for 60 s) instead of a flat 30 s; a timeout error is distinct from
  "instance did not answer" and tells the user the file may have been stored.
- [ ] 3. Picking: per-asset try/catch with an item-level `rejected` reason
  (an iCloud-only photo failing must not discard the other picks); size from
  `FileSystem.getInfoAsync` when `asset.fileSize` is undefined; native uploads
  use the `{uri, name, type}` FormData form (no whole-file `fetch(uri).blob()`
  into JS memory); web keeps the blob path with the size check *before* the
  read where the API allows.
- [ ] 4. Concurrency: up to 3 parallel uploads (configurable), results
  ordered; `uploadAll` keeps successful items on retry.
- [ ] 5. Mastodon processing poll (M13): return `status: 'processing'` with the
  media id when 15 s elapse; the composer shows "still processing" and
  re-checks on submit; never mark `done` with a null URL.
- [ ] 6. EXIF/GPS (M12, privacy 8, D9): re-encode picked images with
  `expo-image-manipulator` (JPEG/HEIC -> JPEG, quality 0.92, orientation
  baked in) which drops metadata, default on, with a "Keep original" per-upload
  toggle (shows a warning when the file has GPS). Videos: no re-encode; warn
  once per session that video metadata is sent unchanged. Cap output to the
  server's image limit from X6.2.
- [ ] 7. Alt text (M11): an optional "remind me to add alt text" pref (default
  off); the post button shows a non-blocking note when images lack alt.
- [ ] 8. Profile images (M16): `pickProfileImage` crops to the target aspect and
  resizes (avatar 400 px, header 1500 px wide) before upload.
- [ ] 9. Error text for over-cap/failed uploads uses the real numbers
  (formatters from X9.5).

**Acceptance.** Gates green; tests for abort, orphan delete, per-asset failure, processing state, metadata strip (assert the output has no `exif`).

---

# Wave 8 - UI robustness and state-layer correctness

## X8.1 - Error boundaries and a logger

Status: not started
Branch: `repair25-x8.1-boundaries-logger`
Audit: rn-ui M1; a11y 10, 14; privacy 13; storage S12 (consumer)

**Steps.**
- [ ] 1. `src/lib/logger.ts`: levels, redaction (`redactUrl`, token strip),
  `addSink()` seam (no network sink shipped), dev console sink. Replace the
  `console.*` calls (`Conversation.tsx:104`, `PostPoll.tsx:134`) and the
  dev logs in the fedi clients via an injected logger interface (fedi stays
  pure: accept a `log` function, default no-op).
- [ ] 2. `ErrorBoundary` component: root (reload / sign-out affordance), one
  per navigator screen, and one per feed row in `renderItem` (collapses to a
  "Couldn't show this post" row with a retry that re-renders). Capture to the
  logger. `ErrorUtils.setGlobalHandler` and web `unhandledrejection` forward to
  the logger. All visible text via `msg`.
- [ ] 3. Poll vote failure: confirm the UI shows an error (not console only)
  and add a test.
- [ ] 4. Tests: a throwing `PostCard` renders the fallback row, the list stays
  scrollable, the error reaches the logger.

## X8.2 - Screen-level bugs

Status: not started
Branch: `repair25-x8.2-screens`
Audit: rn-ui M3, M4, M5, L3, L5 (device), L6

**Steps.**
- [ ] 1. `Channels.tsx`: move to react-query infinite queries keyed
  `[sessionId, 'channels', tab]` (as Conversations/ChatRooms do) or add the
  `generationRef` + abort guard; a `loadMore` failure shows a footer error,
  never replaces the loaded list. Tests: slow "mine" response arriving after
  switching to "server" is ignored; account switch ignores stale data.
- [ ] 2. `ToastHost`: bottom = safe-area inset + tab-bar height (shell layout
  exposes it); timer pauses on hover/focus; can be dismissed early. (Live-region
  semantics: X10.1.)
- [ ] 3. Deep links (M5): register `Notifications` and `User` always; render the
  existing signed-out state or redirect to Login with a `next` param. Test the
  linking config for a signed-out cold open of `/notifications` and `/users/x`.
- [ ] 4. `Note.tsx:1114-1118`: use `goBackOrFeed`.
- [ ] 5. `RightNav` stub text (L6): do not mount `RightNav` until widgets
  exist; let the feed use the wide column. Remove the "Widgets land in Phase 5"
  copy.
- [ ] 6. Android keyboard (L5): see X6.5; nothing more here.

## X8.3 - Cache and optimistic-update correctness

Status: not started
Branch: `repair25-x8.3-cache-correctness`
Audit: sessions-cache 2, 3, 9, 10, 11

**Steps.**
- [ ] 1. `settleInto`: project the shadow through `FIELD[kind]` so only the
  settling field is written. Test: boost then bookmark, bookmark fails -> UI
  shows not bookmarked.
- [ ] 2. `mergeChatMessage`: keep `...rest` pages and `pageParams`; add a
  multi-page test.
- [ ] 3. `cancelQueries` before optimistic `setRel`, feed/notification live
  prepends, and composer inserts.
- [ ] 4. `patchPost` on a null result for a nested `renote`/`quote`/`reply`
  child: drop pure-boost rows whose original was removed; quotes show a
  "deleted" placeholder (translated).
- [ ] 5. `setListMember` goes through the toggle queue like follow/mute/block;
  test two quick toggles with the first failing.

## X8.4 - Hooks cleanup and rule promotion

Status: not started
Branch: `repair25-x8.4-hooks-cleanup`
Audit: rn-ui M2

**Steps.**
- [ ] 1. Fix every `react-hooks/exhaustive-deps` warning from X0.1. Where a
  suppression is genuinely right (documented ref-mirroring in `Note.tsx`,
  `Menu.tsx`), use a targeted `eslint-disable-next-line` **with the reason**.
- [ ] 2. Promote `exhaustive-deps` to `error`.
- [ ] 3. Behaviour-preserving: no UI change; the full suite stays green and
  the test count does not drop.

**Out of scope.** Any refactor beyond what a dependency fix needs.

---

# Wave 9 - i18n readiness (no string literals anywhere)

Goal state: `pnpm lint` has the baseline total at **0**, every user-visible
string flows through Lingui, and the English catalog is extracted and
complete. No other locale is edited. Work from the burn-down meter (X0.2),
one directory per slice, lowest baseline first. Each slice:

1. Convert strings to `msg`/`t`/`Trans`/`plural` per `docs/i18n.md`.
2. Run `pnpm intl:extract`, commit the updated **`en`** catalog only. Other
   locales keep their old entries; missing keys fall back to English by design.
3. `pnpm lint:i18n-baseline` to ratchet the baseline down.
4. Verify with the pseudo-locale: no plain English visible in the touched
   screens (record by test, not screenshots, where possible).

## X9.1 - Admin, announcements, antennas, channels screens

Status: not started
Branch: `repair25-x9.1-i18n-admin-etc`
Audit: a11y 2

Files: `AdminInsight`, `AdminReportsList`, `AdminReportDetail`, `Announcements`,
`Antenna`, `Antennas`, `Channel`, `Channels`. Includes the hand-rolled plural
in `AdminReportsList.tsx:107`, file sizes in `AdminInsight.tsx:88`
("N posts" via `plural`, sizes via the X9.5 formatter).

## X9.2 - Chat, clips, compose, conversations

Status: not started
Branch: `repair25-x9.2-i18n-chat-etc`
Audit: a11y 2

Files: `ChatRoom`, `ChatRooms`, `ChatThread`, `ChatUser`, `Clip`, `Clips`
(`Clips.tsx:50-206`), `Compose` (`Compose.tsx:128`), `Conversation`,
`Conversations`.

## X9.3 - Drive, follow graph, lists, favourites, home

Status: not started
Branch: `repair25-x9.3-i18n-drive-etc`
Audit: a11y 2

Files: `Drive.tsx` and `Drive/*` (`detail.tsx:164-184`, `rows.tsx:36`),
`Followers`, `Following` (`:190`), `FollowRequests`, `Home`, `List`, `Lists`,
`Favorites`, `AccountReactions` (`:78,87`).

## X9.4 - Components

Status: not started
Branch: `repair25-x9.4-i18n-components`
Audit: a11y 2, 3, 13

Files (non-exhaustive; use the baseline file to enumerate): `Note.tsx`
(`:197,693,1175,1198,1291`), `PostFeed.tsx` (`:107,141-144`, "Show N new posts"
via `plural`), `RecommendationReasonDialog`, `RecommendationsSettingsOverlay`
(`:404-440`; also fix the mangled formatting at
`RecommendationReasonDialog.tsx:44-45`), `NoteHistory` ("Original ·",
"Edited ·"), `NotificationRow` (unknown-type label from X4.1), `Lightbox`
leftovers, Dialog/Popup/Menu chrome (close glyph labels), `Toast`, the
Composer and Settings trees, Login screens not yet converted. Every file the
baseline still lists that is not in X9.1-X9.3 or X9.5-X9.7.

## X9.5 - Locale-aware formatting and plurals

Status: not started
Branch: `repair25-x9.5-formatting`
Audit: a11y 3, 4, 5; media (size units); richtext X6.3 (unixtime)

**Steps.**
- [ ] 1. `src/locale/format.ts`: `formatRelativeTime`, `formatDate`,
  `formatDateTime`, `formatNumber`, `formatCompactNumber`, `formatBytes`,
  `formatDuration`, all built on `Intl.*` bound to the **app locale**
  (`i18n.locale`), not the device locale, with a `en` fallback. `'now'` and
  "5m"/"in 5m" use `Intl.RelativeTimeFormat` (no literals).
- [ ] 2. Replace every `toLocaleString()`, `toLocaleDateString()`,
  `toLocaleTimeString()`, `.toFixed(...)` + unit literal, and hand-rolled
  `n === 1 ? ... : ...` plural in `src/` (grep list in the audit:
  `time.ts:15`, `PostPoll.tsx:36-42`, `Announcements.tsx:118,126`,
  `NoteHistory.tsx:55-56`, `ComposerSections.tsx:548`, `CompactComposer.tsx:450`,
  `AdminInsight.tsx:88`, `Drive/rows.tsx:36`, `PostMediaGrid.tsx:97-98`).
  Use `plural()` for counts.
- [ ] 3. Timestamp ticker (a11y 5): a shared minute ticker
  (`useSyncExternalStore`, one interval for the whole app, paused when
  backgrounded) so relative times refresh; no per-row timers.
- [ ] 4. Tests: formatters in `en`, `ja`, `hi`, `fr` (via `Intl`; assert shape
  not exact text where ICU differs); ticker advances rows; no `toLocale*`
  call remains outside `format.ts` (a grep-style test).

## X9.6 - RTL readiness

Status: not started
Branch: `repair25-x9.6-rtl`
Audit: a11y 15

**Steps.**
- [ ] 1. Replace physical `left`/`right`/`marginLeft`/`marginRight`/
  `paddingLeft`/`paddingRight`/`borderLeft*` with logical `start`/`end`
  equivalents in `src/` (about 49 sites: `Toast`, `Lightbox` insets, etc.).
  Add a lint rule `keystone/prefer-logical-style` (warn -> error) with a
  small baseline like X0.2.
- [ ] 2. Icons that imply direction (back, chevrons) flip via
  `I18nManager.isRTL` or `scaleX: -1`.
- [ ] 3. `i18n.ts` exposes `isRtlLocale()`; the pseudo-locale gains an RTL
  mode for development. No RTL locale is shipped.
- [ ] 4. `writingDirection: 'auto'` on user-content `Text` so mixed-direction
  posts render correctly.

## X9.7 - Error codes, not display text, from `packages/fedi`

Status: not started
Branch: `repair25-x9.7-error-codes`
Audit: networking L1 (consumer); security L2 (toast echo); i18n requirement

**Steps.**
- [ ] 1. Inventory every `throw new Error('...')`/`FediError(message)` in
  `packages/fedi` whose text can reach the UI. Convert each to a stable code
  (`errors.<area>.<name>`) with params. Existing codes (`errors.network.*`,
  `errors.unsupported.*`) stay.
- [ ] 2. `src/lib/errorMessage.ts`: one exhaustive `code -> msg` table (a
  TypeScript `satisfies Record<ErrorCode, MessageDescriptor>` so a new code
  fails typecheck until it has a message). All user-facing error rendering goes
  through it; no `err.message`, `String(err)`, or response text is displayed.
- [ ] 3. Lint rule or grep test: `showToast(`/`toastError(` never receives
  `err.message`/`String(e)` directly.
- [ ] 4. Tests: every code in the union has a descriptor; unknown codes render
  a generic translated message.

## X9.8 - Burn-down to zero and catalog check

Status: not started
Branch: `repair25-x9.8-i18n-close`
Audit: a11y 2 (completion)

**Steps.**
- [ ] 1. Anything left in the baseline: convert it.
- [ ] 2. Set the baseline to `{}` and change the rule to a plain error (delete
  the baseline mechanism).
- [ ] 3. `pnpm intl:extract` produces no diff after a clean run (CI check:
  `lingui extract` then `git diff --exit-code src/locale/locales/en`).
- [ ] 4. A test walks `src/` with the pseudo-locale active and asserts no
  rendered text node matches `/^[A-Za-z][A-Za-z ,.'-]+$/` in the smoke screens.
- [ ] 5. `docs/i18n.md` gains a "adding a string" checklist and the list of
  locales that are intentionally untranslated (everything but `en`) so a
  future translator can start.

**Acceptance.** Lint baseline is empty; gates green; extract is clean.

---

# Wave 10 - accessibility

## X10.1 - Semantics and keyboard

Status: not started
Branch: `repair25-x10.1-a11y-semantics`
Audit: a11y 6, 7, 8, 11, 12, 13 (counter); rn-ui M4 (announce half); media M15 (modal)

**Steps.**
- [ ] 1. Toast: `accessibilityLiveRegion="polite"` / `role="alert"` (errors
  assertive) and `AccessibilityInfo.announceForAccessibility` on native.
- [ ] 2. Dialog/Menu/Popup: `role="dialog"`, `aria-modal`,
  `accessibilityViewIsModal`; focus moves into the dialog on open and returns on
  close; replace per-component document `keydown` listeners with a single
  keyboard layer stack (top layer handles Escape; others do not fire). Test:
  Menu inside Dialog closes the Menu on the first Escape, the Dialog on the
  second.
- [ ] 3. `Heading` sets `accessibilityRole="header"` (and `aria-level`); Pagehead
  and Dialog titles inherit.
- [ ] 4. Recommendation chips and other text-only Pressables get role and a
  distinct add/remove label via `msg` (`RecommendationsSettingsOverlay.tsx:408-446`).
- [ ] 5. Focus: visible `:focus-visible` ring token in `alf` for Button,
  Pressable, and the composer (replace `outlineWidth: 0` at `Composer.tsx:198-199`,
  `CompactComposer.tsx:548-549` with a focus-only style); hover and focus states
  on shared Pressable.
- [ ] 6. Hover cards open on keyboard focus too (with Escape to dismiss) in
  `HoverPreview.tsx` and `richtext/MatrixHover.tsx`; stabilise the `onDismiss`
  dependency so the interval restart noted at `HoverPreview.tsx:338-354` goes away.
- [ ] 7. Tests with Testing Library `getByRole`/accessibility props for each.

## X10.2 - Contrast and disabled states

Status: not started
Branch: `repair25-x10.2-contrast`
Audit: a11y 9

**Read first.** `docs/tasks/contrast-sweep.md` (prior work; do not reverse it
without an ADR), `src/alf/themes.ts`.

**Steps.**
- [ ] 1. Raise `faint` to >= 4.5:1 on its backgrounds in both themes (light
  about `#767676` on white; dark about `#8a8a8a` on `#111`); verify `muted` on
  `raise`. Keep `faint` for non-essential text.
- [ ] 2. A token test computes WCAG contrast for every text-token x surface-token
  pair and fails below 4.5:1 (3:1 for large text/icons) with an explicit
  allowlist for decorative pairs.
- [ ] 3. Disabled buttons: stop halving opacity over text; use a disabled text
  token that still meets 3:1 and an additional non-colour cue.

---

# Wave 11 - dependencies, tests, docs

## X11.1 - Dependency and config hygiene

Status: not started
Branch: `repair25-x11.1-deps`
Audit: build 6, 7, 10, 11, 12; security (pnpm audit gap)

**Steps.**
- [ ] 1. Run `pnpm audit`; record the full output in the log. Fix or document
  each finding (override with an ADR if needed).
- [ ] 2. Unused deps: for `expo-asset`, `expo-constants`,
  `react-compiler-runtime`, check peer requirements of other Expo packages and
  Babel plugin runtime needs (`pnpm why`, read the plugin); remove only the
  proven-unused, record each decision.
- [ ] 3. `@react-native/typescript-config` to the version matching RN 0.86.3
  (via `bundledNativeModules`/Expo template); fix any resulting type errors.
- [ ] 4. `devEngines.packageManager` "12.14.0": verify it matches the installed
  pnpm (`pnpm -v`) and an existing release; correct or document.
- [ ] 5. `scripts/`: document the four `fedi-w*-probe.ts` scripts in
  `docs/setup.md` (what each probes, how to run) or delete the obsolete ones;
  resolve `scripts/helium.mjs` (referenced or removed). Add `pnpm` script
  entries for the kept ones.
- [ ] 6. `app.config.js` `TODO(D3, owner)` (app name/bundle id): leave the
  value, add an entry to X12.1 for the owner. Do not invent identifiers.

## X11.2 - Test quality

Status: not started
Branch: `repair25-x11.2-test-quality`
Audit: build 4 (remaining), 8; misskey/mastodon test gaps (remaining)

**Steps.**
- [ ] 1. Typed test factories in `packages/fedi/test/factories` and
  `src/__tests__/factories` (`makePost`, `makeAccount`, `makeSession`,
  `makeNotification`, `makeBackend` returning a fully typed fake). Convert the
  5 files with the most `as unknown as` casts; target halving the count; add
  an ESLint rule or CI grep that forbids *new* `as any` in tests (baseline the
  existing 12).
- [ ] 2. Finish the leak work started in X0.1: remove `--forceExit` from `test`
  if `test:handles` is clean; otherwise list the remaining leakers in the log
  and keep the flag with a comment.
- [ ] 3. A cross-account test suite (AGENTS.md section 6, "switching accounts
  never shows the previous account's data") exercising the final tree: feed,
  notifications, drafts, post shadow, streams. It must fail if any
  `sessionScopedKeys` entry is missing from the purge list.

## X11.3 - Docs sync

Status: not started
Branch: `repair25-x11.3-docs`
Audit: misskey M1 (doc), build 1; DECISIONS hygiene

**Steps.**
- [ ] 1. `docs/DECISIONS.md`: one line per decision made in this program (D1-D10
  outcomes, redirect policy, http policy, expo-crypto, network lib, cache
  allowlist, streaming origin rule, EXIF default, link preview default).
- [ ] 2. `docs/api-surface.md`, `docs/mastoapi-contract.md`: correct what the
  slices changed (Misskey wrapper rows, notifications v2 dismiss, `resolve`,
  markers, streaming origin rule).
- [ ] 3. `docs/tasks/README.md` index: add a row per slice in this file; mark
  done ones.
- [ ] 4. ADR index (`docs/adr/README.md`) updated for 0011+.

---

# Wave 12 - close-out

## X12.1 - Owner checklists

Status: not started
Branch: `repair25-x12.1-owner-checklists`

**Goal.** Everything an agent could not verify, in one place the owner can
run through.

**Steps.**
- [ ] 1. `docs/audit_20261025/device-checks.md`: a numbered checklist, each
  with the exact steps and the expected result: native `crypto` present (PKCE
  login + Mastodon post); SecureStore round-trip after kill/relaunch;
  upgrade migration (token moved out of MMKV); sign-out leaves no data
  (inspect MMKV); Android back-up exclusion; keyboard layout on Android + iOS
  composer; lightbox open-at-index, zoom, rotate, dismiss; video pause on
  scroll/background; privacy shield overlay in the app switcher; boot with
  the network blackholed; deep links signed-out; Mastodon stream handshake
  with subprotocol auth on iOS and Android.
- [ ] 2. `docs/audit_20261025/live-checks.md`: server checks for the rig
  (Misskey :3101, Sharkey :3102, Mastodon): wrapper-row lists, `notes/edit`
  shape, `i/revoke-token` with `token`, reaction packed-map keys, markers,
  v2 dismiss, `resolve=true` search, hidden-total polls, notification requests,
  streaming handshake; plus the exact `scripts/fedi-capture.ts` command.
- [ ] 3. Collect every `not verified` line from this program's logs into the
  two files above (grep `state/logs/*repair25*`).
- [ ] 4. List the owner-only items: signing (skipped), App Links, `app.config.js`
  identifiers, D1-D10 outcomes.

## X12.2 - Final verification

Status: not started
Branch: `repair25-x12.2-final`

**Steps.**
- [ ] 1. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:handles`;
  paste results.
- [ ] 2. Re-run the audit's checks as scripted greps and paste each result:
  no `Math.random` under `packages/fedi/src` outside tests; no `console.` in
  `src`; no `redirect:` missing on credentialed fetch; every `queryFn` takes
  `signal`; `no-literal-ui-string` baseline empty; `purgeSession` callers
  exist; `react-native` `Image` imports gone from feed paths; no `.bak`
  leftovers.
- [ ] 3. Update `docs/audit_20261025/report.md` with a "Status after repair"
  table (finding -> slice -> done/deferred, with deferrals and reasons).
- [ ] 4. Update `state/STATE.md` to "repair25 complete" with the open owner
  items.

---

# Coverage matrix

Every finding ID from `results/*.md`, with the slice that closes it.
"-" means intentionally not changed (reason given).

## security.md

| ID | Slice | Note |
|----|-------|------|
| H1 | - | Release signing skipped by owner decision |
| M1 | X1.1 | |
| M2 | X1.6 | |
| M3 | X2.3 | Accepted risk + mitigations (D7, ADR 0012); App Links need signing |
| M4 | X2.2 | |
| M5 | X2.3 | |
| L1 | X2.3 | Docs + headers (D2) |
| L2 | X2.3 | |
| L3 | X2.1 (PKCE/state), X2.2 (http origins), X1.6 (Android cleartext) | |
| L4 | X1.4 | |

## storage.md

| ID | Slice |
|----|-------|
| S1, S2 | X1.1 |
| S3 | X1.2 |
| S4 | X1.3 |
| S5, S6 | X1.2 (vault-precedence half of S5 also X1.1) |
| S7, S8 | X1.4 |
| S9, S10, S11, S12 | X1.3 |

## privacy.md

| ID | Slice |
|----|-------|
| 1 | X1.4 |
| 2 | X1.2 |
| 3 | X1.1 (token), X1.6 (backup) |
| 4 | X6.2 |
| 5 | X2.4 (guard), X2.5 (default) |
| 6 | X2.3 (rule), X3.4 (wiring) |
| 7 | X6.2 (TTL, direct drafts), X1.2 (logout) |
| 8 | X7.4 |
| 9, 10, 12 | X2.5 |
| 11 | X1.6 |
| 13 | X8.1 (logger test), X2.5 |

## networking.md

| ID | Slice |
|----|-------|
| H1 | X2.1 |
| H2 | X3.3 |
| H3 | X1.2 |
| M1 | X2.2 |
| M2 | X3.1 |
| M3, M7 | X3.2 |
| M4, M5, M6 | X3.4 |
| M8 | X7.4 |
| M9 | X2.4 |
| L1 | X2.2 (+ X9.7 consumer) |
| L2 | X2.1 |
| L3 | X2.2 |
| L4 | X3.4 |
| L5 | X2.3 |
| L6 | X3.3 (refresh fan-out), X4.4 (Link header), X5.2 (Misskey end) |
| L7 | X3.4 |

## sessions-cache.md

| ID | Slice |
|----|-------|
| 1 | X1.2 |
| 2, 3, 9, 10, 11 | X8.3 |
| 4 | X1.5 |
| 5 | X1.1 |
| 6, 7 | X1.2 |
| 8 | X1.4 |
| 12 | X0.1 |
| Note (scratch file) | X0.1 |

## mastodon.md

| ID | Slice |
|----|-------|
| 1 | X4.1 |
| 2 | X2.1 |
| 3 | X2.2 |
| 4, 5, 6 | X4.2 |
| 7 | X4.3 |
| 8 | X2.1 (backend), X6.2 (UI) |
| 9, 10 | X4.4 |
| 11 | X4.4 (backend), X6.2 (UI) |
| 12 | X4.1 (types), X4.5 (requests/policy, D8) |
| 13 | X3.4 |
| 14 | X3.4 (smoke probe) + X12.1 (live check); no token-in-URL fallback by design |
| 15 | X4.4 |
| 16 | X4.2 |
| 17, 18, 19 | X4.4 |
| 20 | X4.3 |
| 21 | X4.4 (D4) |
| 22 | X4.4 (poll `expires_in` and small gaps; rest tracked in `docs/tasks/mastodon-small-gaps.md`) |

## misskey.md

| ID | Slice |
|----|-------|
| M1 | X5.1 |
| M2, M10, M15 | X5.2 |
| M3 | X5.3 |
| M4, M5, M6 | X5.4 |
| M7 | X5.5 |
| M8 | X2.1 |
| M9 | X2.2 |
| M11 | X5.5 |
| M12, M13 | X3.4 |
| M14 | X5.5 |
| M16 | X4.3 |
| M17 | X6.3 (MFM `fn`), X5.4 (`like`) |
| Test/fixture gaps | X5.6 |

## media.md

| ID | Slice |
|----|-------|
| M1, M2, M3, M4 | X7.1 |
| M5 | X7.2 |
| M6, M7 | X7.3 |
| M8 | X6.2 (server limits), X7.4 (streaming reads) |
| M9, M10, M11, M12, M13 | X7.4 |
| M14 | X7.3 (cover), X7.1 (lightbox re-check) |
| M15 | X7.1 (lightbox), X7.2 (audio), X7.3 (alt fallback), X10.1 (modal) |
| M16 | X7.3 (avatar/banner/emoji), X7.4 (profile image crop) |
| M17 | X7.3 |

## rn-ui.md

| ID | Slice |
|----|-------|
| H1 | X7.1 |
| M1 | X8.1 |
| M2 | X0.1 (enable), X8.4 (promote) |
| M3 | X8.2 |
| M4 | X8.2 (layout), X10.1 (announce) |
| M5 | X8.2 |
| M6 | X3.5 |
| L1, L4 | X3.3 |
| L2 | X6.2 |
| L3, L6 | X8.2 |
| L5 | X6.5 (device check in X12.1) |

## richtext-composer.md

| ID | Slice |
|----|-------|
| F1, F2, F3 | X6.1 |
| F4, F5 | X6.3 |
| F6, F8 | X6.4 |
| F7 | X6.4 (AST), X2.5 (renderer match), X2.4 (policy) |
| F9, F10, F11, F12 | X6.2 |
| F13 | X6.2 (drafts, insertCreatedPost), X6.3 (fidelity, quadratic) |

## a11y-i18n-perf-web.md

| ID | Slice |
|----|-------|
| 1 | X7.1 |
| 2 | X0.2 (rule), X9.1-X9.4, X9.8 |
| 3, 4, 5 | X9.5 |
| 6, 7, 8 | X10.1 |
| 9 | X10.2 |
| 10 | X8.1 |
| 11, 12 | X10.1 |
| 13 | X7.1, X9.4 |
| 14 | X8.1 |
| 15 | X9.6 |

## build-tests-deps.md

| ID | Slice |
|----|-------|
| 1, 2 | X0.3 |
| 3 | X0.4 (D1) |
| 4 | X0.1, X11.2 |
| 5 | X0.1 |
| 6, 7 | X11.1 |
| 8 | X11.2 |
| 9 | X0.1 |
| 10 | X11.1, X12.1 (owner) |
| 11, 12 | X11.1 |

---

# Verified sound (do not re-litigate)

Carried from the "looked solid" sections. Do not change these without an ADR:

- Transport origin/token binding (`requestJson` takes no token, cross-origin
  absolute URLs refused before I/O, `credentials: 'omit'`).
- Single allow-listed content AST with `safeUrl` (http/https/mailto, no
  userinfo); no `innerHTML`/`eval`/WebView.
- PKCE + state + read-and-delete pending flow; token verified before store.
- `createQueryKey` throws on an empty session id; `patchPostInCaches` filters
  by session.
- Toggle queues (per session/post/kind), `refuse()` capability gating.
- Retry policy excluding 401/403/404/410/422/429.
- Mastodon pagination ids are opaque strings; end-of-feed is "no next or
  empty page".
- Visibility mapping never rounds unknown values up to `public`.
- `SafeHttpUrl` gates on all media sources.

# Definition of done for the program

- [ ] Every slice above is `done`, `won't do (owner)`, or `blocked (owner)`.
- [ ] The coverage matrix has no unmapped finding.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, plus `pnpm test:handles`.
- [ ] `no-literal-ui-string` baseline is empty; `pnpm intl:extract` is clean.
- [ ] X12.1 checklists exist and contain every `not verified` item.
- [ ] `state/STATE.md` is under 60 lines and points at the next owner action.
