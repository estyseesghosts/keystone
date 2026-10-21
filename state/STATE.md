# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: W4 Social, profile, notifications DONE 2026-10-21 on `main`
(N20/C11/C12/C13/C14/C15/C16/C18, N11, N18-badge, F22/MK1, F11-half,
MD1-partial/MD2/MD3 done; MD1 adapter remainder + N18 stream-status noted).
Tests green (94 suites / 1142 tests); tsc ios+android+web clean (expo-video
web pre-existing fixed type-only); oxlint + eslint clean. Web-visual:
phone/rail/full signed-in as akk1 in `state/logs/assets-w4/` (lists CRUD +
profile write verified live, rig clean). Authed rig probe
`scripts/fedi-w4-probe.ts` green on Akkoma `:4000`.
Logs: `state/logs/2026-10-21-w4-social.md`,
`state/logs/2026-10-21-w3-composer.md`, `state/logs/2026-10-21-w2-remainder.md`.
Register: `docs/parity-gaps.md` W4 rows current (MD1 partial, N18 partial,
F11/F23 partial-remainder noted); N10 saved-posts stays W5.
Earlier: W3/W2/W1 done on `main`; repo on one `main`; v1-parity register +
closure program own the backlog; G1–G4 owner reviews open.

## Next 3 steps

1. Start **W5 Screens & routing** (`docs/tasks/gap-closure.md`): N4 Explore,
   N5 Tag, N6–N9 lists/clips/antennas/drive, N10 saved posts, N12
   followers/following, N3 settings routes, N13–N17 shell/back/title,
   N22 icons.
2. Then W6 Mobile platform (safe area, composer sheet, F24 nested lists).
3. Owner reviews stay open (G1–G4). Device: Oppo `3B15A500TQD00000`
   unreachable today; still needs sign-in + write-action + keyboard/back pass.

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Misskey `:3101` / Sharkey `:3102` refused (MK live + misskey
  renote-mute list live unverified); Pinetree `:3000` no response today
  (MK14 blocked); akk1 inbox empty (notification rows with data not
  live-verified).
- iOS device run not attempted.
- Existing sessions hold pre-W4 OAuth scopes: re-auth needed for the new
  lists/bookmarks/mutes/blocks/filters grants (auto-upgrade rides W8/MD5).

## Links

- Gap register: `docs/parity-gaps.md` (W2/W3/W4 rows done; §10 workstreams)
- Gap program: `docs/tasks/gap-closure.md` (W1–W4 checked, W5 next)
- Handoff prompt: `docs/handoff-gap-closure.md`
- Tasks: `docs/tasks/` (index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Latest visuals: `state/logs/assets-w4/` (phone/rail/full/lists/profile)
