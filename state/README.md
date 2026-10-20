# state

Continuity for agents across sessions. `STATE.md` is the pointer;
`logs/` is the append-only journal. See `AGENTS.md` §2.

- `STATE.md` — current phase/slice, branch, next 3 steps, blockers.
  Updated end of every session. Keep under ~60 lines.
- `logs/YYYY-MM-DD-<topic>.md` — one file per session. Never edit old
  logs; write a new one. Paste test commands + results; write
  `not verified` when a check did not run.
- `tmp/` — scratch (gitignored). Never put continuity info only in tmp.
