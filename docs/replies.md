# Implementation Plan: Branched Replies in Keystone

**Status:** Implemented 2026-10-16 — Slices A–C (`src/api/thread.ts`,
`src/components/ReplyList.tsx`, `routes/Note.tsx` rewrite, reply-tree
styles). `tsc` + build green, 19/19 helper checks; live-API suites and
browser behavior **not yet verified** (no backends/browser here — owner).
**Codebase basis:** Keystone `main`, reviewed 2026-10-16  
**Scope:** Keystone frontend only; compatible with Pinetree, Misskey, and Sharkey

## 1. Goal

Render discussions as a real reply tree. Every reply belongs under the note it directly answers; siblings remain separate branches. Opening a reply must retain its ancestor context, and deeper branches must load without fetching the entire discussion at once.

```text
Root
├── Reply A
│   ├── Reply A1
│   │   └── Reply A1a
│   └── Reply A2
└── Reply B
    └── Reply B1
```

**Keep `Note.replyId` as the relationship source of truth.** Do not add a client-defined `threadId`, path, or required nested `children` field. The tree is derived from direct-child queries.

## 2. Existing behavior and API contract

`frontend/src/routes/Note.tsx` currently loads `notes/replies` for the selected note and renders the results as one flat `<For>` list. The selected note's parent is shown separately, but a multi-level ancestor chain is not loaded. The shared `Note` type already has `replyId`, `repliesCount`, and a one-level `reply` object.

Use the existing Misskey-family APIs consistently across all three backends:

| Endpoint | Use |
|---|---|
| `notes/replies` | Fetch **direct replies only** for one parent; page with `sinceId` / `untilId` and `limit` |
| `notes/conversation` | Fetch the selected note's ancestor chain, oldest-first; page with `offset` and `limit` as necessary |
| `notes/show` | Fetch the selected note and its existing parent context |
| `notes/children` | **Do not use for tree children.** Pinetree deliberately matches Misskey semantics by including direct replies plus quote-renotes |

`renoteId` alone does not create a reply edge. A quote note that also has `replyId` remains a reply to that parent; the embedded quote is not a child. Pure repost wrappers continue to use the existing `appearNoteOf` / renote logic.

## 3. UI structure

Keep the SolidJS-only stack. Extract recursive rendering and per-parent loading out of `Note.tsx` into small components, for example:

- `ReplyList`: fetches and pages the direct children of one parent.
- `ReplyBranch`: renders one child note and its expandable `ReplyList`.
- The existing `NoteDetail` route owns the selected note, its ancestor context, and the root-level reply composer.

Avoid building a large tree-management abstraction or moving this feature into a global state framework.

### 3.1 Selected note and ancestors

On `/notes/:id`:

1. Load the selected note with `notes/show`.
2. Resolve the displayed note with `appearNoteOf(note)`. For a pure repost wrapper, use the displayed/original note ID for ancestor and child queries, matching the composer and `NoteCard` behavior.
3. Load `notes/conversation` for that displayed note and render its visible ancestors oldest-first above it.
4. Render the displayed note normally.
5. Load its direct replies and show them by default, preserving current behavior.

