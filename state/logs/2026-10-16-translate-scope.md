# 2026-10-16 — Translation token scope (hashtags/emoji/links/usernames + missing Ukrainian)

Goal: owner-reported noise — posts with nothing to translate (emoji, tags,
links, mentions) showing translations, and a Ukrainian post with none.
Diagnosed live against dvd.chat first, then fixed client-side. Browser QA
still owner-handled (**not yet verified**).

## Diagnosis (all verified live, real output)

The server translates the **raw note text by id** — the client cannot scope
what gets translated:

- `'keystone test https://dvd.chat/@jm'` → `{"sourceLang":"German",
  "text":"keystone test https://dvd.chat/@jm"}` — detection misfires on
  short/odd text AND returns byte-identical output. This is the reported
  noise class exactly.
- A `#毎日音楽` hashtag → `#DailyMusic`; a `[引用推文](url)` markdown link
  → `[Quote Tweet](url)` with the URL preserved. Hashtag/link-label
  translation is server-side; Keystone can only avoid pointless requests,
  not untranslate server output.
- `'p1netree on github eta s0n'` → `sourceLang: "English"` plus a
  **hallucinated multi-paragraph essay** about federation. dvd.chat's
  translator is not DeepL (DeepL returns ISO codes; this returns English
  display names and hallucinates) — confirmed against upstream
  `misskey-dev/misskey …/notes/translate.ts`, which sends raw text to
  DeepL. Server-side quality issue; filed here for the record, not fixed
  client-side beyond suppressing its display (see below).
- 600 global-timeline notes paginated (`untilId` walk): **zero Ukrainian
  posts found**, so the missing-Ukrainian case could not be reproduced
  server-side. Most likely client-side mechanisms given the misdetections
  above: the post detected as the viewer's language (suppressed), or a
  transient failure cached permanently (previous policy never retried).

## Fix (`src/api/translate.ts` + `TranslatableText.tsx`)

1. **Request gate** (`hasTranslatableText`, mfm-based): strips mentions,
   hashtags, bare URLs, whole link nodes (URL + label), and unicode/custom
   emoji; requires ≥1 unicode letter in the remainder. Emoji-only,
   tag-only, link-only, mention-only, and numbers-only posts never fire.
   Shapes validated against the installed mfm-js 0.27.0 declarations.
2. **Identical-output suppression** (`decideTranslation`): normalized
   (lowercase, collapsed-whitespace) translation == original → never show.
   Kills the German-misdetect class regardless of what sourceLang claims.
3. **Distrusted-detection override**: sourceLang claims the viewer language
   but the text changed substantially (normalized edit-distance ratio >
   0.25 — `"webdev"→"web dev"` normalization scores ~0.02) AND the
   original carries non-Latin-script letters → show under a generic
   `Translated` label (no false source claim). This is the Ukrainian-labeled-
   English path. Same-script rewrites stay hidden (normalization noise and
   the hallucinated-essay class).
4. **Failure TTL**: errors now suppress retries for 90s instead of forever
   (successes still settle; 404 still disables the session). Transient
   translator hiccups recover on remount.

## Verification

- 39/39 unit checks green: `esbuild translate-check.mjs --bundle` (defines
  away Vite-only `import.meta.env`) + `node` — gate extraction/exclusion,
  script detection, normalize/distance sanity, and all five live-observed
  policy cases (German-identical hidden, ZH→EN labeled, EN-normalization
  hidden, Ukrainian-mislabeled shown generic, essay hallucination hidden).
  Command: `node /tmp/opencode/translate-check.mjs` via the bundle
  (extensionless TS imports need bundler resolution; plain `node --strip-types`
  cannot resolve `./backend`).
- `npx tsc --noEmit` clean; `npm run build` green (`index-D5cyuqc_.js`).
- Solid checklist re-verified for the component edit (accessor-only props,
  memo-derived state, null-guarded resource source, no dependency arrays).

## Open / not yet verified

- Browser pass (owner): noisy toggles gone, Ukrainian post now translates,
  logged-out + no-endpoint behavior unchanged.
- If a Ukrainian post STILL shows nothing, send the note link: remaining
  suspects are server-side (translator error on that text, or an empty-text
  media-only post) and need the concrete note to probe.
- Server-side wishlist (dvd.chat admin, not Keystone): don't translate
  `#hashtag`/`@mention`/link-label text; fix the short-input hallucination.

Next: owner browser QA; then back to the queued workstreams.
