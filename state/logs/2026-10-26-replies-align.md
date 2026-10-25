# 2026-10-26 — replies-alignment-fix — coordinator

Follow-up to replies slice A (same agent, working tree).

Owner screenshot: collapsed "Post your reply" placeholder sat higher than the Reply pill label. Root cause: the row centered the *boxes* but the texts lived in different line boxes — input used body metrics (15/21) while the compact Reply pill label is a Caption (12/16, centered by pill padding).

Fix (`Note.tsx` only): collapsed input now uses the pill label's exact metrics (`typeSize.caption` / `lineHeight.caption` × `fontScaleMultiplier`, `paddingVertical: 0`, `textAlignVertical: center` kept). Same text line in both children + both boxes centered = shared vertical center. Theme-independent (tokens, not palette). Expanded layout, avatar, row height, behavior, copy, testIDs untouched. Test pins the metrics (no snapshots).

Verification: `pnpm typecheck && pnpm lint && pnpm test` → 217 suites / 2960 tests green (no count change — style-only + pins).
Device/web runs → `not verified (owner live-tests externally)`.
