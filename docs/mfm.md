# MFM rendering notes (`mfm-js`)

**Status:** Validated 2026-10-15 (`mfm-js` 0.27.0; full `built/index.d.ts` read, implementation matches)

Note text can contain Misskey Markup (MFM). Parse with `mfm-js` and render
an allow-listed AST subset as Solid elements. `keystone.md` §10 defines the
scope; `solidjs.md` defines the UI model; `docs/api-surface.md` defines what
the backend does not support. Never `innerHTML` note content.

## Version pin (filled 2026-10-15, from installed package)

- `mfm-js`: `0.27.0` (`frontend/node_modules/mfm-js/package.json`)
- Parse entry verified: `parse(input, opts?): MfmNode[]` from
  `frontend/node_modules/mfm-js/built/index.d.ts` (single-file declarations,
  172 lines; package has no `dist/`, only `built/`)
- Node union verified: `MfmNode = MfmBlock | MfmInline` (same file);
  `MfmBlock = MfmQuote | MfmSearch | MfmCodeBlock | MfmMathBlock | MfmCenter`;
  `MfmInline` = unicodeEmoji, emojiCode, bold, small, italic, strike,
  inlineCode, mathInline, mention, hashtag, url, link, fn, plain, text
- Docs matched to: installed `built/index.d.ts` (primary); keystone/solidjs briefs

Property paths used by `MfmRenderer.tsx`, all read from that file:
`text.props.text`; `plain.children: MfmText[]`; `bold/italic/strike/small`
→ `children: MfmInline[]`; `inlineCode.props.code`;
`blockCode.props.{code, lang}`; `quote.children: MfmNode[]`;
`mention.props.{username, host, acct}` (renders `@acct` as styled text —
no userId available, so no link); `hashtag.props.hashtag` (styled text —
note search is unsupported, so no link); `url.props.url`;
`link.props.{silent, url}` + children; `emojiCode.props.name` (hosted
image when `POST /api/emojis` knows the name — `docs/api-surface.md`;
else literal `:name:`); `unicodeEmoji.props.emoji`;
`fn.props.{name, args}` + children (children only);
`center.children`; `search.props.content`; `mathInline/mathBlock.props.formula`
(as code); default → `toString(node)` as text.

Every node `type` string and property path in `MfmRenderer.tsx` must match
the installed `*.d.ts`. Unverified examples are not a source.

## Allow-list (v1)

From `keystone.md` §10 — start with only these, expand only after §Version pin:

- plain text
- bold, italic, strike
- inline code (block code as plain preformatted text, no execution)
- quote
- link, mention, hashtag

Everything else renders via the fallback below. Do not add new node kinds
without recording the installed type/props here first.

Implemented extras beyond the v1 list (all shapes verified in the installed
`built/index.d.ts`, all degrading to text/children, no new capabilities):
`small`, `unicodeEmoji`, `emojiCode` (hosted image from the note's
packed `emojis` map, else the `emojis` listing, else literal; a packed
URL that fails to load falls through to the live listings — see
`EmojiGlyph`), `fn`/`center` (children only),
`search` (content), `mathInline`/`mathBlock` (as code).

## Safety rules (non-negotiable)

1. **No `innerHTML` / `innerText`-as-HTML for note content.** Build Solid elements from parser nodes only.
2. **Unknown nodes degrade to safe text**, never disappear silently and never interpreted as HTML/JS. Render their text/children where the installed shape provides them, otherwise a harmless fallback.
3. **External links:** `target="_blank"` + `rel="noopener noreferrer"`. Validate URL scheme before rendering as a link — allow `http:`/`https:` (and relative paths that the API returns for media); render anything else as plain text.
4. **Custom emoji only from packed sources:** the note's packed
`emojis`/`reactionEmojis` maps first, then the `POST /api/emojis`
listing of the code's own host (`:name@host:`), then — for host-less
codes in remote-authored content — the author's origin host (`host`
prop: a `:code:` typed on H means H's emoji), then the viewer's local
listing (`docs/api-surface.md`). Render the image when a source knows
the code, else the literal `:code:` — never a fabricated URL, and
never a local lookalike for a remote code. A URL that fails to load
falls through to the next source (`EmojiGlyph` `onError` chain), never
a stuck broken image.
5. **Wire fields are camelCase** (`createdAt`, `avatarUrl`, …) per `pinetree/docs/domain-types.md`, not internal Rust names.
6. **CW / visibility / media:** render content warnings, visibility, missing avatars, media URLs, and deleted/unavailable errors defensively. Never show private/`specified` content just because a linked note exists.

## AST validation procedure (required before coding `MfmRenderer`)

1. Complete §Version pin above.
2. From the installed `*.d.ts`, record the exact answers in this doc:
   - What does `parse()` return (array? root node?).
   - Union member names for the allow-list (exact `type` strings, exact props object shape per member).
   - Where plain text lives per member (do not assume a shared `.text` / `.children` path — verify each member).
3. Only then write `components/MfmRenderer.tsx`:
   - `switch` (or `<Switch>`/`<Match>`) over the verified `type` strings.
   - `default:` → safe-text fallback.
   - Read `props` reactively (`props.node` where used, no destructive snapshot — `solidjs.md` §2).
   - Lists of child nodes via `<For each={...}>` with the value (`each={children()}` when it is a signal — `solidjs.md` §4).
4. If the installed shapes disagree with any sketch in a log or draft, the installed shapes win — update this doc.

No AST type names or property paths are asserted in this doc until step 2
is done. Any snippet elsewhere claiming `node.props.text` / `node.children`
/ specific union names is unverified until pinned here.

## SolidJS notes for the renderer

- Components run once per instance; signals drive updates. Derive in JSX or `createMemo`, never a setup-time snapshot (`solidjs.md` §1).
- Do not destructure reactive props into plain locals; use `splitProps`/`mergeProps` when partitioning/defaulting (`solidjs.md` §2).
- Effects are for side effects, memos for derived values; async via `createResource` or explicit event handlers, never bare `async` effects (`solidjs.md` §6).
- Mentions/hashtags link only to supported in-app routes (`/users/:id` where a `userId` is known; user search via `users/search` — never present hashtag click as note search, which is unsupported).

## Verification (with real backend notes)

- [ ] Version pin + AST field table filled from installed `*.d.ts` (paste `grep` output in log).
- [ ] `solidjs.md` §10 checklist run against `MfmRenderer.tsx`.
- [ ] Renders allow-list kinds; unknown kinds fall back to safe text (demonstrate with a note containing an out-of-list construct).
- [ ] No `innerHTML` in `MfmRenderer` (`grep -rn innerHTML frontend/src` empty).
- [ ] Links open safe externally with `noopener noreferrer`; `javascript:`-like text never becomes a link.
- [ ] No fabricated file URLs; media uses API-returned URLs only; no console errors.
