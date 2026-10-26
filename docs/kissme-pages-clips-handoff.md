# Handoff: Pinetree Clips/Pages support in the kissme frontend

## Assignment

Implement Pinetree's extended Clips/Pages features in the kissme frontend, with graceful degradation on stock Misskey backends. One agent, working in the checkout below. Assume no memory of prior sessions — everything you need is cited here.

## Where to work (read-only unless noted)

- **Work here (only place you edit):** `/Users/terezi/Local Documents/misskey`, branch `split-project` (remote `origin https://github.com/estyseesghosts/kissme.git`). HEAD at time of writing: `72d760f6bd` (2026-10-20). Check `git status --short --branch` is clean before starting. Follow the repo's `AGENTS.md` / `CLAUDE.md`.
- **Read-only references (never edit):**
  - Sharkey donor tree next to this checkout (donor behavior is added, never substituted; stock Misskey always wins).
  - `/Users/terezi/pinetree` — the Pinetree server. Read API shapes; do not edit.
  - `/Users/terezi/keystone2/docs/pages-clips.md` — Misskey (Sharkey-fork) frontend+backend audit: what the UI does today (§1 clips frontend, §3 pages frontend) and exact backend semantics (§2, §4).
  - `/Users/terezi/keystone2/docs/pinetree-pages-clips.md` — Pinetree backend + client-consumption audits (§4 pages client table, §5 clips client table) with per-endpoint params/auth/errors.
  - `/Users/terezi/pinetree/docs/misskey-pages-clips.md` — the server-side work order (slices C1–C3, P1–P3, W1; Decisions 1–10). Status is **plan only — not started**, so every new endpoint below may still 404: that is why T0 (runtime probe) comes first and is non-optional.

## kissme ground rules (binding)

- **Additive upstream hooks only.** Never rewrite stock `Mk*` components. New behavior lives in `Sk*` components, `sk-*` utilities, or pref-gated branches with optional props. The `noteDesign` (`'misskey' | 'sk'`) dispatcher stays untouched.
- **Honest degradation.** Where the backend lacks an endpoint, disable/hide with a reason, or show the error — never fake behavior, never dead UI. This already covers Sharkey-only endpoints via `as unknown as` untyped aliases with a comment naming the endpoint and telling the reader to remove the cast once misskey-js exposes it (see `utility/sk-like.ts`); follow that pattern for Pinetree-only endpoints.
- **Real locales.** Every user-facing string goes in both `locales/en-US.yml` and `locales/ja-JP.yml`, read via `i18n.ts`/`i18n.tsx`. (This overrides the `ja-JP`-only rule, so `node scripts/check-shipping.mjs` Locale FAIL is expected — note it in commits.)
- **No new dependencies without a pinned version** in `packages/frontend/package.json`.
- **Docs.** One page per ported area under `docs/sk-port/` + update the backend-capability table in `docs/sk-port/README.md` with live router-probe results for each new endpoint.
- Split infra is done: backend URL resolves via meta `instance_url` / `VITE_BACKEND_URL` / `?backend=` override; auth travels via the `i` token param. You don't need to touch it.

## Key frontend files (all under `packages/frontend/src/`)

- Clips: `pages/clip.vue`, `pages/my-clips/index.vue`, `pages/user/clips.vue`, `pages/user/index.vue`, `pages/note.vue`, `components/MkClipPreview.vue`, `utility/get-note-menu.ts`, `composables/use-note.ts`, `components/MkNote.vue` (+ `SkNote.vue`, `SkNoteSub.vue`), `cache.ts` (`clipsCache`), `router.definition.ts`, `navbar.ts`, `utility/get-embed-code.ts`, `preferences/def.ts` (`showClipButtonInNoteFooter`).
- Pages: `pages/page.vue`, `components/page/page*.vue` (viewer stack), `components/MkPagePreview.vue`, `pages/pages.vue`, `pages/user/pages.vue`, `pages/page-editor/page-editor.vue` + `page-editor.blocks.vue`, `.container.vue`, `els/page-editor.el.*.vue`, `common.ts`.

## Backend reality you must code against

