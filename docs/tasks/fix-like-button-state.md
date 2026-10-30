# Fix like-button liked state

Plan ref: owner report 2026-10-30 (screenshot: raw `:meowBigSob@.:` in lit like pill)
Status: in progress
Branch: `fix/like-button-liked-state` (from `main`, uncommitted; do NOT merge without owner approval; never `git push`)

## Goal

The like pill means liked-only (`mine` IS the configured like). Custom likes render art in the pill; the button never prints a raw key.

## Read first

- `src/components/Post/ActionBar.tsx` (`LikeGlyph`, reaction-kind block)
- `packages/fedi/src/api/emoji.ts` (`isLikeActive`, `sameEmojiKey`)
- `src/components/EmojiImage.tsx` (`CustomEmojiGlyph` chain + X2.5 rule)

## Steps

- [x] 1. `liked = isLikeActive(likeEmoji, mine)` drives active/label/tap (was `!!mine`).
- [x] 2. `LikeGlyph`: unlit → outline heart; lit heart-like → filled heart; lit custom-like → entry/packed/session art by wire key, filled-heart fallback. Removed `UnicodeEmoji`-fallback + RN `Image` paths.
- [x] 3. Tests: fedi `api-emoji-like` (3) + postactions +4 (unlit-other, custom-art-not-code, bare≡`@.`, remote-unlit; all-kinds total pin).
- [x] 4. Gate: typecheck + lint clean; 47/47 + 29/29 neighbors green.
- [ ] 5. Owner visual check on web.
- [ ] 6. Full `pnpm test` flat at pre-existing 90, then merge.

## Acceptance

- [x] Other-emoji reaction leaves the button unlit (label, selected, tap-replaces)
- [x] Custom like reacted shows art in the lit pill, never raw `:code:`
- [x] Canonical equality (bare ≡ `@.`), remote lookalikes unlit
- [x] Count totals every reaction kind (verified already-total, pinned)
- [ ] Owner visual check passes
- [ ] Full suite: no NEW failures

## Out of scope

- Showing the custom like emoji in the UNLIT button (stays heart).
- Debounce/retry around reaction toggles (untouched).

## Log

- `state/logs/2026-10-30-like-button-state.md`
