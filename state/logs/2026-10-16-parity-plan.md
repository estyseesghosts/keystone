# 2026-10-16 Frontend parity plan

Goal: plan-only companion to pinetree `docs/misskey-parity-plan.md` — no code changed.

What changed:
- Added `docs/frontend-parity-plan.md` (Status: Draft): Keystone UI for full
  `i/update` editor, private followers/reactions, Sharkey `rejectQuotes`,
  polls un-gate, scheduling + full drafts, persisted like emoji, pins/featured,
  edit vs delete-and-redraft, follower paging (done), notification
  grouping/filtering, timeline reply/block/mute rules + server CW, import/export.
  Order + verification per slice; 404-gated until backend slices land.
- Updated `docs/README.md` index with the new plan file.

Evidence:
- `git diff --check` clean; `frontend/` untouched (`git status --short` shows
  only docs/state files). No backends running here; no suites re-run.
- Conventions kept: Status line present, concrete endpoints/routes/components
  named, unsupported recorded, no implementation code, backend contract
  referenced not copied.

Open questions (same as backend plan):
- Literal "replies from followed only" in home vs Misskey parity.
- Per-user default emoji field vs per-note `reactionAcceptance` only.
- Server-injected CW vs upstream client-side soft-mute.
- Sharkey `notes/edit` scope (needs federated `Update(Note)`).

Next: implement in slice order once backend slices land; keep
`docs/api-surface.md` as the gate (never call an unlisted endpoint).
