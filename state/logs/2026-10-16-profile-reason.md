# 2026-10-16 — profile-card failure reason (diagnostic)

**Report:** `@jm@dvd.chat` still lands on the fallback chip even though
`users/show {"username":"jm"}` succeeds unauthenticated from curl.

**Change:** the fallback chip now prints the per-leg reasons
(`users/show: HTTP 401` / `lookup: HTTP 404` / timeout …) instead of a
bare "unavailable", so the next report pinpoints the failing leg rather
than guessing. `resolveProfile` returns `unresolved + reason`; a timed-out
resource maps to `timed out`.

**Next:** reload the `@jm` post and report the exact reason string on the
chip. Prime suspects from here: revoked/stale external token (401 on the
direct leg while feeds read another path), or no active external session
with the dead dev-proxy (proxy refusal on the internal leg).
