# state/ — work logs and resume pointer

Two mechanisms, different jobs:

- `STATE.md` — **mutable** pointer to "where are we right now". Update it
  whenever reality changes (start, progress, interruption, finish). The next
  agent reads it first and can resume in under five minutes.
- `logs/` — **append-only** history. One file per session:
  `logs/YYYY-MM-DD-<topic>.md`. Never edit or delete a past entry; supersede
  by writing a new entry that references the old one.

Each log records: goal + doc references, what changed (files), evidence
(real command output, or `not yet verified`), open questions, next step.

If you stop with work uncommitted, unverified, or mid-task, say so in both
`STATE.md` and the log. An honest "half done, resume here" beats a tidy
fiction.
