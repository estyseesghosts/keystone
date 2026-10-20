# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: W1 Foundations DONE 2026-10-20 on `main` (owner: main only;
`p6.0-w1-foundations` left at the consolidation point). Evidence reaches
sessions/backends, one route table, legacy redirects, URL-backed Network
tabs (`/network/federated` canonical), Backend +6 members, flavor table
corrected (live Pinetree/Akkoma probes + v1 sources). Trio green (77
suites / 961 tests). Log: `state/logs/2026-10-20-w1-foundations.md`.
Register: `docs/parity-gaps.md` S1/S3/N1/N2/MD15/MK15/MK2 done; C7/C8/C10
capability halves fixed, UI halves stay W3/W4.
Earlier: repo consolidated to one `main`; v1-parity sweep + settings tree
+ post detail; mobile shell width fix. Gate G4: write actions NOT verified
live; no device/web run this session. Gate G3: owner override recorded
2026-10-20; parity tick open.

## Next 3 steps

1. Start **W2 Content & media** (`docs/tasks/gap-closure.md`): mount
   Lightbox, media branches, Misskey quote mapping, mentions, polls UI,
   sanitizer `span.invisible`. One workstream at a time (W2/W3 share
   PostCard/RichText/Navigation — never parallel).
2. Then W3 Composer & post actions (edit UI, schedule picker + list,
   drafts UI, recipients).
3. Owner reviews stay open (G1–G4). Device: Oppo `3B15A500TQD00000` runs
   the app; still needs sign-in + write-action + back-button/URL pass.

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Misskey :3101 / Sharkey :3102 down (live probes blocked, stayed
  unknown); Pinetree :3000 seed 401 (owner) but public `/api/meta` probed;
  Akkoma :4000 works (quote/editing flags confirmed).
- iOS device run not attempted.

## Links

- Gap register: `docs/parity-gaps.md` (W1 rows done; §10 workstreams)
- Gap program: `docs/tasks/gap-closure.md` (W1 checked, W2 next)
- Handoff prompt: `docs/handoff-gap-closure.md`
- Tasks: `docs/tasks/` (p1.1–p4.6 done + butterfly, p4.7, p5.1,
  p3.1-signin-functional; index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Logs: `state/logs/2026-10-20-w1-foundations.md` (latest),
  `2026-10-20-repo-consolidation.md`, `2026-10-20-gap-audit.md`,
  `2026-10-21-android-build-fix.md`
