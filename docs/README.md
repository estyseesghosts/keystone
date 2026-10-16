# docs/ — Keystone frontend docs

Living docs. Each file carries a `Status:` line (`Draft` = in progress,
`Accepted` = agreed scope, `Superseded` = replaced — link the replacement).
Update the doc in place as the frontend evolves; record the change in the
session's state log. Never duplicate the frozen backend contract here —
reference it.

## Index

| File | Status | Contents |
|---|---|---|
| `../keystone.md` | Accepted (source brief) | Product/visual brief, bootstrap, API wiring, scope limits, verification |
| `../solidjs.md` | Accepted (source guide) | SolidJS 1.x mental model, props/lists/effects rules, agent checklist |
| `frontend-plan.md` | Draft | MVP scope checklist: routes, slices, deferred items |
| `frontend-parity-plan.md` | Draft (2026-10-16) | Misskey-parity UI plan (backend-gated); companion to `../../pinetree/docs/misskey-parity-plan.md` |
| `mfm.md` | Validated (mfm-js 0.27.0) | MFM allow-list, safety rules, AST validation procedure |
| `router.md` | Validated (router 1.0.0) | Routes, setup pattern, auth gating, anti-patterns |
| `api-surface.md` | Draft (tracks backend Frozen 2026-10-14) | Supported/unsupported endpoints for the UI, transport notes |
| `router.md` | Draft (versions TBD, pending Slice 0) | `@solidjs/router` routes, setup, gating — pin versions after scaffold |
| `mfm.md` | Draft (versions TBD, pending Slice 0) | `mfm-js` allow-list, safety rules, AST validation procedure |
| `../pinetree/docs/endpoint-manifest.md` | Frozen (backend) | Definitive endpoint params, shapes, auth, errors — do not copy, reference |
| `../pinetree/docs/domain-types.md` | Frozen (backend) | Domain fields and constraints |
| `../pinetree/docs/wiki/Current-State.md` | Living (backend) | Implemented features and gaps, incl. no-streaming status |

Conventions: concrete over abstract (exact endpoints, fields, routes);
record unsupported behavior explicitly; no implementation code in contracts.
