Below is a self-contained guide you can hand to the implementing agent. It assumes nothing beyond the repo state at `main`.

---

# Implementation Guide — Note "⋯" Options Menu (Keystone)

## 0. Read first (in this order)

1. `AGENTS.md` — repo-wide rules (SolidJS-only, no inert controls, verification protocol).
2. `state/STATE.md` and the newest file in `state/logs/` — current phase and any in-flight work.
3. `docs/api-surface.md` — the verified endpoint matrix. **This file is authoritative** on what the backends support; never call an endpoint not listed there without first probing it and recording the result.
4. `solidjs.md` §10 (checklist) before returning any Solid code.
5. These reference files for house style:
   - `frontend/src/components/VisibilityPicker.tsx` — the vispick menu pattern (signal open-state, outside-click/Escape dismiss via `createEffect` + `onCleanup`, `role="menu"`/`menuitemradio`).
   - `frontend/src/components/AccountCard.tsx` — the portal + `position: fixed` flyout pattern (`MenuPos`, `flyoutStyle`, dismiss-on-scroll/resize, Escape restores focus).
   - `frontend/src/components/Composer.tsx` (~line 806) — how `.vispick-menu` is extended with a modifier (`.optmenu`) for the composer's More menu.
   - `frontend/src/components/icons.tsx` — the icon conventions (`Base` wrapper, 24×24 viewBox, stroke `currentColor`, `aria-hidden`).
   - `frontend/src/api/backend.ts` — `BACKEND_ID` (`"pinetree" | "misskey" | "sharkey"`), the per-backend discriminator.
   - `docs/postoptions.png` + `docs/postoptionsuser.png` — the two-tier reference menu (visual target for *content*, not chrome).

Reference screenshots show a Misskey.io client. **Keystone's chrome wins**: the menu must look like Keystone's existing flyout (vispick card), not the reference's dark panel.

---

## 1. Goal

