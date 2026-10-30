# docs

Long-horizon project memory. `rn-rebuild-plan.md` (repo root) is the plan;
this folder holds its working records. See the [repo README](../README.md)
and [`state/STATE.md`](../state/STATE.md) for current status.

- `adr/` — Architecture Decision Records. Load-bearing decisions only,
  one file each, numbered. See `adr/README.md`.
- `tasks/` — One file per plan slice. Resumable checklists. See
  `tasks/README.md`.
- `wiki/` — Guides and background reading.
- `api/` — API reference.
- `operations/` — Operations runbook.
- `architecture.md` — System architecture overview.
- `DECISIONS.md` — One-line decision log (date + reason). Small swaps and
  reversals live here; wide-consequence ones get a full ADR.
- `setup.md` — Server rig setup (Misskey, Sharkey, Mastodon).
- `api-surface.md`, `mastoapi-contract.md` — Carried server specs,
  authoritative for server behaviour (copied from old Keystone per plan §3).
- `mfm.md`, `twemoji.md` — Carried content specs (MFM parsing, emoji).
- `note-options.md`, `quote-posts.md`, `replies.md` — Carried behaviour
  specs (composer options, quotes, reply threading).
- `i18n.md` — Localization workflow (Lingui extract/compile).
- `parity-gaps.md` — v1→v2 gap register (all known missing/partial/
  unwired/deferred work, with evidence and priorities). Working backlog.
- `handoff-gap-closure.md` — copy-paste prompt for the implementer taking
  over the gap-closure program.
- `audit_20261024/` — Audit report + repair plan from the 2026-10-24 audit.
- `audit_20261025/` — Audit report + repair plan (`repair.md`, all slices
  done) and owner checklists (`device-checks.md`, `live-checks.md`).
- `audit_20261026/` — Latest audit report and results.
