# v1 reference carry: my_network.md
> Source: /Users/terezi/Local Documents/Keystone/docs/my_network.md
> Carried: 2026-10-21 — verbatim copy (this header added).
> Reference only — v2 requirements live in docs/parity-gaps.md.

---

# Implementation Plan: Home and My Network Navigation

## Goal

Condense the sidebar's timeline navigation into two entries:

- **Home** — retain the existing home timeline and its current behavior.
- **My Network** — a unified timeline page with Twitter-style tabs across the top.

The user must never land on the Global/Federated feed by default. Prefer Bubble when supported, then Social, then Local.

## 1. Sidebar navigation

Update `frontend/src/components/Layout.tsx`.

- Keep Home at `/`.
- Replace the separate Local and Global sidebar entries with one **My Network** entry.
- Give My Network an appropriate network/community icon from the existing icon set.
- Preserve all other sidebar entries and their current visibility rules.
- Ensure My Network remains highlighted when any of its feed tabs is active.
- Preserve the existing responsive sidebar, compact icon rail, and mobile navigation behavior.

Do not redesign the sidebar as part of this change.

## 2. My Network page and tabs

Create `frontend/src/routes/MyNetwork.tsx`.

The page should have a compact heading, **My Network**, followed by horizontal, Twitter-style feed tabs at the top of the timeline.

Available tabs:

- **Bubble** — show only when the active server supports its curated timeline.
- **Social** — show only when the active server supports a Social timeline.
- **Local** — the current instance's public posts.
- **Federated** — the existing Global timeline, containing posts from the wider federated network.

Bubble and Social are separate feeds. Show both when both are supported; do not substitute one feed's contents for the other.

Use this ordering:

1. Bubble, when available.
2. Social, when available.
3. Local.
4. Federated.

The preferred initial selection is **Bubble → Social → Local**. Federated must never be chosen automatically, even if the other feeds are unavailable.

If none of the preferred feeds can load, show an honest unsupported/error state. Never silently fall back to Federated.

### Tab behavior

- Clearly distinguish the selected tab.
- Keep the design consistent with Keystone's existing monochrome styling and both themes.
- Switch the displayed feed without duplicating timeline-fetching, pagination, or post-rendering logic.
- Preserve per-feed caching, scroll position, refresh, pagination, and live updates.
- Use URL-backed tab selection so links, reloads, and browser back/forward navigation work correctly.

Suggested routes:

| Route | Purpose |
|---|---|
| `/network` | Choose the preferred available default |
| `/network/bubble` | Bubble |
| `/network/social` | Social |
| `/network/local` | Local |
| `/network/federated` | Federated |

When an explicitly requested tab is unsupported on the active server, handle that state deliberately rather than rendering a different feed under the requested tab's label.

## 3. Feed abstraction and backend support

Extend Keystone's existing shared feed abstraction rather than building separate feed implementations.

Relevant files include:

- `frontend/src/core/backend.ts`
- `frontend/src/misskey/backend.ts`
- `frontend/src/mastodon/backend.ts`
- The corresponding Misskey and Mastodon API/timeline modules
- `frontend/src/components/TimelineFeed.tsx`

### Social

Misskey-family servers expose Social through the authenticated `notes/hybrid-timeline` endpoint. It combines posts from followed users with public posts from local users.

Implement Social as a first-class feed source and map it to the proper endpoint. Do not change the existing Home feed's meaning or endpoint.

