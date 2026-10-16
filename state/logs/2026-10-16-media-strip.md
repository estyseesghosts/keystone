# 2026-10-16 — media strip (multi-image/video scroll)

**Goal:** copy the competitor's attachment layout (`docs/out2.png`):
multi-image posts scroll horizontally; a lone image/video never scrolls.

## What changed

- `frontend/src/components/NoteBody.tsx`: the `.media` container gets
  `media-strip` iff the note carries 2+ `image/*`/`video/*` files
  (`isStrip`). Sensitive-gate, CW, audio/file fallbacks untouched.
- `frontend/src/styles/global.css`: `.media-strip` = `nowrap` +
  `overflow-x: auto` + `scroll-snap-type: x proximity`; strip thumbs fixed
  at 220px height, `max-width: 85%`, `object-fit: cover`, snap-start.
  Single-image/video keeps the existing fit-to-width rules (no overflow,
  so no scroll possible). Same grey palette, 6px radius unchanged.

## Evidence

- `npm run build` green (66 modules, 844ms).
- **Not yet verified:** visual scroll/snap behavior in a real browser
  (owner rig) — no browser here. Worth checking: 2/3/4-image notes,
  mixed image+video, sensitive-gated strip items, mobile width.
