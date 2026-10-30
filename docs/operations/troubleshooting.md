# Troubleshooting

Symptom → cause → fix. Each item cites the evidence trail.

## Metro serves stale bundles / "Failed to get the SHA-1"

- **Cause:** Metro runs on its Node crawler (`@expo/metro-config`
  forces `resolver.useWatchman` to `null`), which misses files created
  or changed after Metro starts — including babel-generated
  `node_modules/react-native-worklets/.worklets/*.js` and edited
  sources. Worklets `bundleMode` made it worse (mid-build generated
  files on every bundle).
- **Fix:** install watchman (`brew install watchman`) —
  `metro.config.ts` re-enables it (`resolver.useWatchman = true`).
  `bundleMode` stays off (`babel.config.js` drops `bundleMode: true`);
  classic inline worklets need no generated files.
  Evidence: `docs/DECISIONS.md` 2026-10-22 mobile-bring-up rows (×2).

## `expo run:ios` / `run:android` fails after adding a dependency

- **Cause:** new native modules ride a dev-client rebuild; plain JS
  bundling is not enough.
- **Fix:** rebuild the dev client (`pnpm ios` / `pnpm android` do
  full `run:` builds). Never depend on transitive hoisting
  (`expo-file-system` is present only transitively — no code may rely
  on it). Evidence: `docs/DECISIONS.md` 2026-10-21 W7 row
  (document-picker/sharing deferred for exactly this reason).

## Port already in use (Expo / Metro)

- **Cause:** a previous `pnpm start`/`web`/`ios`/`android` is still
  holding the port, or two are running at once.
- **Fix:** kill the old process (or `lsof -ti :<port> | xargs kill`),
  then restart. One server at a time per platform.

## iOS MMKV backup exclusion warning

- **Cause:** known gap, not a misconfiguration — setting
  `NSURLIsExcludedFromBackupKey` needs a declared `expo-file-system`
  dep (transitive-only today) or a native modulette + rebuild.
- **Fix:** none yet — tracked follow-up in `state/STATE.md` (owner:
  confirm approach). Android side is done (`allowBackup: false` in
  `app.config.js:55` + data-extraction rules from
  `withAndroidHardening`). Evidence: `docs/DECISIONS.md` 2026-10-25
  X1.6 row; `docs/audit_20261025/device-checks.md` §9.

## Non-English UI renders English (or pseudo-locale leaks `[]`)

- **Cause:** by design — only the `en` catalog ships finished; the 7
  carried locales fall back to the English source per message
  (owner decision, repair program scope). `pseudo` is dev-only and must
  never enter `SUPPORTED_LOCALES`.
- **Fix:** run `pnpm intl:extract` (never hand-edit catalogs) +
  `pnpm intl:compile`; check new strings under `?locale=pseudo`
  (anything still plain English is an untranslated literal — route it
  through Lingui). A future translator fills
  `src/locale/locales/<code>/messages.po`. Evidence: `docs/i18n.md`
  §§"Intentionally untranslated locales", "Adding a string".

## `pnpm test` hangs / open-handles noise

- **Cause:** `test:handles` (`--detectOpenHandles`) never goes clean
  on this tree.
- **Fix:** nothing to fix — `pnpm test` keeps `--forceExit` by design
  (see `state/STATE.md` gate baseline). Do not remove the flag to
  "fix" a hang; investigate the hanging test instead.

## Web build shows stale session / token issues

- **Cause:** web tokens are `localStorage`-backed and dev-grade by
  design (no OS keychain on web) — any XSS exfiltrates them.
- **Fix:** do not ship the web build to users until the token store
  moves to an `httpOnly`-proxied session (out of scope). Until then,
  serve the strict headers in `docs/web-hosting.md` (CSP without
  `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`).
  Native is unaffected (ADR 0011 vault).
