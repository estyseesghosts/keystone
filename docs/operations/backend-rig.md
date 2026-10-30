# Backend rig

Servers (per `scripts/fedi-smoke.ts` `RIG_URLS` + `docs/setup.md` §1):

| Server                   | Origin                  | Notes                                                                              |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| Misskey-family (primary) | `http://127.0.0.1:3101` | Main Misskey-family rig                                                            |
| Misskey-family (second)  | `http://127.0.0.1:3102` | Second Misskey-family rig; fork quirks observed: short-page tails, `id: aidx`      |
| Mastodon-family          | `http://127.0.0.1:4000` | Akkoma; named in smoke only, not in `docs/setup.md`                                |
| `:3000` (legacy)         | `http://127.0.0.1:3000` | Old v1 rig slot (a Misskey clone) in `docs/setup.md` §§1–7; not part of the v2 rig |

`docs/setup.md` §§1–7 describe the old SolidJS/Vite frontend and its
dev-proxy modes — none of those commands exist in this repo (no
`dev`/`build` scripts, no Vite dependency in `package.json`). The live
sections are §8 (fixture capture) and §9 (probes), summarized below.

## Probes (read-only unless noted; failures exit nonzero)

```bash
pnpm smoke --all                        # detect/meta/timeline/post/account/me/stream/submodules per origin
pnpm smoke --url http://127.0.0.1:3101  # or FEDI_SMOKE_URL=<origin> (comma-separated)
pnpm probe:w4                            # W4 rows vs Akkoma :4000 (FEDI_W4_* overrides)
pnpm probe:w5                            # W5 rows vs Akkoma :4000 (FEDI_W5_* overrides)
pnpm probe:w8                            # W8 rows vs Akkoma :4000 (FEDI_W8_* overrides)
pnpm probe:wsc                           # remote-emoji round-trip (FEDI_W8_* overrides)
```

`pnpm smoke` needs no token (authed rows `skip` without
`FEDI_SMOKE_TOKEN`). All four `probe:*` scripts are authed
(password-grant against `:4000`) and delete anything they create. See
`docs/setup.md` §9 for the per-script row tables.

## Fixture capture (repair X5.6)

```bash
node scripts/fedi-capture.ts --dry-run   # no network; this is what CI runs
TOKEN="$(cat ~/.keystone-misskey-token)"
node scripts/fedi-capture.ts --family misskey --origin http://127.0.0.1:3101 --token "$TOKEN"
node scripts/fedi-capture.ts --family sharkey --origin http://127.0.0.1:3102 --token "$TOKEN"
```

The `--family` value is the capture script's slot name
(`scripts/fedi-capture.ts:62` accepts `misskey|sharkey|mastodon`); `:3102`
is the second Misskey-family rig.

Output: `packages/fedi/test/fixtures/<family>/` + `manifest.json`
(`source: recorded`, server version, date). Every response is redacted
before writing (credential values, `Bearer`, emails, IPv4 literals,
the passed token). Default is read-only; `--include-writes`
creates-then-deletes its own probe posts. `FEDI_CAPTURE_TOKEN` works
instead of `--token`. Review the diff before tests consume it —
recorded pages reflect the owner's account state (notification pages
go to `notifications-recorded.json`, never clobbering existing rows).

## Owner live + device checks (pending)

- Live-server checklist (12 items, rig refused agents):
  `docs/audit_20261025/live-checks.md`.
- Device checks (25 items, no simulator in agent env):
  `docs/audit_20261025/device-checks.md`.
- Browser parity driver: `pnpm helium <subcommand>`
  (`scripts/helium.mjs`; CDP on `:9222`, `CDP_PORT` overrides) —
  new-tab/goto/shot/eval plus type/click/fill helpers for signed-in
  web checks with screenshots.

Mark each `[ ]` → `[x]` with device/OS/server-version + result in
those files. Nothing here is verified until the owner runs it.
