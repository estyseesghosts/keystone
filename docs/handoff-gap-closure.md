# Handoff prompt — keystonev2 gap closure

Copy the block below into a fresh implementer session (same repo).

---

You are the implementer for the **keystonev2 v1-parity gap-closure
program**. Work in `/Users/terezi/Local Documents/keystonev2` (call it
v2). The v1 reference is `/Users/terezi/Local Documents/Keystone` (read-
only: SolidJS SPA in `frontend/src`, fixture-only native prototype in
`mobile/`, specs in `docs/`, backend in `pinetree/` — ignore backend
internals except client-facing endpoints).

## Read first (mandatory, in order)

1. `AGENTS.md` — state protocol, architecture rules, verification rules.
2. `state/STATE.md` — current pointer.
3. `docs/parity-gaps.md` — **the backlog**. Every known gap is a row with
   an ID (`S1`, `N20`, `F5`, `C1`, `P1`, `MK2`, `MD1`, `Q1` …), evidence
   paths, state and priority. Read §0, §9, §10 and §11 before touching
   code.
4. `docs/tasks/gap-closure.md` — workstreams W1–W8 with checkboxes.
5. `docs/handoff-gap-closure.md` (this prompt), `docs/DECISIONS.md`,
   `rn-rebuild-plan.md` §2/§5, and the last 2–3 files in `state/logs/`.

## Mission

Close every actionable row in `docs/parity-gaps.md` in workstream order:

- **W1 Foundations** (start here): capability evidence into sessions/
  backends, one route table, legacy redirects, URL-backed Network tabs,
  Backend interface additions.
- **W2 Content & media**, **W3 Composer & actions**, **W4 Social/profile/
  notifications**, **W5 Screens & routing**, **W6 Mobile platform**,
  **W7 Settings/appearance/i18n**, **W8 Data correctness & docs**.

Do not try to do all eight in one session. One workstream per branch
(`p6.0-w1-foundations`, `p6.0-w2-content`, …), merged to `main` only after
its acceptance passes and the owner approves. If you finish a workstream,
pick the next one in order; W2/W3 both touch `PostCard`/`RichText`/
`Navigation`, so don't run them in parallel.

## Non-negotiable rules

- Fix `bug` rows first, then `unwired`, then `partial`/`missing`. Several
  rows are one import + one prop away — wire what exists before inventing
  anything.
- **Do not "fix" a `deferred` row** (§9) without a new `docs/DECISIONS.md`
  entry first. `planned` rows belong to Phase 5–7.
- Never mark a register row or task checkbox done without the verification
  in `docs/parity-gaps.md` §11. Write `not verified` when you did not run
  it. Task-index overstatement is itself tracked (Q1) — do not add to it.
- Keep `packages/fedi` pure TS (no react/react-native/expo/DOM),
  UI sees only domain models, every action gated on a `Capabilities`
  flag, tokens per origin, one allow-listed content AST.
- Follow v1 behaviour, not verbatim v1/Bluesky code (ADR-0001). Record
  consulted v1 paths in the session log, not code comments.
- Touch only files your workstream lists; log deviations.
- If a capability fact needs a live server (MK15/MD11), either probe it or
  leave the row `unverified` with evidence — do not guess.

## W1 first session — concrete scope

1. **S1 capability truth.** `detectServer()` already returns features;
   thread that evidence into `Session` (or a per-session feature store)
   and into `backendForSession` → `createMisskeyBackend`/
   `createMastodonBackend` → `buildCapabilities`. Keep conservative
   defaults when evidence is absent. Re-check consumers: quote posting,
   status editing, translation, bookmarks, scheduled posts, server drafts,
   lists, polls_multi.
2. **S3 one route table.** Make `src/routes.ts` the single source for
   `linking.config` (or add a drift test that fails when
   `Navigation.tsx`/`routes.ts` disagree). Fix `federated` vs `global`.
3. **N1/N2** add `/local`, `/social`, `/global`, `/search` redirects; make
   Network tabs URL-backed with canonical `/network/federated`.
4. **MD15** add missing `Backend` members (`channels`, `drive.folders`,
   `lists.create/update/delete`, `renoteMutes`) without changing existing
   call sites.
5. **MK15/MK13** probe the real Misskey/Sharkey facts you can; correct the
   flavor table or leave evidence-backed `unknown` values.

Acceptance for W1: one route table; capability gates reflect probed
evidence or stay honestly conservative; nav tests cover redirects and
`/network/federated`; trio green; update the register/task/STATE/log.

## Environment notes

- `pnpm` is not on PATH in this shell. Use `node_modules/.bin/tsc`,
  `node_modules/.bin/oxlint`, `node_modules/.bin/eslint`, and
  `NODE_ENV=test npx jest --forceExit --testTimeout=20000`.
- Native device: Oppo `3B15A500TQD00000` over USB adb (360 dp), app
  `app.keystone.dev`; a Metro server may already be running on :8081
  (`expo start --web`). `adb exec-out screencap -p > shot.png` for
  evidence. Do not start a second Metro or rebuild native unless a new
  native dep requires it.
- Web: `pnpm web` (or `npx expo start --web`). Test phone, rail (721–1000)
  and full (>1000) widths.
- Rig: Pinetree :3000 seed `ks1`/`password123` currently 401 and sends no
  CORS headers (owner); Akkoma :4000 works; Misskey :3101/Sharkey :3102
  are down. Treat live capability/rig verification as blocked, not as
  permission to guess.

## End-of-session protocol (from AGENTS.md §2)

1. New `state/logs/YYYY-MM-DD-<workstream>.md` with branch, goal, did,
   decisions, exact commands + results, deviations, next.
2. Update `docs/parity-gaps.md` row states and
   `docs/tasks/gap-closure.md` checkboxes.
3. Update `state/STATE.md` (status, next 3 steps, blockers).
4. New `docs/DECISIONS.md` lines for any load-bearing reversal/swap; ADR
   if wide consequence.
5. Run the trio and paste the result. If interrupted, end the log with
   `STATUS: interrupted — resume at <step>`.

## Definition of done for the program

Every `bug` and `P0` row is `done` or re-deferred with a DECISIONS line;
each workstream's acceptance is checked; device/web/rig evidence recorded;
register/task/STATE/logs current; `pnpm typecheck && pnpm lint && pnpm
test` green.

## Reporting back to the owner

After each session, reply with: workstream, rows closed (IDs), files
touched, verification paste, what remains in that workstream, and the next
recommended workstream. Do not summarize the whole register again — link
to it.
