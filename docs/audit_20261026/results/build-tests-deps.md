# Build/tests/deps audit — Keystone v2 (2026-10-26)

Scope: gates (typecheck ios/android/web, lint, test suite/test counts vs `state/STATE.md`), jest config (`--forceExit`, `--bail`, `--detectOpenHandles`, worker-exit warnings, `crypto` mock in `jest/jestSetup.js`), oxlint coverage, custom lint rules (`lint-rules/` — no-wire-in-app `/wire/*` subpaths, `globalThis`/`navigator`/`self`/`fetch` gaps, one test per rule), deps (`package.json`: expo-asset, expo-constants, react-compiler-runtime, @react-native/typescript-config skew, `react-native-*`/`@expo/*` in fedi, dead `react-responsive`), `app.config.js` TODOs (name/bundle id, allowBackup, devEngines), `android/` vs `ios/` tracking policy, `as any`/`as unknown as`/`ts-ignore` counts (test vs non-test), `STATE.md` line count vs 60-line rule + stale counts/dates, TODO/FIXME/HACK/XXX grep.

Read-only audit. No source modified. All gates were actually run; outputs pasted below.

## Summary

All three gates are green and `STATE.md` is accurate: **292 suites / 4123 tests**, matching the pointer exactly. Most 2026-10-25 findings are fixed: STATE.md is back under 60 lines (28), `ios/` is now tracked (18 files) alongside `android/` (41), oxlint covers `src packages scripts lint-rules`, `--bail` is gone, `@react-native/typescript-config` matches RN (0.86.3), probe scripts are documented in `package.json`, and the two AGENTS-mandated rules missing yesterday (`query-key-session-first`, `no-inner-html`) now exist with tests. Remaining items are low-severity hygiene: `expo-asset`/`expo-constants` still have zero imports, the `--forceExit`-masked worker-exit warning persists, and the `app.config.js` D3 identity TODO stays open (owner action).

Counts: 292 suites (195 src + 88 packages/fedi + 8 lint-rules + 1 plugins), 4123 tests, 0 snapshots, 0 skips, 1 word-boundary TODO (app.config.js D3), 1 `ts-expect-error` (intentional, in a locale test).

## Findings

1. LOW — `expo-asset` (`package.json:58`) and `expo-constants` (`package.json:60`) have zero imports anywhere in `src/`, `packages/`, `scripts/`, `app.config.js`, `plugins/` (verified: `grep -rn 'expo-asset'|'expo-constants'` → count 0 for both). Likely pulled as transitive peers of other Expo modules; harmless but unaudited. Fix: confirm they are required peers before any removal; otherwise leave.
2. LOW — `pnpm test` still needs `--forceExit`; the run ends with "A worker process has failed to exit gracefully and has been force exited" plus "Force exiting Jest: Have you considered using `--detectOpenHandles`". `test:handles` script exists (`package.json:28`) and STATE.md records it "never clean on this tree". Leaks remain unidentified. Fix (owner/backlog): one `--detectOpenHandles` pass, unref timers in teardown.
3. LOW — Type escapes in non-test code are `as unknown as`-heavy: 66 non-test vs 252 test occurrences (word-boundary grep, locale excluded); true `as any` is 0 in non-test (the single grep hit is a comment: `quote.ts:384` "the same TTL as any other miss"); `: any` grep hits (8) are all comments/prose, so 0 real annotations. Test `as any` is exactly 12, matching the `no-any-in-tests` BASELINE (4+2+2+1+1+1+1). No action; the ratchet rule holds the line.
4. INFO — `app.config.js:8` still carries `TODO(D3, owner)` for app name/slug/scheme/bundle id (`app.keystone.dev`); `allowBackup: false` is set with MMKV rationale (`app.config.js:49-55`). Correct for dev; blocks store builds. Owner action, already tracked.
5. INFO — `react-compiler-runtime` is absent from `package.json` (only `babel-plugin-react-compiler: 1.0.0` in devDeps); correct for React 19.2, no gap. `react-responsive` is not a dependency (only two comment mentions in `src/alf/` explaining why it was rejected). `@react-native/typescript-config 0.86.3` matches `react-native 0.86.3`. `devEngines` pnpm `12.14.0` matches installed pnpm `12.14.0`. All prior dep-skew notes resolved.
6. INFO — `no-ui-in-fedi` documents a 4-entry `SEAM_ALLOWLIST` (`core/http.ts`→`fetch`, `misskey/stream.ts` + `mastodon/stream.ts`→`globalThis`, `core/random.ts`→`globalThis`) with "do not extend" instructions. Narrow and justified; new code must inject a seam. No action.
7. INFO — `docs/audit_20261024/` and `docs/audit_20261025/results/` show as untracked (`??`) in `git status`, alongside other `docs/` scratch (`clicktargets/`, `deep-chains/`, `k1k2-20261022/`, `quotes/`, images). Audit-output tracking policy is unclear; harmless but worth a decision (track or gitignore).

## Looked solid

