# 2026-10-26 — replies-chains-redo — coordinator

Branch: `main`
Goal: Flat reply chains per owner spec (A→B→C shown, link reveals D onward; zero indent; stubs only on true parent-child adjacency; font reverted).

Did (fresh subagent, working tree — prior depth-stub attempt cancelled and discarded uncommitted):

- `Note.tsx` — deleted `ReplyChain`/`ReplyRow` nesting visuals, `CHAIN_AUTO_DEPTH`, `threadEdge` borders, all indent/paddingLeft/depth styling. New model: `RootReply` per direct reply (row A + oldest-first children fetch + `ChainSpine`), `ChainSpine` lineal descent (B level 1, C level 2, recurse while `level < 2`), terminal node renders the ONE `Show more replies…` text link (gated on skipped-siblings-or-children — never inert) revealing the full remaining subtree (`FullSubtree`, DFS, per-level oldest-first, no further links). Fork choice: lineal child = oldest (`items[0]`); skipped younger siblings ride `youngerAbove` into the reveal.
- Spine: `ReplyRowView` full-width + pointer-transparent absolute overlay before `PostCard` (avatars sit on the line, taps unaffected; geometry from PostCard source: x=36, joint y=32). TOP stub iff row above is parent; BOTTOM stub iff shown child directly below. Root rows never top; link/leaf/sibling rows stub-free.
- Composer font (owner correction): collapsed input REVERTED to body metrics (15/21 × multiplier); centering is layout-only (wrapper `alignSelf: stretch` + `justifyContent: center`, input `paddingVertical: 0` + `textAlignVertical: center`). Expanded side untouched.
- Kept: chronological order (verified per-family read-site sort), load-more text link, error/retry/empty states, E10 invalidation, PostCard, query hooks/keys. `isChainCapped` (64) silent backstop.
- Tests in `Note.test.tsx`: A→B→C→link→D(+E) with exact stub presence/absence, zero-indent props, one link, one-tap full reveal, oldest-child fork + sibling spine break, DFS order, cycle no-hang, collapsed body-metrics pins.
- Coordinator: one-line fix — `StyleSheet.absoluteFillObject` → `absoluteFill` (doesn't exist in this RN version). Test-only fallout: none.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green (after the one-line fix).
- `pnpm lint` → green.
- `pnpm test` → 217 suites / 2960 tests passed. One transient `Clip.test.tsx` failure (75s timeout) under parallel load; passes in isolation (4.9s) and full re-run green — load flake, unrelated file (no Note import), no product change in response.
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. `Note.tsx` + its test only.

Next:

- Replies program complete per owner spec — owner live-tests externally (chain look vs X, show-more pacing, collapsed row alignment on device).
