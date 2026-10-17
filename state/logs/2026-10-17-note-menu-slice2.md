# 2026-10-17 — Note menu: owner follow-ups + slice 2

## Goal

Owner follow-ups on slice 1, then slice 2 (Mute / Mute Boosts / Block)
from `docs/note-options.md` §9.

1. Hide native scrollbars in scrollable popups: the note menu, the
   visibility picker, and composer options.
2. The `⋯` button on every post, including detail views and feeds.
3. Right-align the `⋯` button in the action row.
4. Hide "Translate" for posts with a loaded translation.
5. Slice 2 wiring.

## What changed

- `frontend/src/styles/global.css`
  - `.vispick-menu` hides its scrollbar (`scrollbar-width: none`, `-ms-`
    overflow, `::-webkit-scrollbar`). The visibility picker, the composer
    options (`.vispick-menu.optmenu`) and the note menu all carry the
    class, so one rule covers them.
  - `.notemenu-wrap { margin-left: auto }` pins the trigger to the right.
- `frontend/src/components/NoteCard.tsx` — `<NoteMenu>` is no longer gated
  on `loggedIn()`. The gate came from the reaction handler, which
  detail, profile, search and reply lists do not pass. That gate is why
  the button was missing there.
- `frontend/src/api/translate.ts`
  - Per-note outcome store: `translationOutcome`,
    `reportTranslationOutcome` ("loaded" | "unchanged").
  - Retry counter: `translationRetryCount`, `retryTranslation` (clears a
    remembered failure and bumps the counter).
- `frontend/src/components/TranslatableText.tsx` — the request source now
  includes the retry count, so a retry refetches. An effect reports
  "loaded" when a translation is shown and "unchanged" when the server's
  result is not worth showing.
- `frontend/src/components/NoteMenu.tsx`
  - Translate row: shown when translation is supported, the post has
    prose, and no translation is on screen. Disabled "Already in your
    language" when the result is unchanged. Otherwise it retries.
  - Slice 2 rows in the User submenu:
    - Mute / Unmute → `mute/create|delete`
    - Mute Boosts / Unmute Boosts → `renote-mute/create|delete`
    - Block → confirm "Block @user?" → `blocking/create`; Unblock →
      `blocking/delete` directly
    - State from `users/relation` (`fetchRelation`), loaded when the
      submenu opens and re-read after each write
    - Rows hidden for signed-out viewers and the viewer's own posts
    - Disabled "Unavailable on Pinetree" on Pinetree (`BACKEND_ID`);
      "Loading…" while the relation loads; "Working…" during a write;
      "Unavailable — relation lookup failed" if the lookup fails
    - No `expiresAt` is sent. Writes call `onChanged` so feeds refresh.
  - Confirm mechanism generalized: `confirm: {kind, question, action, run}`
    serves Delete and Block.
  - Placement effects re-run on confirmation and relation changes.

## Deviations and judgment calls

- **Translate**: translation is automatic (`TranslatableText`), so the row
  is a fallback for failed or pending attempts only. It is hidden once a
  translation shows. The request is a retry, not a new feature. A
  CW-hidden post still shows nothing until the viewer reveals it: the
  retry warms the cache, and the text appears on reveal.
- **Block** is the only consequential row that confirms. Unblock acts
  directly, as the profile's `UserActions` does.
- **Relation lookups** are per open, not cached across menus. The
  endpoint is cheap and labels must match the server.
- **Quoted posts** (`NoteBody`) render without any action row, so the
  menu does not appear on them. Adding one changes the quote layout;
  not done here. Needs a decision.

## Evidence

```
$ npx tsc --noEmit -p tsconfig.json
(no output)  exit 0

$ npm run build
dist/assets/index-DAV4_oBA.css     40.06 kB │ gzip:   7.27 kB
dist/assets/index-DOKw1edP.js     352.23 kB │ gzip: 101.44 kB
✓ built in 1.34s
```

Backends and dev server were down on this machine (see the slice 1 log).

## Not yet verified

- Browser behavior of the menu in detail, feed and profile contexts.
- Right alignment at 360px and desktop widths.
- Scrollbar hidden in the visibility picker and composer options.
- Translate row hides after a translation shows, and retries after a
  failure.
- Mute / Unmute, Mute Boosts / Unmute Boosts, Block / Unblock round-trips
  on Misskey (`:3101`) and Sharkey (`:3102`), including the feed refresh.
- Block confirm and cancel.
- Logged-out view: rows hidden, copy and share still work.

## Open questions

- Quoted posts: give them an action row (and the menu), or leave them?
- Relation endpoint on Sharkey: the mute and block helpers were already
  used on profiles (`UserActions`), so the write endpoints are assumed
  verified there. Slice 3 probes will confirm.

## Next step

Slice 3: probe `notes/mute`, `notes/favorites/create`, and
`users/report-abuse` against the live backends and record the results in
`docs/api-surface.md`. Then run the browser checklist from both logs.
