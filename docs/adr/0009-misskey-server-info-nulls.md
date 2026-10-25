# ADR 0009 — Nullable `MisskeyServerInfo` fields (never invent hardware numbers)

Date: 2026-10-24
Status: accepted
Plan ref: `docs/audit_20261024/repair.md` R1.1 (B11)

## Problem

`fetchServerInfo` (`packages/fedi/src/misskey/admin.ts`) fell back to `""`
for missing machine/os/node/psql/cpu.model strings and `0` for missing
cpu.cores/mem/fs numbers, and core `MisskeyServerInfo` typed those fields
as non-nullable, so the type forced the lie: a Sharkey/Misskey server that
omitted the hardware snapshot rendered as "0 cores / 0 bytes" — a real
measurement the server never reported. This violates the never-fake-data
rule. `MisskeyQueueCounts` (same file) already reads every counter
`number | null` via `numOrNull` — the precedent this ADR extends.

## Options considered

1. Keep `string`/`number` and keep the `""`/`0` fallbacks (status quo ante)
   — rejected: fabricates user-visible hardware numbers.
2. Widen every field to `| null`, read missing fields as null via the
   existing `strOrNull`/`numOrNull` helpers (matching `fetchQueueStats`),
   render nulls as '—' — chosen.
3. Omit missing fields from the object — rejected: callers would still need
   optional chaining on every field with no cleaner semantics than null.

## Decision

`MisskeyServerInfo` fields are `| null`: machine/os/node/psql strings,
`cpu.model`/`cpu.cores`, `memTotal`, `fsTotal`, `fsUsed`. Missing values
adapt to null ("not reported", never zero) via `strOrNull`/`numOrNull`.
`AdminInsight` renders nulls as '—' (`formatBytes` accepts
`number | null`; cores render `?? '—'`).

## Consequences

- Good: no fabricated "0 cores / 0 bytes" rows; unreported hardware reads
  as absent, same as unreported queue counters.
- Bad / accepted risk: sections with null hardware show '—' placeholders
  (same as the queue-stats missing-counter precedent).
- Follow-ups: `{}` fixture response adapts to all-nulls (test-pinned);
  full-snapshot fixtures unchanged.
