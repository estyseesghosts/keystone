# AGENTS.md — Keystone v2 (Expo + React Native, Bluesky model)

This repo is a long-horizon rebuild. Agents will work on it across many
sessions. Assume you have no memory of prior sessions. State on disk is
the only continuity.

Source of truth for the rebuild: `rn-rebuild-plan.md`.
Reference implementation: Bluesky `social-app` @ `cf16c1d` (read-only,
off-repo). Data layer to port: old Keystone `frontend/src/{core,misskey,mastodon,api}`.

## 1. Mandatory read order (every session)

1. This file (`AGENTS.md`)
2. `state/STATE.md` — where the project stands, what to do next
3. The latest 1–3 files in `state/logs/` — what just happened
4. The slice/phase in `rn-rebuild-plan.md` you were asked to do
5. Any `docs/tasks/*.md` and `docs/adr/*.md` linked from `state/STATE.md`

If `state/STATE.md` disagrees with a log or a plan, STATE wins for
"what to do next" but record the discrepancy in your session log.

## 2. Long-horizon state protocol (non-optional)

### `state/STATE.md` — the pointer

Single short file. Keep it under ~60 lines. It answers:

- Phase/slice and status (not started / in progress / blocked / done)
- Active branch name
- Next 3 concrete steps
- Open blockers (with owner, e.g. `owner: Xcode license`)
- Links to relevant tasks, ADRs, and latest logs

Update it at the end of every session. Never leave it stale.

### `state/logs/` — append-only session journal

One file per working session:

```
state/logs/YYYY-MM-DD-<slice-or-topic>.md
e.g. state/logs/2026-10-21-p1.1-scaffold.md
```

Template:

```md
# YYYY-MM-DD — <slice/topic> — <agent>
Branch: <name>
Goal: one sentence from the plan slice

Did:
- ...

Decided (→ ADR or DECISIONS entry if load-bearing):
- ...

Tests / verification (paste commands + results):
- `pnpm typecheck && pnpm lint && pnpm test` → ?
- device/web runs → pasted output, screenshot, or `not verified`

Deviations (files touched outside the slice + why):
- ...

Next:
- ...
```

Rules:

- Never edit an old log. New information goes in a new log.
- Never claim verification that did not run. Write `not verified` instead.
- Record Bluesky source paths consulted (e.g. `social-app/src/state/cache/post-shadow.ts`) in the log, not in code comments.
- If you had to touch files outside the slice scope, stop-if-major; if minor, do it and record why under `Deviations`.

### End-of-session checklist (do this before you stop)

- [ ] `state/logs/YYYY-MM-DD-*.md` written
- [ ] `state/STATE.md` updated (status, next steps, blockers)
- [ ] `docs/tasks/*.md` status boxes updated if you worked a task
- [ ] New load-bearing decision recorded as ADR (see §4)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` run, result pasted in log

If you cannot finish the checklist (context limit, interruption),
write a partial log ending with `STATUS: interrupted — resume at <step>`.

## 3. Tasks — `docs/tasks/`

Large phases become task files so future sessions can resume mid-phase
without re-reading the whole plan.

- Location: `docs/tasks/<phase>.<slice>-<topic>.md`
  (e.g. `docs/tasks/p1.1-expo-skeleton.md`)
- Index: `docs/tasks/README.md` with a status table.
- One task file per plan slice. Create it when starting a slice that
  lacks one; update checkboxes as you go.

Task file template:

```md
# P1.1 — Expo app skeleton
Plan ref: `rn-rebuild-plan.md` §5 Phase 1, slice 1.1
Status: not started | in progress | blocked | done
Branch: `p1.1-<topic>`

## Goal
One sentence.

## Read first
- paths…

## Steps
- [ ] 1. …
- [ ] 2. …

## Acceptance
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green
- [ ] …manual check…

## Out of scope
- …

