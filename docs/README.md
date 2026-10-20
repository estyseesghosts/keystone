# docs

Long-horizon project memory. `rn-rebuild-plan.md` (repo root) is the plan;
this folder holds its working records.

- `adr/` — Architecture Decision Records. Load-bearing decisions only,
  one file each, numbered. See `adr/README.md`.
- `tasks/` — One file per plan slice. Resumable checklists. See
  `tasks/README.md`.
- `DECISIONS.md` — One-line decision log (date + reason). Small swaps and
  reversals live here; wide-consequence ones get a full ADR.
- `parity-gaps.md` — v1→v2 gap register (all known missing/partial/
  unwired/deferred work, with evidence and priorities). Working backlog.
- `handoff-gap-closure.md` — copy-paste prompt for the implementer taking
  over the gap-closure program.
- Carried server specs (authoritative for server behaviour, copied from
  old Keystone per plan §3): `api-surface.md`, `mastoapi-contract.md`,
  `mfm.md`, `twemoji.md`, `setup.md`, `note-options.md`, `quote-posts.md`,
  `replies.md`. Not yet copied — scaffold slice (plan 1.2) lands them.
