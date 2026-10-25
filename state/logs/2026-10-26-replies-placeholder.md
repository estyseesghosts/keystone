# 2026-10-26 — replies-placeholder — coordinator

Follow-up to replies slice A (same agent, working tree).

Owner rejected two alignment attempts (font shrank once, still
misaligned twice). Root fix: the collapsed state no longer renders a
TextInput at all — it renders avatar + plain `Body` placeholder text +
Reply pill in one `alignItems: center` row. Two centered Text elements
at the same body metrics (15/21, never smaller) cannot misalign; no
TextInput internal text layout is tuned. Placeholder press expands to
the real input (`autoFocus` kept); expanded branch untouched.

Verification: `pnpm typecheck && pnpm lint && pnpm test` → 217 suites /
2967 tests green (no count change — same tests, new entry point).
Device/web runs → `not verified (owner live-tests externally)`.
