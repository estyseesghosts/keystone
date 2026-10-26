# Audit: content parsing, RichText, composer (2026-10-25)

Scope: `packages/fedi/src/core/content/*`, `src/components/RichText.tsx` + `richtext/*`,
`packages/fedi/src/api/composer.ts`, `src/components/Composer/*`, `src/state/queries/composer.ts`,
`src/storage/drafts.ts`. Read-only audit. Perf/depth claims were measured with a throwaway jest test
(removed afterwards; no source modified).

## Summary

The parser layer is in good shape: URL policy is strict, regexes are linear, MFM parsing survives
adversarial input. The real defects are in (1) unbounded recursion in the HTML path, (2) compounding
MFM size decorations, (3) link-text-vs-target disclosure, and (4) the composer's edit mode and
submit/upload race. Highest-value items: F1 (edit drops/pins attachments), F2 (edit-mode drafts),
F3 (upload remove/edit during submit), F4 (nested x4 font blowup), F5 (HTML depth throw).

## Findings

### F1 - HIGH - Edit mode strips existing attachments when adding one, and cannot remove the last one
`src/components/Composer/Composer.tsx:480-488`
```
if (uploads.items.length > 0) { ids = await uploads.ensureUploaded(); mediaIds = ids }
const keepMediaIds = mediaIds ?? (state.media.length > 0 ? state.media.map(m => m.id) : editing.mediaIds) ?? []
```
Edit state seeds `state.media` with the post's existing attachments (lines 290-296).
Scenario A: post has 2 images; user edits, attaches 1 new file. `mediaIds` = only the new id, so the
edit is sent with just that one; the 2 original attachments are dropped from the post.
Scenario B: post has 1 image; user taps remove on it (`removeSeeded`), saves. `state.media.length === 0`
so it falls back to `editing.mediaIds` and the image silently stays, contradicting what the UI showed.
Fix: `keep = [...state.media.map(m=>m.id), ...(uploadedIds ?? [])]` always (empty array means "no
media" and the backend must send it explicitly); only fall back to `editing.mediaIds` if the post
object lacks seeded media at all.

### F2 - MEDIUM - Edit composer autosaves as a new-post draft, and "Save draft" creates a server draft of the edit
`Composer.tsx:338-348` (autosave not gated on `editing`), `:672-743` (`saveAndClose` not gated), `:668`
(`isCloseDirty`).
In edit mode `state.text` is seeded non-empty, so after 400 ms the autosave writes a local draft and
sets the open-draft pointer. Consequences:
- Closing an unedited edit always shows the Save/Discard/Keep sheet (always "dirty").
- Choosing Save on Mastodon-less (serverDrafts) backends creates a server draft containing the
  existing post text; on others it writes a local draft.
- If the app is killed (no discard), the pointer survives and the next plain "New post" opens
  pre-filled with the old post's text (`getOpenDraftId` path, lines 256-262).
Fix: skip autosave and pointer writes when `editing != null`; make dirtiness in edit mode a diff
against the seeded post; hide "Save as draft" in edit mode.

### F3 - MEDIUM - Attachments can be removed / alt-edited while a submit is in flight
`ComposerSections.tsx:241,274` (alt field and Remove chip have no `busy` gating);
`state/queries/composer.ts:230-266` (`uploadAll` iterates an items snapshot); `Composer.tsx:524-533`.
Scenario: tap Post with 3 files staged, tap Remove on file 2 during upload. If file 2 was already
uploaded, its id is still in the returned list and gets attached to the post. If it was not yet
uploaded, `files.get(key)` is gone, `uploadAll` marks an error on an item that no longer exists and the
submit fails with "Some attachments failed" with no visible failing row. Alt text edited mid-submit
is applied from stale closure state in `applyMediaEdits`.
Fix: disable Remove / alt / add-media / poll / visibility controls while `busy`, and have
`uploadAll` skip keys no longer in `files`.

### F4 - MEDIUM - Nested size decorations compound without a bound (layout DoS from any post)
`src/components/RichText.tsx:121-141` (`scaled(ctx.size * mult)` writes the new size into ctx).
`clampNum` only bounds one node's arg (0.5-4); `x2/x3/x4` have no clamp and nesting multiplies.
Scenario: `$[x4 $[x4 $[x4 $[x4 hi]]]]` renders at 15*256 = 3840 px; MFM allows ~20 levels of nesting,
so `4^20`. One hostile note makes its row (and the feed list item measurement) enormous or crashes the
native text layout. Fix: clamp the accumulated size (e.g. `Math.min(ctx.size*mult, baseSize*4)`) and/or
cap fn nesting depth at parse time in `fromMfm.convertNode` (flatten `fn` of known size names past depth 2).

### F5 - MEDIUM - `contentFromHtml` throws on deeply nested markup (contract says "never throws") and is slow before that
`packages/fedi/src/core/content/fromHtml.ts:446-467` (try/catch wraps only `parseDocument`; recursive
`convertNode/convertFlow/convertElement` and `ast.ts` walkers `isBlankContent`, `mergeMatrixMentions`,
`plainTextOf` are unguarded).
Measured: `"<b>".repeat(5000)` and `"<ul><li>".repeat(3000)` and `"<blockquote>".repeat(3000)` throw
`RangeError: Maximum call stack size exceeded`. 1000 nested `<b>` took 315-1200 ms (superlinear).
Callers (`postBodyNodes` in `src/components/Post/body.ts:54`, `Announcements`, `fields`) do not catch, so
one hostile federated post (Akkoma/GoToSocial/other servers that forward deep HTML; Mastodon flattens
but not all do) can throw during render of the feed row. Hermes stack is smaller than node's, so the
threshold on device is lower than measured here.
Fix: enforce a depth cap in the walker (e.g. past depth 32 degrade to `innerText`), wrap the whole
conversion in try/catch returning `[t(plainText)]`, and cap input length (e.g. 200 KB).
(MFM path measured fine: bold/fn/quote nesting 5000 deep ran in <100 ms; mfm-js bounds nesting.)

### F6 - MEDIUM - Link label vs target is never disclosed; `a.mention` can disguise any URL as a profile chip
`fromHtml.ts:206-245` (`convertAnchor`), `fromMfm.ts:127-146`, `RichText.tsx:339-361` and `:402-445`,
`Post/PostCard.tsx:743-746`.
- A labelled link renders just its label and opens `href` directly, no host shown, no confirm. Scenario:
  HTML `<a href="https://evil.example/login">https://github.com/org/repo</a>` (visible text a URL, href
  different) or MFM `[https://bank.com](https://evil.example)` renders as an underlined bank.com.
  `bareLinkLabel` only chips a link when `label === href` or an `invisible` span is present, so the
  mismatch case falls to the plain path, which has no guard.
- `<a class="mention" href="https://evil.example">Free gift</a>` becomes `mention(href, ["Free gift"])`;
  `pressable` is true because `href !== null`, so it renders as a profile avatar chip; the tap calls
  `defaultMentionPress` -> not a handle, not a profile URL -> `openExternal(href)`. A link wearing
  profile-chip UI.
Fix: when a link's visible text looks like a URL/host and its host differs from `href`'s host, either
show the real host after the label or confirm before opening; only render a mention chip when the label
parses as a handle or `acctFromProfileUrl(href)` succeeds, else fall back to a plain link.

### F7 - LOW/MEDIUM - Any `<img class="emoji">` in post HTML loads an arbitrary remote URL (tracking pixel / IP leak, plaintext http)
`fromHtml.ts:313-328` (`convertEmojiImage`), `EmojiImage.tsx:131` (candidates include the node `src`).
`isEmojiImage` is satisfied by a class the author controls, `safeHttpUrl` allows `http:` and any host,
and there is no relation to the post's declared `emojis[]` or the author's host. Scenario: a post from
a lenient server includes `<img class="emoji" alt=":a:" src="http://tracker.example/p.gif?u=...">`; every
viewer's device fetches it on render. Fix: only accept `src` that matches a URL present in
`post.emojis`/author emojis (or at least https and same host as author), otherwise render `:code:`.

### F8 - LOW/MEDIUM - `numberOfLines` is ignored whenever the tree contains a block node
`RichText.tsx:632-642` (Flow path never receives `numberOfLines`).
Scenario: collapsed previews, notification excerpts and quote cards pass `numberOfLines`; a post with a
`>` quote, code fence or top-level `$[center ...]`/`<blockquote>`/`<pre>` renders its full length, and
a 100 KB code block inflates the row. Fix: apply a line budget in Flow (truncate nodes to N blocks or
pass `numberOfLines` to the first Text run) or fall back to the plain-text projection when
`numberOfLines` is set and blocks exist.

### F9 - MEDIUM - Hard-coded 10 MB attachment cap blocks normal video/image uploads
`state/queries/composer.ts:~110` (`MAX_MEDIA_BYTES = 10*1024*1024`), `Composer/pickMedia.ts:55-58`.
Servers commonly accept 16-40 MB images and ~99 MB video (Mastodon defaults 16 MB image / 99 MB
video; Misskey drive limits are per user). The cap is applied regardless of instance limits, so
phone-recorded video (almost always > 10 MB) can never be attached. The cap is documented as a
heap-protection bound, but it is a product limitation presented to the user as "too large to attach".
Also, for assets with unknown `fileSize`, `assetToFile` still reads the whole blob before the size check
(`pickMedia.ts:61`), defeating the stated OOM protection. Fix: derive the cap from instance limits
(`/api/v2/instance` media limits / Misskey `maxFileSize`), and stream/upload by URI where possible.

### F10 - LOW/MEDIUM - Instance limits for char count are only read once; fallback defaults can wrongly block posting
`api/composer.ts:60-90`, `Composer.tsx:231-232,390`.
If `/api/v1/instance` (or Misskey `/api/meta`) fails or is slow, limits silently become 500 (Mastodon) or
3000 (Misskey). On GoToSocial/Glitch/Fedibird/Akkoma with higher limits, the Post button is disabled
("Over the character limit") with no indication that the limit is a guess; on instances with lower
limits, the client lets the user submit and gets a server 422. Fix: show "limit unverified" state, do
not hard-block on a fallback default, and retry the limit query.

### F11 - LOW - Validation gaps in `buildPostDraft`
`api/composer.ts:262-340`.
- Misskey CW length is never checked (comment on line ~291 says limit 100, only Mastodon is enforced).
- Poll: no per-option length check, no duplicate check, no duration min/max, and `maxPollOptions` is a
  static default (4 on Mastodon family) not read from the instance (`fetchComposeLimits` returns only
  chars/media). Server 422s surface only after upload + network round trip.
- Scheduled time only checks `t > now`; Mastodon requires >= 5 minutes ahead.
- Mastodon char counting treats trailing punctuation as part of the URL (`URL_RE` `[^\s<>]+`), so
  "see https://x.y/a." is counted as 23 while the server counts 23 + 1: a post at exactly the limit
  passes locally and 422s.
- Misskey specified-visibility recipient check is `/@\w/` on the text; any `@a` in text passes even
  if it is an email fragment.
- `defaultVisibilityFor` supports a `preferredRaw` but no caller passes one (Composer.tsx:301,441),
  so the user's account default posting privacy is never honoured for new posts.

### F12 - LOW - Autocomplete trigger is ASCII-only for hashtags and mentions
`api/composer.ts:466` (`[\w.@-]*`). `#日本語`, `#café`, `@josé` stop triggering suggestions once a
non-ASCII character is typed, and the replaced range is computed from the same regex, so completion
can leave stray characters. Fix: use `[\p{L}\p{N}_.@-]` with the `u` flag.

### F13 - LOW - Draft eviction and small fidelity issues
- `storage/drafts.ts:write` slices to 25 rows silently; the 26th draft deletes the oldest with no notice.
- `fromHtml.ts` renders `<ol>` items with bullets (not numbers); table cells concatenate without
  separators; `<img>` that is not emoji is dropped with its alt text (accessibility loss);
  `fromMfm.KNOWN_FN` lacks `fg` (Misskey's foreground color) so it degrades to uncolored text.
- `insertCreatedPost` (`state/queries/composer.ts:75-95`) prepends every created post, including
  `direct`/`followers`/replies, to cached `timeline|home` and `timeline|social`; a DM or a reply can
  appear in Home until the next refetch, and a `home`/`unlisted` post appears in Social.
- `fromHtml.pushText` and `fields.pushFieldText` concatenate repeatedly (quadratic): 100k adjacent
  spans took ~1.5 s.

## Things that looked solid

- URL policy `ast.ts safeUrl`: http/https/mailto only, rejects control chars/space, embedded
  credentials (`https://google.com@evil`), >2048 chars, relative and protocol-relative; normalised via
  `new URL`. Image URLs additionally http(s)-only.
- Hashtag/mention redirect links (`[#tag](url)`, `[@user](url)`) drop the href or route by label;
  hashtag chips never open a browser; Matrix IDs handled before webfinger mentions.
- HTML sanitisation is by construction (no innerHTML, no WebView): unknown tags degrade to children,
  dangerous subtrees (script/style/svg/iframe/form/...) dropped. Allow-list completeness for the
  render target is adequate; `<details>`, `<xmp>` etc. degrade to harmless text.
- Regex review: `TRANSLATED_TOKEN_PATTERN`, `FIELD_*`, `URL_RE`, `REMOTE_CODE_PATTERN`, matrix patterns
  have no nested quantifier ambiguity. Measured MFM inputs of 100-200 k chars of `@`, `:`, `:a@`, `$[`,
  `**`, `[a](`, `#a`, backticks all finished in < 700 ms; MFM nesting 5000 deep ran < 100 ms.
- MFM fn style args are allow-listed (`safeHexColor`, `safeFontFamily`, clamped rotate/scale) with no raw
  server strings into styles.
- Composer submit has a synchronous single-flight ref (`submitRef`), saveAndClose has its own, Mastodon
  create carries an `Idempotency-Key` per logical attempt, uploads that succeeded are not re-sent on
  retry, quote-refusal recovery posts once more without the quote, reply visibility never widens the
  parent's, unsupported features are gated with reasons (`composeGates`), drafts and queries are keyed
  per session, media ids are never persisted in drafts, over-size picks are reported not dropped.
