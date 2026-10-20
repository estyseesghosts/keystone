# ADR 0002 — Two UI layouts: butterfly and tarantula

Date: 2026-10-20
Status: accepted
Plan ref: n/a (owner direction; postdates `rn-rebuild-plan.md`)

## Problem

Keystone v1 is one fixed layout. The rebuild needs to serve two different
uses: a simple touch-friendly client for everyday reading/posting, and a
customizable multi-column power tool in the TweetDeck / Misskey-deck
tradition. Building both as one adaptive layout would tangle the code and
satisfy neither audience.

## Options considered

1. One adaptive layout for everything. Rejected: deck semantics (columns,
   widgets, per-column accounts) and simple-client semantics fight over
   navigation, chrome, and state shape.
2. Two named layouts sharing one data layer. Accepted (below).
3. Two separate apps. Rejected: double the data-layer, session, and
   query work for no gain — `packages/fedi` already serves any layout.

## Decision

Keystone v2 ships two UI layouts over the single shared stack
(`packages/fedi` + session store + query layer):

- **butterfly** — the simple, mobile- and touch-friendly layout. One
  column, bottom nav on phones, rail on wide screens. This is the current
  `src/` tree and the active work focus.
- **tarantula** — the customizable widget-based layout (TweetDeck /
  Misskey-deck kind): user-arranged columns and widgets, deck columns
  addressed from day one by `FeedDescriptor` strings
  (`{descriptor, sessionId, options}` per column).

Rules that already anticipate this live on: UI sees only `packages/fedi`
domain models; every query key includes `sessionId`; feed addressing uses
`FeedDescriptor` strings (plan §2). Butterfly work must not break those
seams — tarantula will ride them later (Phase 5 deck work becomes the
tarantula layout).

## Consequences

- Butterfly is styled to match Keystone v1 as closely as the React Native
  / Expo stack allows (mobile + wide layouts). v1 remains the visual
  reference; the alf theme carries the mapping.
- Tarantula is out of scope until butterfly is done; no widget code lands
  in `src/` before then.
- New shared UI must be layout-agnostic where cheap (pure components under
  `src/components/`), layout-specific where not (`src/features/deck/` stays
  tarantula territory).