## Log
- `state/logs/…` links
```

Keep task files small and factual. Discussion and dead ends go in the
session log, not the task file.

## 4. ADRs — `docs/adr/`

Any load-bearing decision gets an ADR. Load-bearing = framework choice,
data-model shape, auth/storage approach, dependency swap, dropped target,
or anything reversing the plan.

- Location: `docs/adr/NNNN-<slug>.md` (zero-padded, sequential).
- Index: `docs/adr/README.md`.
- Format: problem, options considered, decision, consequences, date.
- Start from `docs/adr/0000-template.md`. Do not renumber old ADRs.
- Small reversals and Bluesky dep swaps also go in
  `docs/DECISIONS.md` (one line each, with date); promote to full ADR
  when the consequence is wide.

Never silently reverse the plan. Record first (`§7 D1–D8` style), then code.

## 5. Work rules

- One slice per session, one branch per slice:
  `p<phase>.<slice>-<topic>` (e.g. `p2.3-mastodon-port`).
  Merge to `main` only after slice acceptance passes and owner approves.
- Touch only files the slice/task lists. Anything else is a deviation
  and must be logged.
- When Bluesky has a pattern for the thing, copy it. Check the
  reference clone first. Keep Bluesky's MIT notice in `NOTICE.md`.
- Unpublished Bluesky deps (`link:./modules/*`) are unavailable. Use the
  closest published package and record the swap in `docs/DECISIONS.md`.
- Conventions are enforced by lint/typecheck, not prose. If an agent
  keeps breaking a rule, add a lint rule (plan slice 1.2 pattern).

## 6. Product and architecture rules (carry-over, enforced)

- UI (`src/`) sees only `packages/fedi` domain models
  (`Post`, `Account`, `Notification`, `Capabilities`). Wire types never
  cross into `src/`. Lint-enforced (`no-wire-in-app`).
- `packages/fedi` is pure TS: no `react`, `react-native`, `expo*`,
  `#/` imports, no `window`/`document`. Lint-enforced (`no-ui-in-fedi`).
- Every query key includes `sessionId`. Multi-account correctness is
  tested (switching accounts never shows the previous account's data).
- Every action is gated on a `Capabilities` flag. Unsupported means
  hidden or disabled with a reason. Never ship inert controls. Never
  ship fake data.
- Content (MFM/HTML) parses to one allow-listed AST in `packages/fedi`.
  One `RichText` renders it everywhere. No `innerHTML`, no WebView.
- Tokens are per origin. Requests built from session A never carry
  session B's token or origin. Backend contract rules from old Keystone
  (Sharkey 400s on unknown fields, 204 handling, MiAuth/MiAuth token
  flow, Mastodon WebSocket streaming not SSE) stay authoritative —
  see `docs/` carried specs.
- Feed addressing uses `FeedDescriptor` strings from day one
  (plan §2). Deck columns are `{descriptor, sessionId, options}`.

## 7. Verification

- Every slice ends with `pnpm typecheck && pnpm lint && pnpm test`
  green, pasted into the log.
- Native/web runs paste evidence (screenshot or command output) or say
  `not verified`.
- Backend smoke (`scripts/fedi-smoke.ts` once it exists) pastes its
  result table per server on the rig (Misskey :3101, Sharkey :3102,
  Mastodon; see `docs/setup.md` once carried over).
- Ported tests must match original per-file counts; deltas are listed
  and justified in the log.

## 8. Layout (target)

```
packages/fedi/      pure TS data layer (core, misskey, mastodon, test/fixtures)
src/                app (alf, components, screens, features/deck, features/widgets,
                     state/session, state/queries, state/cache, storage, locale, lib)
docs/               carried server specs + DECISIONS.md + adr/ + tasks/
state/              STATE.md (pointer) + logs/ (append-only journal)
lint-rules/         custom ESLint rules + one test per rule
scripts/            fedi-smoke, translation import, etc.
```

If a path in this section does not exist yet, the scaffold slice has
not landed — check `state/STATE.md`.
