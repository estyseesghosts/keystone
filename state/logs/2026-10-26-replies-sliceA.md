# 2026-10-26 — replies-sliceA — coordinator

Branch: `main`
Goal: Replies redesign slice A — inline reply composer on the Note screen (X-style), replacing the "Post your reply" overlay-button box.

Did (subagent, working tree):

- `Note.tsx` — deleted `ReplyEntry`; new `InlineReply` (colocated, no new dir): viewer avatar (initial fallback) + expanding input + Reply pill. Collapsed = ONE compact row (avatar-height, vertically centered input + Reply, no toolbar subtree rendered); first focus/typing expands to the growing input + toolbar (media + emoji), sticky, `autoFocus` carries the keyboard across the branch switch.
- Reused, no forks: `useCreatePost` mutation (`replyTo` preset, same validate→upload→build→mutate as the overlay), `useAutogrowInput` (40px rest → 240px), `useUploads` + `pickMedia` (denied/cancelled/over-cap honest errors), `EmojiPicker` in `AnchoredPopup` (caret insertion, `Keyboard.dismiss` E5 idiom), `composeGates` (media disabled with reason), `Button disabledReason` (Reply gating), `defaultVisibilityFor` (replies never widen the parent), `composeDefaultsFor` (no extra instance fetch — server stays authoritative).
- Invalidation closes E10 for this path: `threadRepliesQueryKey(sessionId, focused.id)` + `threadQueryKey(sessionId, threadId)` (patch can't reach `PostThread`-shaped data). Success clears input; failure keeps text with inline honest error. Signed-out renders the screen's existing prompt (composer never mounts). Alt-text editing stays overlay-only (staged uploads go with empty alt).
- Tests in `Note.test.tsx` (+~10): type+Reply posts (draft `replyId`, gating, refetch, clear), failure-keeps-text, collapsed/expanded layout pins (row centering, minHeights, toolbar absent→present, blur stays expanded), emoji insertion via `emoji-cell-😀`. En-source copy only, no locale churn.
- Coordinator: no product changes needed this round; hunks reviewed (mutation path, keys, gating all as specified).

Owner feedback folded in same-slice (2 rounds): (1) toolbar hidden until first interaction + emoji button added; (2) collapsed state is a genuinely one-row compact layout, not hidden buttons in a tall box.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2955 tests passed (pre-slice: 217 / 2951; +4).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. `Note.tsx` + its test only.

Next:

- Slice B: chronological chains + subtle show-more (flatten the tree, delete Show/Hide pills, avatar-column connectors).