Request ancestors in pages of up to the endpoint limit. Continue with `offset` only when a page is full, with a conservative maximum depth (512, matching Pinetree's current ancestor-walk guard). Never loop indefinitely on malformed data.

If the returned chain is incomplete because a parent is deleted, private, unknown, or omitted by the server, do not substitute a different ancestor or show cached private text. Show a neutral “Earlier reply context unavailable” marker when the target has a `replyId` but no visible ancestors, or when the earliest visible ancestor has a `replyId` pointing to a parent absent from the returned chain. Do not reveal the missing parent's ID or URI.

### 3.2 Branch expansion and paging

- The selected note's direct replies are expanded by default.
- Each nested reply has a **Show replies** / **Hide replies** control and loads its own direct replies only when expanded. Query using the displayed note ID (`appearNoteOf(note).id` for pure reposts), not a repost-wrapper ID. Do not hide the control solely because `repliesCount` is zero; counts can be stale or viewer-dependent.
- Keep loading, error, retry, exhaustion, expansion, cursor, and deduplication state local to each `ReplyList`. A failure in one branch must not replace or hide other branches.
- Use stable note IDs as Solid `<For>` keys. Merge paged results by ID.
- Preserve the server's existing sibling ordering (newest-first) and current `untilId` paging behavior; do not silently reverse order while adding nesting.
- Display a bounded visual indent and branch connector on narrow screens. Limit indentation in CSS, **not** the actual tree depth.
- Guard rendering against cycles and duplicate IDs. If a defensive depth limit is reached, show an explicit “Thread is too deep to expand here” state rather than recursing indefinitely.

A `ReplyBranch` should own the child-list state for its note. Do not hold a single global `replies[]` array for every branch: two parents can have independent cursors, loading states, and failures.

### 3.3 Replying and note actions

Keep the current reply workflow for the first slice: a reply card's note/reply-count link opens that note's detail route, where the composer uses that note's ID as `replyId`. This avoids introducing a second inline composer implementation.

Ensure navigation from any depth opens the correct note and its ancestors. Preserve existing quote/repost behavior; a quote must not appear as a child simply because it embeds another note. For this slice, nested reply cards retain their current read-only detail-page behavior; their note/time and reply-count links navigate to a full detail view where the existing actions are available. Do not present a disabled action as if it were active.

### 3.4 Unresolved remote parents

Pinetree currently drops the `inReplyTo` relationship when the parent is not cached. The Pinetree plan preserves the unresolved URI and withholds the note body from ordinary reads until the parent can be resolved safely. Keystone needs no special endpoint or wire field: once linked, the reply appears beneath its true parent through the standard `notes/replies` endpoint. Do not add a UI fallback that presents a Pinetree note with unresolved parentage as a known root.

## 4. Implementation slices

### Slice A — Ancestor context

- Add per-route ancestor state and call `notes/conversation`.
- Render ancestors oldest-first above the selected note.
- Reset ancestor, selected-note, and reply-list state when `:id` changes.
- Ensure delayed responses for an old route ID cannot overwrite the newly selected thread.
- Add loading, retry, empty, and incomplete-context states without replacing an already-rendered selected note on an ancestor-fetch failure.

### Slice B — Lazy reply branches

- Extract `ReplyList` and `ReplyBranch` from `routes/Note.tsx`.
- Replace the flat replies `<For>` with the root `ReplyList`.
- Keep the root list expanded by default; lazily load nested children.
- Move pagination/deduplication/error state to each list instance.
- Preserve links, CWs, media, quote cards, and current note actions.

### Slice C — Polish and compatibility

- Add bounded indentation and connector styling with keyboard-accessible expand/collapse buttons and visible focus states.
- Keep state stable when a reply is posted or when the user navigates between note IDs.
- Avoid automatic recursive refresh loops. In this slice, successful local creation updates the relevant parent branch; manual refresh remains the fallback for remote changes. Targeted branch invalidation from streaming can follow separately.
- Verify on Pinetree, Misskey, and Sharkey.

## 5. Acceptance tests

### Behavior

- Given `R`, direct replies `A` and `B`, and `A1` replying to `A`, the UI shows `A` and `B` under `R`, and `A1` under `A`—never all three at the same level.
- For `R → A → A1 → A1a`, opening `/notes/A1` shows the visible ancestor chain in order, then `A1` and its direct replies.
- Expanding `A` does not alter `B`'s loading state, cursor, or children.
- Paging one branch does not duplicate notes or insert siblings under a different parent.
- A reply created from the detail page of `A` uses `replyId = A.id`.
- A repost-only wrapper does not create a reply edge; a quote note appears under its `replyId` parent only if it is itself a reply. Its embedded quoted note is never added as a child.
- An unavailable/private/deleted ancestor's body is never shown from stale client state.
- An unresolved remote reply is withheld by Pinetree from ordinary reads rather than presented as a root; when resolution completes, it appears beneath its actual parent.
- A route change during pending network requests does not display the previous route's ancestors or replies.

### Verification

- `npm run build` succeeds.
- Existing Keystone smoke/sweep tests pass against all three backends.
- Manually verify mouse and keyboard expansion, deep nesting, mobile-width indentation, paging, retry, empty branches, and changing `/notes/:id` without a full reload.

## 6. Relevant code

- [`frontend/src/routes/Note.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Note.tsx) — current selected-note and flat-replies state.
- [`frontend/src/api/types.ts`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/api/types.ts) — shared `Note` wire type.
- [`frontend/src/components/NoteCard.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/NoteCard.tsx) — existing note rendering and note-detail links.
- [`docs/api-surface.md`](https://github.com/estyseesghosts/keystone/blob/main/docs/api-surface.md) — cross-backend endpoint contract.

## 7. Out of scope

- A new server API that returns an entire recursive tree.
- A client-side `threadId`, materialized path, or duplicated parent-child source of truth.
- Inline reply composers on every branch.
- Quote-post changes, a new streaming protocol, or a full thread-ranking algorithm.
