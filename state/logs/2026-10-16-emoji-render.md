# 2026-10-16 — Emoji load fix + render everywhere (follow-up to `2026-10-16-emoji-picker.md`)

## Goal

Owner reports: "could not load custom emoji". Then: prove loading
works, show custom emoji in the picker, and render it in post text,
usernames, profiles, and everywhere else it can appear.

## Diagnosis (the load failure)

`loadCustomEmojis()` used `apiCallPublic`, which only ever hits the
internal Vite-proxy backend. With an external account active (owner
live-testing dvd.chat from macOS) — or no local backend running at
all — the proxy connection fails and the Custom section lands in
`error` ("Could not load custom emoji", retrying forever). The 404 →
`unavailable` path was innocent: Pinetree 404s surface as
status-carrying `ApiError` on both transports and omit the section
silently.

Fix: route the fetch via `apiCall` (external-aware, same as public
timelines + `meta` + every other public read). The injected `i` is
consumed by the Misskey-family auth framework and never reaches
endpoint validation. Proven live on dvd.chat 2026-10-16:

- `{}` → 200, 3,488 items (as before)
- `{"i": null}` → 200, full list (anonymous tolerated)
- `{"i": "invalidtoken123"}` → `AUTHENTICATION_FAILED` (framework
  consumed the credential — the endpoint does not reject the param,
  so a valid session token is equally fine)

## What changed (rendering)

- `frontend/src/api/emoji.ts`: `splitNameEmojis` (pure) — splits
  `:code:` out of plain text; remote `:name@host:` never splits.
- `frontend/src/components/EmojiPicker.tsx`: `EmojiGlyph` drops the
  `aria-hidden` fallback (image alt / literal text is announced —
  parents with `aria-label` still override); new `DisplayName` for
  plain text with inline hosted `:code:` substitution.
- `frontend/src/components/MfmRenderer.tsx`: `emojiCode` renders the
  packed image when known (reactive lookup — swaps in when the
  listing lands), else the literal code as before. Covers note text,
  quotes, notification text, and profile bios (all flow through
  `MfmRenderer`/`TranslatableText`). Mention-chip names use
  `DisplayName`.
- `DisplayName` applied everywhere a name/code-bearing string shows:
  `NoteCard` (head + repost banner), `NoteBody` (quote head, CW,
  poll choices), `Profile` h2, `UserHoverCard` (both names + bio),
  `FollowList`, `ProfileCard` (name + bio), `Search`, `Notifications`,
  `AccountCard`, `Settings` account page. Avatar `name` props and
  `aria-label`/`title` strings stay raw (correct for AT).
- `frontend/src/styles/global.css`: `img.emojiglyph` base rule —
  `1.25em`, text-sized, scales with prose (and the text-size
  setting); fixed chrome keeps its explicit pixel overrides.
- `docs/mfm.md`: `emojiCode` rule updated (listing is the URL
  source; unknown stays literal). `docs/frontend-plan.md`: slice
  extended. `docs/api-surface.md`: unchanged (endpoint row already
  accurate).

Out of scope (stated, not started): remote `:name@host:` image
resolution (no packed URL known — stays literal, same as MFM
rule); Mastodon unfurl-card display names (different software,
different shape); emoji inside the composer textarea (plain-text
control — inserts stay literal `:code:`, the server renders them).

## Evidence (real output)

- Live probes above (dvd.chat `emojis` with `{}`, `i: null`,
  bogus `i`).
- Pure checks (esbuild-bundle + node over the real module):
  **42/42 passed** (prior 37 + 5 splitter checks: mixed, adjacent,
  plain, remote-untouched, empty).
- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`index-BrclLhsD.js`, 255.91 kB;
  `index-ovtu9Jmg.css`, 36.08 kB).
- Static: no `from "react"`, no new colors, Solid checklist
  (`solidjs.md` §10) walked — props read at use, `<For>`/`<Show>`,
  memo for name parts, signal reads inside render contexts only,
  no `ref` props, no dep arrays.
- No backends on this machine — API suites N/A. Visual
  confirmation (picker images, in-text/profile/name emoji, both
  themes, mobile) **not yet verified** (owner on dvd.chat / local
  backends).

## Open questions

- None. If the owner still sees the error on a specific backend,
  the Retry path now surfaces it per-backend — report which
  backend/mode and the dev-server terminal line.

## Next step

Owner visual pass: picker Custom section with images, a post with
custom emoji in text + a custom-emoji display name, profile + hover
card, CW/poll case if handy, Pinetree mode (section absent, zero
noise). Then commit this slice with the picker slice.
