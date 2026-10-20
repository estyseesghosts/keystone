# ADR index

Load-bearing decisions. Numbered, append-only, never renumbered.

| ADR                      | Title                     | Date | Status |
| ------------------------ | ------------------------- | ---- | ------ |
| [0000](0000-template.md) | Template (not a decision) | —    | —      |
| [0001](0001-patterns-not-code.md) | Patterns, not code (Bluesky reference use) | 2026-10-20 | accepted |
| [0002](0002-butterfly-tarantula.md) | Two UI layouts: butterfly and tarantula | 2026-10-20 | accepted |

## When to write one

Framework choice, data-model shape, auth/storage approach, dependency
swap with wide blast radius, dropped target, or anything reversing
`rn-rebuild-plan.md`. Small swaps go in `../DECISIONS.md` as one-liners;
promote to ADR when consequences are wide.
