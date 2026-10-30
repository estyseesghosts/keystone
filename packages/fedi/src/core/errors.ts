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

/** Every UI-facing error code the data layer can throw (X9.7). The single
 * source of truth: the UI's message table is typed
 * `Record<FediErrorCode, …>` so a new entry here fails typecheck until it
 * has a message, and the fedi scan test (`test/error-codes.test.ts`) fails
 * when a fedi throw site uses a code missing here. Server wire codes
 * (`PERMISSION_DENIED`, `QUOTE_DISABLED_FOR_USER`, …) are NOT listed — they
 * ride `ApiError.code` as data and render through the generic fallback. */
export const FEDI_ERROR_CODES = [
  "errors.account.refRequired",
  "errors.auth.extraStep",
  "errors.auth.mfaFailed",
  "errors.auth.mfaRequired",
  "errors.auth.miauthTimeout",
  "errors.auth.noCredentials",
  "errors.auth.noKeystoneToken",
  "errors.auth.noVerifyAccount",
  "errors.auth.savePending",
  "errors.auth.signinFailed",
  "errors.chat.messageRequired",
  "errors.clips.alreadyClipped",
  "errors.clips.noSuchClip",
  "errors.clips.tooManyNotes",
  "errors.compose.fileTooLarge",
  "errors.compose.limitsUnavailable",
  "errors.crypto.unavailable",
  "errors.drive.badFileName",
  "errors.drive.badFileType",
  "errors.drive.fileTooLarge",
  "errors.drive.folderNotEmpty",
  "errors.drive.inappropriate",
  "errors.drive.noSpace",
  "errors.drive.noSuchFolder",
  "errors.drive.noSuchParent",
  "errors.drive.recursiveNesting",
  "errors.feeds.invalidDescriptor",
  "errors.filter.invalidRegex",
  "errors.network.aborted",
  "errors.network.apiError",
  "errors.network.badJson",
  "errors.network.badPath",
  "errors.network.crossOrigin",
  "errors.network.redirect",
  "errors.network.timeoutInstance",
  "errors.network.timeoutServer",
  "errors.network.timeoutUpload",
  "errors.network.unreachableBare",
  "errors.network.unreachableInstance",
  "errors.network.unreachableOrigin",
  "errors.network.unreachableServer",
  "errors.origin.insecure",
  "errors.poll.partialVote",
  "errors.reactions.likeUnsupported",
  "errors.report.commentRequired",
  "errors.session.missingId",
  "errors.shape.account",
  "errors.shape.conversation",
  "errors.shape.createdList",
  "errors.shape.createdPost",
  "errors.shape.customEmojis",
  "errors.shape.emptyReportPatch",
  "errors.shape.expectedList",
  "errors.shape.markers",
  "errors.shape.mediaLookup",
  "errors.shape.mediaUpdate",
  "errors.shape.noAccountFound",
  "errors.shape.noConversationFound",
  "errors.shape.noPoll",
  "errors.shape.noScheduled",
  "errors.shape.notificationPolicy",
  "errors.shape.notificationRequests",
  "errors.shape.notificationUnreadCount",
  "errors.shape.noTranslation",
  "errors.shape.relationships",
  "errors.shape.reportLookup",
  "errors.shape.status",
  "errors.shape.statusContext",
  "errors.shape.statusHistory",
  "errors.shape.suggestions",
  "errors.shape.tag",
  "errors.shape.timeline",
  "errors.shape.trendingLinks",
  "errors.shape.trendingStatuses",
  "errors.shape.trendingTags",
  "errors.shape.updatedList",
  "errors.shape.updatedProfile",
  "errors.shape.uploadedFile",
  "errors.shape.uploadedMedia",
  "errors.stream.unavailable",
  "errors.unsupported.adminInsight",
  "errors.unsupported.antennas",
  "errors.unsupported.bookmarks",
  "errors.unsupported.boostVisibility",
  "errors.unsupported.channels",
  "errors.unsupported.clips",
  "errors.unsupported.explore",
  "errors.unsupported.featured",
  "errors.unsupported.lists",
  "errors.unsupported.markers",
  "errors.unsupported.noAccountFound",
  "errors.unsupported.noAccountRef",
  "errors.unsupported.notification_unread_count",
  "errors.unsupported.pinned",
  "errors.unsupported.profileField",
  "errors.unsupported.reactions",
  "errors.unsupported.recommendations",
  "errors.unsupported.reportDecision",
  "errors.unsupported.social",
  "errors.validation.hostInvalid",
  "errors.validation.hostRequired",
  "errors.validation.hostScheme",
] as const;

/** A UI-facing error code. Kept in sync with the throw sites by the
 * `localeErrors` union test (every entry must have a descriptor). */
export type FediErrorCode = (typeof FEDI_ERROR_CODES)[number];

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