Add a `⋯` trigger as the last button in the note action row (`NoteCard`'s `.noteactions`), opening a two-tier menu:

- **Tier 1 (note menu)** — copy/share/remote actions, separator, Mute thread, User ▸ (opens tier 2), Report, Delete.
- **Tier 2 (user submenu)** — copy username/profile URL, View on remote instance, separator, Mute, Mute Boosts, Block.

Every row has a **unique** SVG icon (no two rows in a visible menu may share a glyph). Reference icon choices are a starting point; distinctness is a hard requirement.

---

## 2. Scope decisions (locked — do not relitigate)

- **v1 ships** the menu shell, client-only actions, the User submenu, **Delete for own notes**, and **disabled-with-reason placeholders** for every unverified server action.
- **Unverified actions render disabled with a reason** (`disabled` + `title` + `aria-disabled`, no hover affordance), *except*:
- **Data-inapplicable actions are omitted entirely** — e.g. "Copy remote link" / "View on remote instance" do not render for a local note (no `uri`) or a local user (`host === null`). A disabled "remote" row on local content is noise; a disabled "favorites" row communicates planned support.
- **Omitted from v1 entirely** (these are out of scope, not placeholders): nothing further — Translate, favorites, Clip, RSS, memo, lists, antennas, notify, DM, search, refresh all appear as disabled placeholders per the user's amendment.
- No theme work, no accent colors, no animation beyond existing hover transitions, no new dependencies. Vite stays build-tooling only.

---

## 3. Files

| File | Change |
|---|---|
| `frontend/src/components/icons.tsx` | Add the icon set (§4) |
| `frontend/src/components/NoteMenu.tsx` | **New** — trigger + menu + submenu (§5, §6) |
| `frontend/src/components/NoteCard.tsx` | Render the `⋯` trigger as the last `.noteactions` child; pass note, handlers |
| `frontend/src/styles/global.css` | `.notemenu` modifier rules (§7) |
| `docs/frontend-plan.md` | Add this feature to the scope checklist |
| `docs/api-surface.md` | Only when slice 3 verifies new endpoints |
| `state/STATE.md` + `state/logs/YYYY-MM-DD-note-menu.md` | Per the interruption protocol, before finishing |

---

## 4. New icons (`icons.tsx`)

All use the existing `Base` wrapper (`size={18}` default), stroke style, `currentColor`, `aria-hidden`. Add:

| Export | Glyph |
|---|---|
| `CopyContentsIcon` | two overlapping rounded rects |
| `LinkIcon` | chain link (diagonal) |
| `RemoteLinkIcon` | chain link with a small globe (must be visually distinct from `LinkIcon`) |
| `ExternalLinkIcon` | square with outbound arrow |
| `ShareIcon` | three-node share (dots + connectors) |
| `TranslateIcon` | 文A-style glyph (two letters + baseline mark) — used only by the disabled Translate row |
| `BellOffIcon` | bell with slash |
| `UserIcon` | single person |
| `ReportIcon` | circle with `!` |
| `DeleteIcon` | trash can |
| `StarIcon` | outline star (favorites placeholder) |
| `ClipIcon` | paperclip |
| `MuteIcon` | crossed-out cloud |
| `BlockIcon` | circle with diagonal slash |
| `RssIcon` | dot + two arcs |
| `ListIcon` | three stacked lines (Add to list placeholder) |
| `MailIcon` | envelope (Send a message / notify placeholders) |
| `MemoIcon` | pencil variant distinct from the existing `PencilIcon` (e.g. pencil over a line) |
| `RefreshIcon` | circular arrows |
| `ChevRightIcon` | single right chevron (submenu indicator; `CollapseIcon` renders two chevrons — do not reuse) |

Reuse (already exported): `AtIcon` (Copy username), `SearchIcon` (Search this user's notes), `RepostIcon` (Mute Boosts — unique within the menu), `MoreIcon` (the `⋯` trigger), `PencilIcon` if you prefer it for memo (then drop `MemoIcon`).

Verify each icon renders at 18px in both themes before moving on.

---

## 5. `NoteMenu.tsx` — structure

```tsx
export default function NoteMenu(props: {
  note: Note;                 // the SHOWN note (caller passes appearNoteOf(note))
  me: UserLite | null;        // current user or null when logged out
  onChanged?: () => void;
  onQuote?: (note: Note) => void;   // unused in v1; reserved
})
```

### Data model

```ts
type MenuItem = {
  id: string;
  label: string;
  icon: JSX.Element;
  disabled?: () => boolean;      // reactive: computed per render
  disabledReason?: string;       // shown as title when disabled
  run?: () => void;              // absent + disabled → placeholder row
  confirm?: { question: string; action: string };  // two-step confirm rows
  submenu?: () => JSX.Element;   // only "User" in v1
};
type MenuSection = { items: MenuItem[]; sep?: boolean }; // sep renders a hairline after
```

Build the sections **inside the component** (not module scope) so they close over `props` reactively. Item visibility is `<Show when={...}>` per item, never setup-time `if`.

### Tier 1 — exact rows

| id | label | icon | behavior |
|---|---|---|---|
| `copy-contents` | Copy contents | `CopyContentsIcon` | `writeText(props.note.text ?? "")`; announce "Copied" |
| `copy-link` | Copy link | `LinkIcon` | `writeText(\`${location.origin}/notes/${note.id}\`)` |
| `copy-remote-link` | Copy remote link | `RemoteLinkIcon` | `writeText(note.uri)`; **`<Show when={note.uri}>`** — omitted for local notes |
| `view-remote` | View on remote instance | `ExternalLinkIcon` | `window.open(note.uri, "_blank", "noopener,noreferrer")`; omitted unless `note.uri` exists **and** differs from the local URL |
| `share` | Share | `ShareIcon` | `navigator.share?.({url})` when available, else clipboard fallback |
| *sep* | | | |
| `translate` | Translate | `TranslateIcon` | **disabled** — reason: `"Unavailable — no translation endpoint"` |
| `mute-thread` | Mute thread | `BellOffIcon` | **disabled** — reason: `"Unavailable — endpoint not yet verified"` |
| `favorites` | Add to favorites | `StarIcon` | **disabled** — same reason |
| `clip` | Clip | `ClipIcon` + `ChevRightIcon` | **disabled** — reason: `"Unavailable — clips not yet supported"` (chevron shown, no submenu) |
| `user` | User | `UserIcon` + `ChevRightIcon` | opens tier 2 |
| *sep* | | | |
| `report` | Report | `ReportIcon` | **disabled** — `"Unavailable — endpoint not yet verified"` |
| `delete` | Delete | `DeleteIcon` | **only when** `props.me && note.userId === props.me.id`; two-step confirm "Delete this post?" → calls `apiDelete` (below), closes, `props.onChanged?.()` |

`Delete` uses the verified `notes/delete` endpoint via the existing client helper (add `apiDeleteNote(noteId)` to the API layer if absent — POST `/api/notes/delete` `{noteId, i}`; expect **204 empty** — never call `.json()` unconditionally). If currently on `/notes/:id`, `navigate("/")` after success.

### Tier 2 — exact rows (submenu of `user`)

| id | label | icon | behavior |
|---|---|---|---|
| `copy-username` | Copy username | `AtIcon` | `writeText(handleOf(user))` (existing helper in `api/types.ts`) |
| `copy-profile-url` | Copy profile URL | `ProfileLinkIcon` or reuse `LinkIcon` variant | `writeText(\`${location.origin}/users/${user.id}\`)` |
| `view-remote-user` | View on remote instance | `ExternalLinkIcon` | `window.open(user.url)`; **omitted when `user.host === null`** |
| *sep* | | | |
| `rss` | Copy RSS | `RssIcon` | **disabled** — `"Unavailable — endpoint not yet verified"` |
| `search-notes` | Search this user's notes | `SearchIcon` | **disabled** — `"Unavailable — no search route yet"` |
| *sep* | | | |
| `memo` | Edit memo | `MemoIcon` | **disabled** — reason |
| `add-list` | Add to list | `ListIcon` + chevron | **disabled** — `"Unavailable — user lists not yet supported"` |
| `add-antenna` | Add to antenna | `AntennaIcon` + chevron | **disabled** — `"Unavailable — antenna source not yet supported"` |
| `notify` | Notify about new notes | `BellIcon` | **disabled** — reason |
| `dm` | Send a message | `MailIcon` | **disabled** — `"Unavailable — no messaging in Keystone yet"` |
| *sep* | | | |
| `mute` | Mute | `MuteIcon` | **slice 2** — placeholder in v1 (`"Unavailable — wires in slice 2"`) |
| `mute-boosts` | Mute Boosts | `RepostIcon` | **slice 2** — placeholder |
| `block` | Block | `BlockIcon` | **slice 2** — placeholder |
| `refresh-remote` | Refresh remote data | `RefreshIcon` | **disabled** — reason |

Slice 2 wiring (when reached): `mute/create`+`mute/delete` `{userId}`, `renote-mute/create|delete`, `blocking/create` — all verified on Misskey+Sharkey; state from `users/relation` `{userId: [id]}`; Block gets a two-step confirm ("Block @user?"); all call `props.onChanged?.()`. **Never** send `expiresAt`. Skip slice 2 items entirely under `BACKEND_ID === "pinetree"` (they 404 there — for Pinetree render them disabled with `"Unavailable on Pinetree"`).

### Clipboard + feedback

Wrap every `navigator.clipboard` call in try/catch; on failure fall back to a hidden-`textarea`+`execCommand` copy or show the reason. Feedback is a single `aria-live="polite"` region inside the menu: swap the row label to "Copied" for ~1.2s, or just announce. No toasts, no new UI infra.

### Dismiss / keyboard

Copy the `AccountCard` pattern verbatim in spirit:
- Open: measure trigger rect (`getBoundingClientRect`), store `{kind:"up"|"down", left, bottom|top}` in a signal — open **up** by default (feed notes), **down** if the trigger is in the top ~35% of the viewport.
- Menu and submenu render in `createPortal(..., document.body)` (import from `solid-js/web`).
- While open: `pointerdown` outside both roots → close; `Escape` → close submenu first, then menu, restoring focus to the `⋯` button; `scroll` (capture) + `resize` → close.
- Submenu opens on hover (≥150ms intent delay) **and** on click/keyboard focus; positioned right of the parent item, clamped to the viewport (flip to left side when within ~240px of the right edge; on narrow screens render inline below the parent row instead).
- Disabled rows: `disabled` attribute + `title={reason}` + `aria-disabled="true"`; CSS kills hover background and pointer cursor.

---

## 6. `NoteCard.tsx` integration

In `.noteactions`, after `EmojiPickerButton`, add:

```tsx
<Show when={loggedIn()}>
  <NoteMenu note={shown()} me={me()} onChanged={props.onChanged} />
</Show>
```

`NoteMenu` renders the trigger itself:

```tsx
<span class="notemenu-wrap">
  <button type="button" class="action" aria-haspopup="menu"
    aria-expanded={open()} aria-label="More options" title="More options"
    onClick={...}><MoreIcon /></button>
  ...
</span>
```

Notes:
- The trigger's parent must be excluded from `NoteCard.openDetail`'s interactive-target check — verify `'a,button,...,[role="menu"]'` already covers it (it does, since the trigger is a `button`).
- The existing `.renotemenu` stays untouched. Do not refactor it.
- Logged-out feeds (`onToggleReaction === undefined`) show no `⋯` (no clipboard-authenticated actions there; guests can still open the detail route).

---

## 7. CSS (`global.css`, near the `.renotemenu` block ~line 1408)

Add a `.notemenu` modifier that inherits the vispick card look — copy the `.vispick-menu` values (`var(--bg)` bg, `1px solid var(--edge)`, `border-radius: 12px`, `padding: 0.4em`, gap `0.13em`) with these deltas:
- `.vispick-menu.notemenu { position: fixed; min-width: 15em; max-width: min(21.33em, calc(100vw - 32px)); max-height: min(30em, calc(100vh - 24px)); overflow-y: auto; }` (position set inline from the signal).
- `.notemenu .vispick-item { white-space: nowrap; }` single-line rows; no `.vispick-desc`.
- `.notemenu-item-right { margin-left: auto; display: inline-flex; color: var(--muted); }` for chevrons.
- `.notemenu .vispick-item[disabled] { opacity: 0.45; cursor: default; }` and `.notemenu .vispick-item[disabled]:hover { background: none; }`.
- `.notemenu-sep { border-top: 1px solid var(--border); margin: 0.25em 0.4em; }`.
- Submenu: `.notemenu-submenu` = same card, positioned via inline fixed style.

No gradients, no shadows, no accent colors.

---

## 8. SolidJS checklist (run `solidjs.md` §10 before returning)

Specific traps for this feature:
- Do **not** destructure `props` — the menu reads `props.note` live (feeds swap notes in place, see `TimelineFeed.tsx` ~line 371).
- Item sections are built in setup but their `disabled`/visibility are functions — evaluated in JSX, so they stay reactive.
- The dismiss-listener `createEffect` must early-return when closed and clean up on close **and** unmount.
- Portal content means outside-click checks must test against both the wrap ref and the portal root ref (`AccountCard` shows exactly how).
- `<For>` for rows, `<Show>` for conditional rows, `<Switch>/<Match>` if the confirm state branches.

---

## 9. Slices (land one at a time, each build-green)

1. **Shell + client-only + placeholders + Delete** — everything in §5–§7. Verify: `npm run build`; e2e against local Misskey (`:3101`) and Sharkey (`:3102`) and Pinetree (`:3000`); confirm every visible row works or is honestly disabled; no console errors; desktop + 360px widths don't clip (submenu flips); Escape/outside-click/scroll dismiss; Delete round-trips (204) on an own note.
2. **Mute / Mute Boosts / Block** — flip the three placeholders to live rows with `users/relation` state and confirms. Same verification matrix; plus block-then-unblock round-trip.
3. **Verify-and-enable** — probe `notes/mute`, `notes/favorites/create`, `users/report-abuse` against local Misskey + Sharkey (curl or a `scripts/` probe in the existing smoke-suite style). Record results in `docs/api-surface.md`, then enable what passed. Anything policy-dependent or 404 stays disabled with the specific reason.
4. **Later (do not start unprompted)** — clips (`clips/list` + `clips/add-note`), favorites, search route, RSS.

After each slice: update `docs/frontend-plan.md`, `state/STATE.md`, append `state/logs/YYYY-MM-DD-note-menu.md` (goal / changed / evidence with real command output or `not yet verified` / next step). Never claim verification that wasn't run.

---

## 10. Acceptance criteria (v1)

- Every visible row has a distinct icon; every row is either functional (client-side or verified endpoint) or disabled with a human-readable reason in its `title`.
- No `includeMyRenotes`-style extra params, no bare `.json()` on 204 endpoints, no auth-dependent action for logged-out users, no `innerHTML` near note text.
- Menu chrome is pixel-consistent with the audience-picker flyout in both themes.
- `npm run build` green; no console errors; keyboard-only operation reaches and activates every enabled row.

---

Want me to save this as a file (e.g. `docs/note-menu-plan.md`) once you switch out of plan mode, or is passing the chat text along enough?
