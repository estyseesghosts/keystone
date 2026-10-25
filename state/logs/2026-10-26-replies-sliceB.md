# 2026-10-26 — replies-sliceB — coordinator

Branch: `main`
Goal: Replies redesign slice B — chronological chains + subtle show-more (flatten the tree, kill the chunky pills).

Did (subagent, working tree):

- `Note.tsx` — deleted `ReplyBranch` recursion, Show/Hide pill buttons, the `Replies (N)` caption row, and the "Thread is too deep" dead-end. `RootReplyRow` subsumed by `ReplyRow`. New `ReplyChain`: inline chains auto-expanded to depth ≤ 1 (`CHAIN_AUTO_DEPTH`, direct replies + one level) inside the reused `threadEdge` avatar-column spine; deeper levels collapse behind a Caption-sized muted "Show more replies…" text `Pressable` (one more level per tap, renders only once real children are known — never inert; collapsed-error shows a text Retry). `MAX_DEPTH` → `MAX_CHAIN_DEPTH` (64, exported predicate `isChainCapped`) as the silent cycle backstop — no dead-end text anywhere.
- Order: `chronological()` sorts by `Date.parse(createdAt)` ascending at the read site (both root + chain levels). Verified per family instead of assuming: Misskey `notes/replies` is newest-first, Mastodon `context` descendants oldest-first — a blind reverse would have broken Mastodon. Query hooks/keys/feed order untouched.
- Kept + de-chunked: root "Load more replies" pagination and Retry are now text links; `Loading…` stays a plain caption; empty state unchanged. `PagedList` (reposts/reactions), `InlineReply`, overlay composer untouched. PostCard tap → own Note screen verified, PostCard untouched.
- Tests in `Note.test.tsx`: thread mock made id-aware (chains render inline now); F24/E8 tests rewritten (no pills); 5 new slice-B tests (oldest-first via FlatList data prop, show-more expands, cursor pagination, 2-cycle one-level-per-tap no hang, `isChainCapped` boundaries). En-source copy only.
- Coordinator: hunks reviewed (hooks before early returns, keys unchanged, no product fixes needed).

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2960 tests passed (pre-slice: 217 / 2955; +5).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. `Note.tsx` + its test only.

Next:

- Replies redesign complete. Owner live-tests externally (inline composer feel, chain look vs competitors, show-more behavior on deep threads).
