# API reference (`packages/fedi`)

Audience: app code in `src/` and anyone wiring a UI surface to the data
layer. This is a map of what the code actually calls — not a server manual.

## Pages

- [Domain models](fedi-models.md) — `Post`, `Account`, `Notification`,
  `Capabilities`, `FeedDescriptor`, and friends. Field-level, with the core
  type that owns each shape.
- [Misskey-family endpoints](misskey-endpoints.md) — every `POST /api/*`
  call the Misskey adapter makes, per module.
- [Mastodon-family endpoints](mastodon-endpoints.md) — every REST path and
  streaming subscription the Mastodon adapter makes, per module.
- [Auth and sessions](auth-and-sessions.md) — MiAuth flow, Mastodon OAuth
  (external, password, MFA, injected), per-origin token storage, revocation.
- [Streaming](streaming.md) — transports, channels, reconnect/backoff, what
  is and is not supported.
- [Errors and retry](errors-and-retry.md) — status codes, strict-server quirks,
  204s, 429 defense, idempotency, reason codes.

## Boundary rules (non-negotiable)

- `src/` sees only domain models (`Post`, `Account`, `Notification`,
  `Capabilities`, plus `Page`, `Media`, `Poll`, `Relationship`, `Filter`,
  and the `Backend` interface). Wire types never cross into `src/`.
  Enforced by the `no-wire-in-app` lint rule.
- `packages/fedi` is pure TypeScript: no `react`, `react-native`, `expo*`,
  `#/` imports, no `window`/`document`. Enforced by `no-ui-in-fedi`.
- Every action is gated on a `Capabilities` flag. Unsupported means hidden
  or disabled with a reason — never an inert control, never fake data.
- Tokens are per origin. Requests built from one session never carry
  another session's token or origin.

## Authoritative sources

The carried server specs stay authoritative for server behavior:

- Misskey-family transport, auth, and capability matrix:
  `docs/api-surface.md` (verified against live Misskey-family rigs).
- Mastodon-family contract: `docs/mastoapi-contract.md` (endpoint shapes
  verified against local Mastodon/Akkoma checkouts; live verification
  incomplete — see its staleness note).
- Product decisions: `docs/DECISIONS.md`; architecture records:
  `docs/adr/`.

Where this reference and a carried spec disagree about what the code does,
the code wins and the disagreement is a bug to file — this reference cites
a call site for every row so it can be checked.

## How to verify a row

Every endpoint table has a Sources section with `file:line` call sites.
Spot-check with ripgrep, for example:

```bash
grep -rn '"notes/create"' packages/fedi/src/misskey/
grep -rhoE '"/api/v1/[a-z_/]+"' packages/fedi/src/mastodon/ | sort -u
```

`scripts/fedi-smoke.ts` exercises the read-only baseline (detect, meta,
timeline, post, account, authed `me`, stream handle, list-only submodule
probes) against the rig servers.
