// Error-code convention for `packages/fedi` (pure TS, no i18n framework).
//
// The data layer never localizes: every failure carries a stable `code`
// (dotted key, e.g. `errors.network.timeoutInstance`) plus `params` for
// interpolation. The UI in `src/` resolves codes to localized strings.
// `message` is a fixed English fallback for logs and un-localized surfaces.
//
// Also ports old Keystone `frontend/src/api/error.ts` (`ApiError`), adapted
// with an optional `params` bag.

/** Localizable error identity: stable code + interpolation params. */
export interface ErrorCode {
  code: string;
  params?: Record<string, unknown>;
}

/** Base error for the data layer: an English message plus its code. */
export class FediError extends Error {
  readonly code: string;
  readonly params: Record<string, unknown>;

  constructor(message: string, code: string, params?: Record<string, unknown>) {
    super(message);
    this.name = "FediError";
    this.code = code;
    this.params = params ?? {};
  }
}

/** Shared API error shape for fedi API targets (ported from old `api/error.ts`).
 *
 * Both family transports throw this class so `instanceof ApiError` checks
 * work for either transport. `status` is the HTTP status (0 when the
 * request never reached the server); `code`/`kind` are the server's own
 * error identifiers when it sent any; `params` carries interpolation data
 * for the UI's localized rendering. */
export class ApiError extends FediError {
  readonly status: number;
  readonly kind?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    kind?: string,
    params?: Record<string, unknown>,
  ) {
    super(message, code ?? "errors.network.apiError", { status, ...params });
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }
}

/** Best-effort HTTP status of anything a query/mutation may throw:
 * `.status` when present and sane (`ApiError`, `HttpError`), else the
 * `params.status` the constructors mirror there. 0 (never reached the
 * server) and absent both read null — never a retry decision. Pure. */
export function httpStatusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const direct = (err as { status?: unknown }).status;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const params = (err as { params?: unknown }).params;
  if (typeof params === "object" && params !== null) {
    const mirrored = (params as { status?: unknown }).status;
    if (typeof mirrored === "number" && Number.isFinite(mirrored) && mirrored > 0) {
      return mirrored;
    }
  }
  return null;
}

/** HTTP statuses no retry can fix: rejected auth, a missing target, an
 * unprocessable request, or explicit throttling. Timeouts, network
 * failures (status 0/absent), and 5xx stay retryable. Pure. */
const NON_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 410, 422, 429]);

/** True when refetching this failure is pointless (auth/missing/
 * invalid/throttled). Query `retry` predicates consult this so one
 * throttled request does not become three. Pure. */
export function isNonRetryableStatus(err: unknown): boolean {
  const status = httpStatusOf(err);
  return status !== null && NON_RETRYABLE_STATUSES.has(status);
}