- **Compatible by design:** REST shapes, pagination params, and per-endpoint error UUIDs (`NO_SUCH_CLIP` family, `ALREADY_CLIPPED 734806c4-…`, `TOO_MANY_*`, `NAME_ALREADY_EXISTS 4650348e-…/2298a392-…`) are verbatim Misskey. Keep the existing UUID maps.
- **Permanent Pinetree divergences** (do not "normalize" these away): `notes/clips` has a hard cap of 100, newest-first, and **rejects pagination params** with `UNSUPPORTED_FIELD`; `users/clips` is public-only even for the owner (unknown user → `[]`); `i/pages` packs **without** `isLiked`; `i/page-likes` items are `{id, page}` with the page packed **with** viewer (`isLiked: true`); `pinnedPage` is `null` whenever the viewer may not read the page (but `pinnedPageId` is always present); counters are transactional (no stale-`clippedCount` handling needed, but stay tolerant of `0` for stock Misskey); private embeds 404 with empty body (Misskey leaks them — do not replicate the leak); AP routes (`GET /pages/{id}`, `/clips/{id}`) stay JSON; human routes are new (`GET /@{username}/pages/{*name}`, `GET /embed/clips/{id}`, `GET /embed/@{username}/pages/{*name}`); **no `page-push`/`pageEvent`, no AiScript execution** — poll `show`, never execute `script`.
- **Stock-Misskey behavior you must preserve:** `clips/update` **wipes `description` when omitted** (Pinetree fixes this with true partial-merge) — see T4. Misskey packs full `pinnedPage`; Misskey embeds can leak private clips (don't depend on it).

## Tasks (in order)

**T0 — Capability probe (do first).** New module (e.g. `utility/pinetree-capabilities.ts`): after `meta` fetch, probe `clips/follow`, `users/clips`, `notes/clips`, `i/pages`, `i/page-likes`, `i/import-clips` (dummy/invalid ids are fine — `NO_SUCH_CLIP ac078150-…` means Pinetree, `UNKNOWN_API_ENDPOINT 404` means stock Misskey). Cache booleans, expose `isPinetree` + per-feature flags. Every task below gates on these flags, never on version strings.

**T1 — Clips follow row.** Read `isFollowing?` from `clips/show` (authed-only; absent for anon — hide, don't default). Add follow/unfollow beside favorite (`write:clip-favorite`). `clips/followers` is owner-only (expect `403` otherwise) — call it only for own clips; for others use `isFollowing`. Hidden entirely when the probe says Misskey.

**T2 — Clips forms.** Add `federate` toggle + `visibility` tier + `approvedActorUris` to create/update, as axes independent of `isPublic` (`federate` defaults true; warn that the admin `federateClips` switch gates actual delivery). Strip all three params when talking to stock Misskey (else `400 UNSUPPORTED_FIELD`).

**T3 — Clips discovery gating.** Profile clips tab (`users/clips`) and note-detail "in these clips" (`notes/clips`) render only when the capability is present; otherwise hide the section (not an error). Respect the 100-cap; never send pagination to `notes/clips`.

**T4 — Clips update + throttle + freshness (load-bearing nuance).** Branch the update payload: **stock Misskey needs the full body including current `description`** (omitted → wiped); **Pinetree accepts partial** (absent untouched, `''`/`null` clears) — send only changed fields there. Handle `429 + Retry-After` on `add-note` (20/h) and exports (1/h). On a `clipUpdated` notification naming a deleted/restricted clip, drop the cached copy. Add `i/import-clips {fileId}` next to export, gated on the probe.

**T5 — Pages forms.** Add `pageVisibility + visibleUserIds` (read gate), `federate` (default true), and tier-`visibility` to create/update; strip on Misskey. Keep the existing `script: ''` / `variables: []` hardcode.

**T6 — Pages reads.** Treat `NO_SUCH_PAGE` as "not found or not visible" everywhere (Pinetree gates `show/like/featured/users/pages`). Anon packs lack `isLiked` — hide the button state, don't coerce to false.

**T7 — Pages lists.** `i/pages` (own incl. non-public) and `i/page-likes` (liked) exist on Misskey and are being added to Pinetree (slices P2) — gate both screens on the probe and hide with a reason when the backend 404s, whichever backend that is.

**T8 — Pins.** Always resolve `pinnedPageId` via `pages/show` (required on Pinetree where `pinnedPage` is always `null`; harmless on Misskey where the pack already includes it — use the packed page when present, fetch when `null`).

**T9 — Share/embeds.** Canonical share URL per backend: Pinetree human routes (`/@{username}/pages/{name}`, `/embed/…`); Misskey existing routes. Expect private embeds to 404 empty on Pinetree.

**T10 — Realtime.** No `pageEvent` subscription anywhere; re-fetch `show`. Never execute page `script` from any source.

**T11 — Types.** Extend `misskey-js` or a local overlay with `isFollowing`, `visibility/federate/approvedActorUris`, follow/import endpoints, and the new UUIDs (`ac078150-…`, `3edf8e54-…`, import file guards). Untyped aliases follow the kissme `as unknown as` + removal-comment convention.

**T12 — Locales + docs.** All new strings in `en-US.yml` + `ja-JP.yml`. One `docs/sk-port/` page for clips and one for pages (donor source, adaptations, gaps) + capability-table rows with live probe results against both backends.

## Verification (paste commands + results in your log)

- `pnpm typecheck && pnpm lint && pnpm test` (or the repo's equivalents per `AGENTS.md`) green.
- Manual matrix, both backends: stock Misskey → every new control hidden/stripped, zero new errors; Pinetree → follow row, federate/visibility controls, import, `users/clips` tab, note clip lists, `i/pages`/`i/page-likes`, embeds all live; private embeds 404 empty.
- One commit per task on `split-project`; do not amend, rebase, or force-push. Note the expected `check-shipping.mjs` Locale FAIL in commit messages.
