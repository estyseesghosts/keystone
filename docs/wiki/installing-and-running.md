# Installing and running

You need three things before you start: Node, pnpm, and (for phones) the platform tools.

## Prereqs

- **Node >= 24.19.** Check with `node --version`.
- **pnpm.** The repo pins version 12.14.0. Check with `pnpm --version`.
- **For iPhone builds:** Xcode, on a Mac.
- **For Android builds:** Android Studio with a working emulator or a plugged-in phone.

## Install

```bash
pnpm install
```

This downloads all dependencies. Run it once after cloning, and again whenever dependencies change.

## Launch commands

All commands run from the repo root (`/Users/terezi/keystone2` or wherever you cloned it).

| Command          | What it does                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm start`     | Starts the Expo dev server for the dev client on a phone. Scan the QR code with the dev build. |
| `pnpm web`       | Starts the app in a web browser on your computer.                                              |
| `pnpm ios`       | Builds and runs the native iOS app (needs Xcode, Mac only).                                    |
| `pnpm android`   | Builds and runs the native Android app (needs Android Studio or a device).                     |
| `pnpm build-web` | Makes a static web export you can host on a server.                                            |

## What each command means

- `pnpm start` does **not** open a normal Expo Go app. It needs a **dev client** build installed on your phone. See the troubleshooting page if you only have Expo Go.
- `pnpm web` is the fastest way to try the app. It runs in Chrome, Safari, or Firefox.
- `pnpm ios` and `pnpm android` compile real native apps. They take longer the first time.
- `pnpm build-web` writes files you can upload to static hosting. It does not start a server for you.

## Other useful commands

| Command                               | What it does                                              |
| ------------------------------------- | --------------------------------------------------------- |
| `pnpm typecheck`                      | Checks types for iOS, Android, and web configs.           |
| `pnpm lint`                           | Runs the linters. Must be clean (no errors, no warnings). |
| `pnpm test`                           | Runs the test suite (around 290 suites, 4100+ tests).     |
| `pnpm test-watch`                     | Re-runs tests as you edit files.                          |
| `pnpm smoke`                          | Read-only check against the local test servers.           |
| `pnpm probe:w4` / `w5` / `w8` / `wsc` | Deeper live-server checks (need a running server).        |
| `pnpm intl:extract` / `intl:compile`  | Updates translation files.                                |
| `pnpm prettier`                       | Checks formatting.                                        |

The standard health check is:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Server rig (optional)

To test against local servers instead of public ones, you need Misskey-family servers on ports 3101/3102 and a Mastodon-family server on port 4000. Setup details live in `docs/operations/backend-rig.md`. (The older `docs/setup.md` still describes the old version-1 app in places — treat `npm run dev` lines there as stale.)
