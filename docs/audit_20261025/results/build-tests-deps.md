# Build / tests / deps audit (2026-10-25)

## Summary
All three gates are green. Hygiene is good (no skips, no snapshots, no ts-ignore, near-zero non-test `any`). Problems are mostly process/doc drift: STATE.md blows its size rule and carries stale counts, ios/ is untracked while android/ is tracked, and typecheck/lint scope is narrower than the repo.

## Command results
- `pnpm typecheck` (ios, android, web) -> pass, no output.
- `pnpm lint` (oxlint --quiet src && eslint .) -> exit 0.
- `pnpm test` -> 218 suites / 2968 tests passed, 0 snapshots, ~54s. Jest warns "worker process failed to exit gracefully" (leaks; masked by `--forceExit`).

## Findings
1. MEDIUM - state/STATE.md:1-188. AGENTS.md says keep under ~60 lines; it is 188. It is an accreted changelog; the newest entries are at the top, then an older "Phase/slice: P6 Wave 3.2" pointer sits mid-file, so "what to do next" is ambiguous. Fix: rewrite to a <60-line pointer (phase, branch, next 3 steps, blockers, links); move history to logs.
2. LOW - state/STATE.md:1-40 claims "217 suites / 2967 tests"; actual run is 218 suites / 2968 tests. Entries are dated 2026-10-26 while today and latest commits are 2026-10-25 (date inconsistency; logs `state/logs/2026-10-26-*` also future-dated). Fix: correct counts/dates in next session.
3. MEDIUM - ios/ is untracked (git status `?? ios/`) and not in .gitignore, while android/ is tracked (36 files). Inconsistent native-dir policy; app.config.js comments say config survives `expo prebuild`, implying generated dirs. Fix: decide; gitignore both (CNG) or commit both.
4. LOW - package.json `test` uses `--forceExit` and `--bail`; leaking handles are hidden (see test output warning). Fix: run `--detectOpenHandles` once, unref timers/clean up in teardown.
5. LOW - package.json:`lint`. `oxlint` only runs on `src` (not packages/fedi, scripts, lint-rules). eslint custom rules cover src and packages/fedi only (`.ts`, not `.tsx` in fedi, fine). Fix: add packages to oxlint.
6. LOW - Possibly unused deps (no import found in src/packages/scripts/config): expo-asset, expo-constants, react-compiler-runtime (may be needed by babel-plugin-react-compiler at runtime for non-React-19 only; verify), react-test-renderer (peer of RNTL, OK to keep), expo-dev-client (needed for `start --dev-client`, fine). Fix: verify expo-asset/expo-constants are peers of other expo modules before removing.
7. LOW - package.json: `@lingui/macro` and `@lingui/babel-plugin-lingui-macro` both present; @lingui/macro is used (56 files). Fine. `@react-native/typescript-config ^0.81.5` is mismatched with RN 0.86.3; `@types/jest 29.5.14` vs jest-expo 57 ok. Fix: bump typescript-config to match RN.
8. LOW - Type escapes in tests: 12 `as any`, 1 `@ts-expect-error`, ~109 `: any`, 210 `as unknown as` in test files. Non-test code: 0 `as any`, 0 ts-ignore; only eslint-disable is generated locale catalogs (src/locale/locales/*/messages.ts). Acceptable; heavy `as unknown as` in tests suggests mocks may drift from real types (shallow hiding risk).
9. LOW - Only 4 custom lint rules (no-hardcoded-color, no-ui-in-fedi, no-wire-in-app) -- AGENTS also asks for "every query key includes sessionId" and "no innerHTML"; neither is lint-enforced (verified: not in lint-rules/index.js). Fix: add rules.
10. INFO - app.config.js: still contains `TODO(D3, owner)` for name/bundleId (`app.keystone.dev`); fine for dev, blocks store builds. Plugins withAppleTeamId / withSceneLifecycle are local and documented.
11. INFO - scripts/: four ad-hoc `fedi-w*-probe.ts` scripts beyond fedi-smoke; they are included in tsconfig.check but not documented in package.json scripts. `scripts/helium.mjs` unreferenced.
12. INFO - `dist/` present locally, gitignored (ok). `devEngines.packageManager` pnpm "12.14.0" is unusual; verify it exists/matches the installed pnpm.

## Solid
- No `.skip/.only/.todo`, no snapshot tests; 214 test files incl. per-lint-rule tests in lint-rules/__tests__.
- Three-platform typecheck; strict TS via RN config; no `link:` unpublished deps; pnpm overrides documented with ADR 0008.
- Boundaries enforced by lint (wire/ui-in-fedi); ADRs 0001-0010 and DECISIONS.md present; logs exist per session (182 entries) and follow date naming.
