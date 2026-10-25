# 2026-10-26 — deep-chains — coordinator

Branch: `main`
Goal: Deep-chain Note view (compact spine-connected ancestors, redundant "Replying to" suppression, unmistakable focused post).

Did (subagent, working tree):

- `PostCard.tsx` — two additive-optional props (feed defaults unchanged): `context` (smaller size-13 body, no action bar, no reaction counts — avatar + name + body stay) and `hideReplyContext` (forces `replyTarget` null). No behavior change for existing callers.
- `Note.tsx` — ancestors render via new `AncestorRowView` (`PostCard context`, same avatar-column spine overlay idiom as reply chains, `ancestor-spine-top/bottom-*` testIDs); focused wrapper keeps bgSoft/borders/full card + gains a receiving `focused-spine-top-*` stub. Suppression rule (adjacency: hide only when the replied-to post is the row directly above): chained ancestors (i>0 + replyToId match), focused (ancestors non-empty + not incomplete + replyToId = last ancestor), chain B/C (`hide=true`), root A (`false`), `FullSubtree` (`isFirst`), orphan/incomplete keep.
- Tests: 4 new `it`s in place (compact + spine + focused wrapper; chained ancestors hide; orphan keeps + incomplete marker; chain B/C hide + A keeps).

Coordinator fixes (test-only, no product change):

- Real cross-test poisoning (not a flake): `postShadowStore` is a module singleton and the F20 delete test patches `isDeleted` on p1 without resetting after — every later test mounting the focused post rendered null (ancestors unaffected, wrapper-level assertions passed vacuously). Fixed with a `postShadowStore.reset()` in the file-level `beforeEach` (dynamic import, matching F20's cycle-avoidance). This was the compact-test failure.
- Real test race (not a flake): the cycle test's `getByTestId('reply-ca')` throws when A=ca and C=ca both render before the first assertion (load-dependent). Rewrote with `getAllByTestId` length assertions.
- `findByTestId` (instead of `getBy`) for the focused actions row; 20s budget on the heavy compact mount + 60s on the 64-deep adversarial cycle reveal (same budget class as postquote-emoji). Verified via worktree-style reasoning: isolated passes + block passes + poisoned-file fails = shared-state leak, confirmed by reading the singleton.

Tests / verification (paste commands + results):

- `pnpm typecheck` (ios+android+web) → green, no output.
- `pnpm lint` → green, no output.
- `pnpm test` → 217 suites / 2967 tests passed (pre-slice: 217 / 2963; +4).
- Device/web runs → `not verified`. Rig `:3101`/`:3102` → `not verified (owner live-tests externally)`.

Deviations (files touched outside the slice + why):

- None. `PostCard.tsx` (additive props) + `Note.tsx` + its test.

Next:

- Owner live-tests externally (ancestor context look vs X competitor, redundant-caption gone, focused distinction on a real deep chain).