- Gates green (ran 2026-10-26, outputs pasted in table below). STATE.md counts (292/4123) verified exact; no date drift (STATE references 2026-10-25 repair program, HEAD commits dated 2026-10-25, latest logs `2026-10-25-repair25-x12.*`).
- `STATE.md` is 28 lines (rule: under ~60). Single pointer, no changelog accretion.
- `ios/` tracked (18 files) and `android/` tracked (41 files); inconsistent-policy finding resolved.
- Lint script is `oxlint --quiet src packages scripts lint-rules && eslint .` — oxlint scope gap closed.
- 8 custom rules, 8 test files (one test per rule): no-ui-in-fedi, no-wire-in-app, no-hardcoded-color, query-key-session-first, no-inner-html, no-literal-ui-string, prefer-logical-style, no-any-in-tests. `no-wire-in-app` matches `wire` as a full path segment (trailing/leading/deep: `…/wire`, `wire/client`, `@keystone/fedi/misskey/wire/client` all covered, substring false-positives excluded) plus deep-import bans (`mastodon/`/`misskey/` roots, `core/http`, `wire`/`client`/`adapt`/`endpoints` basenames). `no-ui-in-fedi` bans `react(-dom|-native[/-])`, `@react-native[/-]`, `expo($|[/-])`, `@expo/`, `@tanstack/`, `#/`, plus globals `window/document/localStorage/globalThis/navigator/self/fetch` in shipped code (tests exempt from globals only).
- `jest/jestSetup.js`: real Node WebCrypto (`globalThis.crypto = webcrypto` only if missing `getRandomValues`); comment explicitly forbids re-mocking `crypto` (prior empty-mock incident documented). NetInfo mocked globally as always-connected with rationale.
- `packages/fedi/src`: zero imports from `react-native`/`@react-native`/`expo`/`@expo`/`@tanstack`/`react`/`react-dom`. No `link:` deps. Zero `.skip/.only/.todo`, zero snapshots, zero `__snapshots__` dirs.
- `eslint-disable`: 10 non-locale hits, all justified inline (3 `react-hooks/exhaustive-deps` with reasoning, 7 `keystone/no-hardcoded-color` in richtext tests for MFM color args under test). Generated locale catalogs excluded via `ignores: ['src/locale/locales/**']`.
- Word-boundary TODO/FIXME/HACK/XXX grep over `src packages scripts lint-rules app.config.js plugins`: exactly 1 hit (the D3 TODO). Prior MASTODON-substring noise eliminated.
- Probe scripts (`probe:w4/w5/w8/wsc`) and `helium` now have `package.json` script entries; `dist/` and probe bundles gitignored.

### Gate output table

| Gate | Command | Result |
|---|---|---|
| typecheck ios | `tsc --project ./tsconfig.check.ios.json` (via `pnpm typecheck`) | pass, no output, exit 0 |
| typecheck android | `tsc --project ./tsconfig.check.android.json` | pass, no output, exit 0 |
| typecheck web | `tsc --project ./tsconfig.check.web.json` | pass, no output, exit 0 |
| lint | `pnpm lint` (`oxlint --quiet src packages scripts lint-rules && eslint .`) | exit 0, no output |
| tests | `pnpm test` (`NODE_ENV=test jest --forceExit --testTimeout=20000`) | 292/292 suites, 4123/4123 tests passed, 0 snapshots, 33.6s |
| tests (leak warning) | same run, tail output | "A worker process has failed to exit gracefully and has been force exited… Try running with --detectOpenHandles" + "Force exiting Jest: Have you considered using `--detectOpenHandles`" |
| suite census | `NODE_ENV=test npx jest --listTests \| wc -l` | 292 (195 src + 88 packages + 8 lint-rules + 1 plugins) |
| STATE check | `wc -l state/STATE.md` | 28 lines; claims 292/4123 — verified exact |
| tracking | `git ls-files android \| wc -l` / `git ls-files ios \| wc -l` | 41 / 18, both tracked |
| escapes | word-boundary `as any` / `as unknown as` / `ts-ignore\|expect-error\|nocheck` greps | non-test `as any`: 0 code (1 comment); test `as any`: 12 (= BASELINE); non-test `as unknown as`: 66; test: 252; `ts-expect-error`: 1 (`src/locale/locale.test.ts:57`, intentional invalid-code probe); `ts-ignore`/`nocheck`: 0 |
| skips/snapshots | `\.(skip\|only\|todo)\(` and `toMatchSnapshot` greps | 0 / 0 |
| deps | import greps + `pnpm --version` | `expo-asset`: 0, `expo-constants`: 0, `react-compiler-runtime`: 0 (not a dep), fedi RN/expo imports: 0, pnpm 12.14.0 = devEngines |
| git recency | `git log --format='%h %ad %s' --date=short -5` | HEAD `d024cb4 2026-10-25` "Repair25 tracking: X12.2 status, STATE repair25-complete pointer (292 suites / 4123 tests)"; prior four also 2026-10-25 |
