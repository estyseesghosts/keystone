# ADR 0001 — Patterns, not code, from Bluesky

Date: 2026-10-20
Status: accepted
Plan ref: `rn-rebuild-plan.md` §1, §4 (owner directive 2026-10-20)

## Problem

The plan says "copy Bluesky's stack, folder layout, conventions" and
"when Bluesky has a pattern, copy it". Taken literally, that invites
vendoring Bluesky source (components, ALF, screens) into this repo,
which the owner does not want: we must not copy how Bluesky looks, and
must not lift its code — only how its app architecture works.

## Options considered

1. Vendor Bluesky source files and restyle (fastest, but carries their
   look, license surface, and upstream drift).
2. Study Bluesky's architecture and re-implement our own code following
   the same shapes (entries, aliases, storage schema, query-key
   discipline, platform files, theme-token structure).

## Decision

Option 2. No verbatim Bluesky source in `src/` or `packages/`.
Reference paths consulted go in session logs, never in code comments.
`NOTICE.md` records the reference pin without claiming vendored code.

## Consequences

- Good: clean ownership, Keystone look from day one, smaller license
  surface.
- Bad / accepted risk: more authoring work per slice (ALF, components,
  shell are ours, shaped like theirs); divergence risk is mitigated by
  logging which Bluesky file each design mirrors.
- Follow-ups: slice 1.2 drops the `eslint-plugin-bsky-internal` idea and
  implements our own boundary rules; slice 1.3 rolls our own ALF.
