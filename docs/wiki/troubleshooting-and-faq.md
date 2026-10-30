# Troubleshooting and FAQ

## "Connection refused" on 127.0.0.1:3101 or :3102

This means the local test servers (Misskey-family on 3101/3102, Mastodon-family on 4000) are not running. The app cannot reach a server that is off.

- Expected for agents and anyone without the server rig. The servers refuse connections because they were never started here.
- The owner starts them with the commands in `docs/setup.md` (note: parts of that file are stale; see below).
- You can still sign in to a **public** server over the internet. You do not need the local rig for that.

## "Dev client" vs Expo Go

- `pnpm start` starts a **dev client** server. It needs a dev-client build of the app on your phone.
- Plain **Expo Go** will not work with this project. If you open the QR code in Expo Go and it fails, that is why.
- Fix: build and install the dev client (`pnpm ios` or `pnpm android`), then scan the QR code again. Or use `pnpm web` to try the app in a browser instead.

## Web works but native fails (or the reverse)

Web, iOS, and Android have separate typecheck configs and some separate code (for example token storage: secure store on phones, a web fallback in browsers).

- Run the full check: `pnpm typecheck && pnpm lint && pnpm test`.
- Typecheck covers all three configs. A green web check does not prove native builds pass.
- Camera and photo-library access only exists where the platform allows it. Photo upload uses the image library, never the camera.

## A button is greyed out

This is usually correct behavior. The app greys out actions your server does not support, with a reason shown next to the button. Examples: clips and antennas on Mastodon, direct messages on Misskey. Do not report these as bugs unless the reason text is missing or wrong.

## A screen says "not available"

Same as above. Some screens only exist for one server family. The app shows an honest message instead of fake data.

## Something looks wrong after switching accounts

This should never happen. Every data request is tagged with the active account, and switching is covered by tests. If you see account A's posts while signed in as account B, report it: note both server addresses, what you tapped, and what you saw.

## Where to look

- **What just happened:** `state/logs/` has one journal file per work session, newest last. Start with the latest 1–3 files.
- **Where the project stands:** `state/STATE.md` lists status, next steps, and owner tasks.
- **Known gaps:** `docs/parity-gaps.md` lists features known to be missing or partial.
- **Backend checks:** `pnpm smoke` (read-only) and `pnpm probe:w4` / `w5` / `w8` / `wsc` (live checks, need a server and test account).
- **Recorded server replies:** `packages/fedi/test/fixtures/` holds saved server responses used by tests.
- **Browser checks:** `pnpm helium` drives the owner's Helium browser for signed-in web checks with screenshots.

## FAQ

**Is the app finished?**
No. Code repair finished 2026-10-25. Real-phone and live-server checks are still pending with the owner.

**Which server should I join?**
Any Misskey-family or Mastodon-family server (Mastodon itself, plus Akkoma/Pleroma via the Mastodon path). If you want reactions, antennas, and Drive, pick Misskey family. If you want the biggest network, pick Mastodon.

**Do I need a local server to try the app?**
No. Point the app at a public server and sign in there. The local rig is only for developers running tests.

**Where are my password and token stored?**
Tokens live in secure on-device storage (secure store on phones, the closest equivalent on web). Passwords are never stored. Sign-out deletes the token locally and asks the server to revoke it.
