# Runbook — build, run, verify

Prerequisites: **Node >= 24.19** (`engines` in `package.json`),
**pnpm** (pinned `12.14.0` in `devEngines`), **Xcode** (iOS) and/or
**Android Studio** (Android), plus **watchman** (`brew install
watchman` — `metro.config.ts` re-enables Watchman; without it Metro's
Node crawler serves stale bundles — see troubleshooting).

Status: repair program complete — **292 suites / 4123 tests** green,
typecheck (ios+android+web) + lint (0 errors, 0 warnings) clean. Owner
device + live-server checks pending — see `state/STATE.md`, not here.

## Install and run

```bash
pnpm install
pnpm start        # expo start --dev-client (physical device / dev client)
pnpm web          # expo start --web (browser)
pnpm ios          # expo run:ios (simulator build + run)
pnpm android      # expo run:android (emulator build + run)
pnpm build-web    # expo export --platform web → dist/
```

## Verify (every change)

```bash
pnpm typecheck && pnpm lint && pnpm test
```

What each covers (all in `package.json` `scripts`):

- `typecheck` = `typecheck:ios` + `:android` + `:web` — `tsc` against
  `tsconfig.check.{ios,android,web}.json` (per-platform `jsx`/lib
  splits; `tsconfig.check.json` also covers `scripts/`).
- `lint` = `oxlint --quiet src packages scripts lint-rules` **and**
  `eslint .` (custom rules in `lint-rules/`, config
  `eslint.config.mjs`: `no-wire-in-app`, `no-ui-in-fedi`,
  `keystone/no-literal-ui-string`).
- `test` = `NODE_ENV=test jest --forceExit --testTimeout=20000`
  (preset `jest-expo/ios`, setup `jest/jestSetup.js`). `--forceExit`
  is load-bearing: `test:handles` (`--detectOpenHandles`) never goes
  clean on this tree (see `state/STATE.md`).
- `test-ci` adds `--ci --reporters=default`; `test-watch` is the local
  loop.

## i18n and formatting

```bash
pnpm intl:extract   # lingui extract --clean --locale en → src/locale/locales/en/messages.po
pnpm intl:compile   # lingui compile (generates all catalogs incl. dev-only pseudo)
pnpm prettier       # prettier --check . (style: prettier.config.ts — no semicolons, single quotes)
```

Conventions: English is the source locale; only `en` ships finished
(`docs/i18n.md`). Never hand-edit catalogs — the coordinator owns
`intl:extract`. New UI strings must go through `msg`/`t`/`Trans`
(the `no-literal-ui-string` rule fails the build otherwise) and be
checked under the pseudo-locale (`?locale=pseudo` on web).
