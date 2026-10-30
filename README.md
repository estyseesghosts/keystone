# Keystone v2

![Keystone](keystone.png)

A fediverse client for **Misskey and Mastodon**, built as one
Expo + React Native app that ships to **iOS, Android and web** (`react-native-web`).

Keystone v2 is a rebuild of the original SolidJS Keystone. It follows the
architecture of Bluesky's `social-app` (Expo, React Navigation, TanStack Query,
MMKV, Lingui, an atomic style system) while keeping Keystone's backend-agnostic
data layer. See [`rn-rebuild-plan.md`](rn-rebuild-plan.md) for the full rationale.
No Bluesky source is vendored ([`NOTICE.md`](NOTICE.md),
[ADR 0001](docs/adr/0001-patterns-not-code.md)).

## Status

Repair program **2026-10-25 complete** (59/59 slices done). Final gate baseline:
**292 suites / 4123 tests**, typecheck (ios+android+web) + lint clean.
Still pending: owner device checks, rig live checks, and the tracked follow-ups.
No marketing polish claims — see [`state/STATE.md`](state/STATE.md) for what is
actually next.

## Layout

```
packages/fedi/   pure TypeScript data layer: core, misskey, mastodon, recorded fixtures
src/             the app: alf (design system), components, screens, state, storage, locale, lib
docs/            server specs, ADRs (docs/adr), decisions log, task files, wiki, api, operations
state/           STATE.md pointer + append-only session logs
lint-rules/      custom ESLint rules, one test per rule
scripts/         fedi-smoke, probes, helpers
plugins/         Expo config plugins
android/ ios/    native projects (prebuilt by Expo prebuild)
```

## Architecture rules

These are enforced by lint and tests, not just convention:

- `src/` only sees `packages/fedi` domain models (`Post`, `Account`,
  `Notification`, `Capabilities`). Wire types never cross over (`no-wire-in-app`).
- `packages/fedi` is pure TS: no React, React Native, Expo or DOM (`no-ui-in-fedi`).
- Every query key includes `sessionId`; switching accounts never shows another
  account's data.
- Every action is gated on a `Capabilities` flag. No inert controls, no fake data.
- MFM/HTML parses to one allow-listed AST and renders through a single `RichText`.
  No `innerHTML`, no WebView.
- Tokens are per origin; a request built from one session never carries another's
  token or origin.
- Feeds are addressed by `FeedDescriptor` strings; deck columns are
  `{descriptor, sessionId, options}`.

## Getting started

Requirements: Node >= 24.19, pnpm, and Xcode / Android Studio for native builds.

```bash
pnpm install

pnpm start        # Expo dev client
pnpm web          # web
pnpm ios          # native iOS build
pnpm android      # native Android build
pnpm build-web    # static web export
```

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm test
```

`typecheck` covers iOS, Android and web configs. Other useful scripts:

| Script                                | Purpose                                         |
| ------------------------------------- | ----------------------------------------------- |
| `pnpm test-watch`                     | Jest in watch mode                              |
| `pnpm smoke`                          | Backend smoke test against the local server rig |
| `pnpm probe:w4` / `w5` / `w8` / `wsc` | Targeted backend probes                         |
| `pnpm intl:extract` / `intl:compile`  | Lingui translation workflow                     |
| `pnpm prettier`                       | Formatting check                                |

Server rig setup (Misskey-family, Mastodon-family) is described in
[`docs/setup.md`](docs/setup.md).

## Working in this repo

Read [`AGENTS.md`](AGENTS.md) first, then [`state/STATE.md`](state/STATE.md):
one slice per session, state on disk, decisions recorded as ADRs.

## Docs

- [`rn-rebuild-plan.md`](rn-rebuild-plan.md): the rebuild plan
- [`docs/`](docs/README.md): docs index (start here)
- [`docs/architecture.md`](docs/architecture.md): system architecture
- [`docs/wiki/`](docs/wiki/): guides and background reading
- [`docs/api/`](docs/api/): API reference
- [`docs/operations/`](docs/operations/): operations runbook
- [`docs/adr/`](docs/adr/README.md): architecture decision records
- [`docs/DECISIONS.md`](docs/DECISIONS.md): small decisions log
- [`docs/api-surface.md`](docs/api-surface.md), [`docs/mastoapi-contract.md`](docs/mastoapi-contract.md): backend contracts
- [`docs/mfm.md`](docs/mfm.md), [`docs/i18n.md`](docs/i18n.md): content and localization
- [`docs/setup.md`](docs/setup.md): server rig setup