Reference: [Misskey API: hybrid timeline](https://api-doc.misskey.io/api-7254025).

### Bubble

Bubble is a server-curated feed, not a client-side filter over Global.

For Akkoma-compatible Mastodon APIs, the documented endpoint is `/api/v1/timelines/bubble`. Other server flavors must use their own verified implementation where available.

Reference: [Akkoma Mastodon API differences](https://docs.akkoma.dev/develop/development/API/differences_in_mastoapi_responses/).

Before enabling Bubble, verify the endpoint for the relevant backend. Do not assume that all Mastodon-compatible or Misskey-family servers support it.

### Local and Federated

Reuse the existing Local and Global implementations wherever possible.

- Local retains its current endpoint and behavior.
- Federated maps to the existing Global source and endpoint.
- The user-facing tab label becomes **Federated**; internal endpoint names need not change.

### Capability detection

Availability must be determined per active server, not just by protocol family.

- Only show tabs that are confirmed to be supported and usable in the current session.
- Cache capability results appropriately for the active server.
- Treat a confirmed unsupported-endpoint response as evidence of absence.
- Do not interpret timeouts, server errors, or permission errors as proof that an endpoint does not exist.
- Do not repeatedly probe the same endpoint on every render or tab switch.
- Account for authentication requirements when choosing the initial feed.

## 4. Streaming and feed lifecycle

Update the existing streaming adapters when the server supports live delivery for the additional feeds.

Relevant files:

- `frontend/src/misskey/stream.ts`
- `frontend/src/mastodon/stream.ts`
- `frontend/src/components/TimelineFeed.tsx`
- `frontend/src/state/feedCache.ts`

Use the appropriate Social or Bubble streaming channel where verified. If a feed has no supported stream, retain its existing polling/manual-refresh fallback behavior.

Switching tabs must not leave multiple active feed subscriptions or allow posts from the previous tab to appear in the newly selected feed.

Keep cache keys distinct by account and feed source.

## 5. Routing and compatibility

Update `frontend/src/routes.ts` and `frontend/src/App.tsx` to register the new routes and page component.

Keep the existing `/local` and `/global` URLs working as redirects:

- `/local` → `/network/local`
- `/global` → `/network/federated`

These redirects preserve existing bookmarks and make explicitly visiting the old Global URL an intentional request for Federated—not a default-selection rule.

Keep Home at `/` and leave `frontend/src/routes/Home.tsx` unchanged unless the router requires a strictly minimal wiring adjustment.

## 6. Tests and verification

Add or update tests covering:

**Navigation and routing**
- Sidebar contains Home and My Network, not separate Local and Global entries.
- All My Network tab routes work.
- Legacy Local and Global URLs redirect correctly.
- Active navigation state is correct on every network subroute.
- Existing route-reservation and base-path tests continue to pass.

**Default selection**
- Bubble and Social available → Bubble selected.
- Social available, Bubble unavailable → Social selected.
- Neither available → Local selected.
- Federated is never automatically selected.
- If Local also fails, show an error/unsupported state rather than silently selecting Federated.

**Backend behavior**
- Social calls the correct authenticated endpoint.
- Bubble calls only a verified endpoint for the relevant server.
- Unsupported endpoints hide their tabs after confirmed detection.
- Server errors and permission failures are reported correctly.
- Feed switching preserves independent cache, pagination, and scroll state.
- Streaming subscriptions are replaced or cleaned up correctly.

**Regression checks**
- Home's behavior is unchanged.
- Local and Federated still load their correct posts.
- Composer behavior, post interactions, themes, and responsive layouts remain intact.

Run Keystone's existing typecheck, test suite, and production build. Verify the changes in a browser against at least one Misskey-family server and one Mastodon-family server, including a server with Bubble support and one without it.

## Implementation constraints

- Follow `AGENTS.md`: SolidJS only; no React, new state framework, or CSS framework.
- Reuse `TimelineFeed` and the existing backend adapters rather than duplicating timeline logic.
- Keep changes narrowly scoped to navigation, timeline selection, backend capability handling, and related tests.
- Update `state/STATE.md` and append a dated implementation log as required by the repository instructions.

## Definition of done

The sidebar has exactly two timeline destinations: Home and My Network. Home still behaves exactly as it did before. My Network exposes the feeds genuinely supported by the active server, selects Bubble or Social ahead of Local when available, preserves the user's explicit tab navigation, and **never defaults to Federated**.
