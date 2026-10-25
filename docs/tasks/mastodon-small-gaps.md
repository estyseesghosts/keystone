# Mastodon small gaps — tracked follow-ups (repair X4.4 step 9)

Source: `docs/audit_20261025/results/mastodon.md` finding 22, plus the
X4.4 slice log `state/logs/2026-10-25-repair25-x4.4.md`.

Rule from the repair plan: each gap lands only where an existing UI
surface already has a slot, capability-gated. None of the four below
has a slot today, so no code ships for them here — they are tracked,
not silently dropped. A future slice that adds the slot implements the
backend line item in the same slice (backend + UI together, never an
inert control).

## 1. Multi-tag timelines (`any[]` / `all[]`)

- Audit: finding 22 (`fetchTagTimelinePage` supports a single tag only).
- State: `Backend.search.tags(tag)` and `FeedDescriptor` `tag|<name>` are
  single-tag; no multi-tag feed, deck column, or search UI exists.
- Backend work when a slot lands: `search.tags` overload (or a new
  `search.tagsMulti(names, {mode: 'any'|'all'})`) hitting
  `/api/v1/timelines/tag/:tag` per tag with client-side merge (the
  server has no multi-tag timeline endpoint — verify against
  `docs/mastoapi-contract.md` before assuming `tag[]=`, and list the
  live check in X12.1), or one new endpoint if the server grows one.
  Capability-gate on the existing `lists`/tag surface; never fake a
  merged order (cursor = per-tag cursors, end = all tags ended).

## 2. Featured tags for other accounts

- Audit: finding 22 (featured tags shown for the viewer only).
- State: `TagsApi.featured()` is viewer-scoped (`GET
  /api/v1/featured_tags`); `TagsApi.show(name)` is viewer-context
  follow/feature state. No profile surface renders another account's
  featured tags.
- Backend work when a slot lands: confirm a server route exists for
  other accounts (Mastodon has no `GET
  /api/v1/accounts/:id/featured_tags` in the documented API — probe
  first; if absent, the slot stays viewer-only and this item closes
  as "no server route"). Never synthesize another account's tags from
  their posts.

## 3. Scheduled-status edit (`PUT /api/v1/scheduled_statuses/:id`)

- Audit: finding 22 (scheduled statuses list/create/delete but not edit).
- State: `ScheduledApi` is list/create/delete; no scheduled-posts
  screen exists in `src/` (only composer scheduling), so there is no
  edit UI to wire.
- Backend work when a slot lands: optional `ScheduledApi.update(id,
  draft)` via `PUT /api/v1/scheduled_statuses/:id` with the same
  `statusBodyOf` + `scheduled_at` body as create; capability-gate on
  the existing `scheduled_posts` flag. Fixture: a recorded
  scheduled-status row (X5.6 capture list already wants one).

## 4. `favourited_by` list (who favourited a post)

- Audit: finding 22 (`reposts` shows boosters only; `favourited_by`
  exists in the endpoint code but is not surfaced).
- State: the endpoint helper `fetchStatusAccountPage(id,
  'favourited_by')` exists and is tested-shape-ready, but `Backend`
  has no `favouritedBy` member and the detail screen has a Reposts tab
  only — no Favourites tab.
- Backend work when a slot lands: `Backend.reposts`-style
  `favouritedBy(id, opts)` returning `Page<Account>` (Link-paged, same
  end rule), OR generalize `reposts` only if the UI genuinely merges
  the tabs (it does not — keep them separate, favourites stay distinct
  from reactions per keystodon.md §1.5). Capability: no new flag
  needed (same endpoint family as `reblogged_by`); the tab itself is
  the gate.
