import type {I18n, MessageDescriptor} from '@lingui/core'
import {msg} from '@lingui/macro'
import type {FediErrorCode} from '@keystone/fedi'

// Localized FediError codes (P5). `packages/fedi` never localizes: every
// failure carries a stable `code` (dotted key) plus `params`. This map
// resolves those codes to Lingui messages so the UI renders the reader's
// language instead of the fixed English fallback.
//
// Message ids ARE the FediError codes, and the English source strings are
// the v1 reference dict values (`frontend/src/i18n/locales/en.ts`): the
// carried-locale seeding script matches on the id, so translations land
// without inventing new strings. Codes with no v1 entry (feeds,
// reactions, created/updated lists) ship English-only until v2 adds them.

// Exhaustive by construction (X9.7): typed `Record<FediErrorCode, …>`
// so a new code in `packages/fedi` fails typecheck until it has a
// message here. Runtime lookups for unknown (e.g. server wire) codes
// fall back to `FALLBACK` below — never raw text.
export const FEDI_ERROR_MESSAGES: Record<FediErrorCode, MessageDescriptor> = {
  'errors.validation.hostRequired': msg({id: 'errors.validation.hostRequired', message: 'Enter an instance host, e.g. example.com.'}),
  'errors.validation.hostScheme': msg({id: 'errors.validation.hostScheme', message: 'Use an http(s) instance address, e.g. example.com.'}),
  'errors.validation.hostInvalid': msg({id: 'errors.validation.hostInvalid', message: 'That host does not look like a valid instance address.'}),
  'errors.network.crossOrigin': msg({id: 'errors.network.crossOrigin', message: "Refusing to send this request: the URL points at a different origin than the session's."}),
  'errors.network.redirect': msg({id: 'errors.network.redirect', message: 'Server redirected the request (HTTP {status}); refusing to follow with credentials.'}),
  'errors.origin.insecure': msg({id: 'errors.origin.insecure', message: 'Refusing to use insecure http for "{host}". Use https or a local test host.'}),
  'errors.network.badPath': msg({id: 'errors.network.badPath', message: 'Request path must start with "/": got "{path}".'}),
  'errors.network.unreachableBare': msg({id: 'errors.network.unreachableBare', message: 'Could not reach {origin} ({reason}).'}),
  'errors.network.timeoutInstance': msg({id: 'errors.network.timeoutInstance', message: 'Request timed out ({target}): the instance did not answer within {n}s. Retry.'}),
  'errors.network.timeoutUpload': msg({id: 'errors.network.timeoutUpload', message: 'Upload timed out after {n}s: the file may already be on the server. Check before retrying.'}),
  'errors.network.aborted': msg({id: 'errors.network.aborted', message: 'Request was cancelled.'}),
  'errors.network.timeoutServer': msg({id: 'errors.network.timeoutServer', message: 'Request timed out ({target}): the server did not answer within {n}s. Retry, or check the dev-server terminal.'}),
  'errors.network.unreachableInstance': msg({id: 'errors.network.unreachableInstance', message: 'Could not reach the instance ({reason}). Is the host correct?'}),
  'errors.network.unreachableOrigin': msg({id: 'errors.network.unreachableOrigin', message: 'Could not reach {origin} ({reason}). Is the server running and the host correct?'}),
  'errors.network.unreachableServer': msg({id: 'errors.network.unreachableServer', message: 'Could not reach the server ({reason}). Is it running?'}),
  'errors.network.badJson': msg({id: 'errors.network.badJson', message: 'Server returned a non-JSON body (HTTP {status}) for {target}.'}),
  'errors.network.apiError': msg({id: 'errors.network.apiError', message: 'API error: HTTP {status}'}),
  'errors.auth.noKeystoneToken': msg({id: 'errors.auth.noKeystoneToken', message: 'The server did not issue a Keystone token for this session.'}),
  'errors.auth.noCredentials': msg({id: 'errors.auth.noCredentials', message: 'The server registered an app but did not return usable credentials.'}),
  'errors.auth.signinFailed': msg({id: 'errors.auth.signinFailed', message: 'Sign-in failed.'}),
  'errors.auth.mfaRequired': msg({id: 'errors.auth.mfaRequired', message: 'This account requires two-factor authentication. Enter your code to finish signing in.'}),
  'errors.auth.extraStep': msg({id: 'errors.auth.extraStep', message: 'This account needs an extra sign-in step that Keystone does not support.'}),
  'errors.auth.miauthTimeout': msg({id: 'errors.auth.miauthTimeout', message: 'The approval was not completed in time. Approve on your server, then try again.'}),
  'errors.auth.mfaFailed': msg({id: 'errors.auth.mfaFailed', message: 'Two-factor sign-in failed.'}),
  'errors.auth.noVerifyAccount': msg({id: 'errors.auth.noVerifyAccount', message: 'verify_credentials did not return an account.'}),
  'errors.auth.savePending': msg({id: 'errors.auth.savePending', message: 'Could not save the sign-in state (session storage blocked) — the redirect flow cannot continue safely.'}),
  'errors.unsupported.pinned': msg({id: 'errors.unsupported.pinned', message: 'Pinned-post listings are not available on this server.'}),
  'errors.unsupported.social': msg({id: 'errors.unsupported.social', message: 'The social timeline is not available on this server.'}),
  'errors.unsupported.reactions': msg({id: 'errors.unsupported.reactions', message: 'Reaction listings are not available on this server.'}),
  'errors.unsupported.featured': msg({id: 'errors.unsupported.featured', message: 'The featured-notes listing is not available on this server.'}),
  'errors.unsupported.noAccountRef': msg({id: 'errors.unsupported.noAccountRef', message: 'No account reference given.'}),
  'errors.unsupported.noAccountFound': msg({id: 'errors.unsupported.noAccountFound', message: 'No account found for {acct}.'}),
  'errors.unsupported.boostVisibility': msg({id: 'errors.unsupported.boostVisibility', message: 'You can only change boost visibility for accounts you follow.'}),
  'errors.unsupported.profileField': msg({id: 'errors.unsupported.profileField', message: 'This server has no profile field for {fields}.'}),
  'errors.shape.createdPost': msg({id: 'errors.shape.createdPost', message: 'The server did not return the created post.'}),
  'errors.shape.createdList': msg({id: 'errors.shape.createdList', message: 'The server did not return the created list.'}),
  'errors.shape.updatedList': msg({id: 'errors.shape.updatedList', message: 'The server did not return the updated list.'}),
  'errors.shape.updatedProfile': msg({id: 'errors.shape.updatedProfile', message: 'The server did not return the updated profile.'}),
  'errors.shape.uploadedMedia': msg({id: 'errors.shape.uploadedMedia', message: 'The server did not return the uploaded media.'}),
  'errors.shape.noTranslation': msg({id: 'errors.shape.noTranslation', message: 'The server returned no translation for this post.'}),
  'errors.shape.noScheduled': msg({id: 'errors.shape.noScheduled', message: 'The server did not return the scheduled status.'}),
  'errors.shape.noPoll': msg({id: 'errors.shape.noPoll', message: 'This post has no poll to vote in.'}),
  'errors.shape.relationships': msg({id: 'errors.shape.relationships', message: 'Relationships returned an unexpected response shape.'}),
  'errors.shape.statusContext': msg({id: 'errors.shape.statusContext', message: 'Status context returned an unexpected response shape.'}),
  'errors.shape.mediaLookup': msg({id: 'errors.shape.mediaLookup', message: 'Media lookup returned an unexpected response shape.'}),
  'errors.shape.timeline': msg({id: 'errors.shape.timeline', message: 'Timeline {kind} returned an unexpected response shape (HTTP {status}).'}),
  'errors.shape.account': msg({id: 'errors.shape.account', message: 'Account {id} returned an unexpected response shape.'}),
  'errors.shape.status': msg({id: 'errors.shape.status', message: 'Status {id} returned an unexpected response shape.'}),
  'errors.shape.trendingTags': msg({id: 'errors.shape.trendingTags', message: 'Trending tags returned an unexpected response shape.'}),
  'errors.shape.trendingStatuses': msg({id: 'errors.shape.trendingStatuses', message: 'Trending posts returned an unexpected response shape.'}),
  'errors.shape.trendingLinks': msg({id: 'errors.shape.trendingLinks', message: 'Trending links returned an unexpected response shape.'}),
  'errors.shape.suggestions': msg({id: 'errors.shape.suggestions', message: 'Suggestions returned an unexpected response shape.'}),
  'errors.shape.expectedList': msg({id: 'errors.shape.expectedList', message: 'Expected a {kind} list (HTTP {status}).'}),
  'errors.reactions.likeUnsupported': msg({id: 'errors.reactions.likeUnsupported', message: 'This server does not support likes yet.'}),
  'errors.compose.fileTooLarge': msg({id: 'errors.compose.fileTooLarge', message: 'File is too large ({kb} KB — limit is 10 MB).'}),
  'errors.compose.limitsUnavailable': msg({id: 'errors.compose.limitsUnavailable', message: 'Could not load the server limits.'}),
  'errors.crypto.unavailable': msg({id: 'errors.crypto.unavailable', message: 'Secure random values are unavailable on this device.'}),
  'errors.session.missingId': msg({id: 'errors.session.missingId', message: 'A session id is required.'}),
  'errors.stream.unavailable': msg({id: 'errors.stream.unavailable', message: 'Could not open the live connection.'}),
  'errors.poll.partialVote': msg({id: 'errors.poll.partialVote', message: 'Part of the vote was recorded before it failed.'}),
  'errors.account.refRequired': msg({id: 'errors.account.refRequired', message: 'An account lookup needs an id or a username.'}),
  'errors.report.commentRequired': msg({id: 'errors.report.commentRequired', message: 'A report needs a reason on this server.'}),
  'errors.chat.messageRequired': msg({id: 'errors.chat.messageRequired', message: 'A chat message needs text or a file.'}),
  'errors.shape.tag': msg({id: 'errors.shape.tag', message: 'Tag {name} returned an unexpected response shape.'}),
  'errors.shape.noConversationFound': msg({id: 'errors.shape.noConversationFound', message: 'No conversation found for {id}.'}),
  'errors.shape.noAccountFound': msg({id: 'errors.shape.noAccountFound', message: 'No account found for {acct}.'}),
  'errors.shape.conversation': msg({id: 'errors.shape.conversation', message: 'Marking conversation {id} read returned an unexpected response shape.'}),
  'errors.shape.statusHistory': msg({id: 'errors.shape.statusHistory', message: 'Status history returned an unexpected response shape.'}),
  'errors.shape.mediaUpdate': msg({id: 'errors.shape.mediaUpdate', message: 'The media update returned an unexpected response shape.'}),
  'errors.shape.markers': msg({id: 'errors.shape.markers', message: 'Markers returned an unexpected response shape.'}),
  'errors.shape.customEmojis': msg({id: 'errors.shape.customEmojis', message: 'Custom emojis returned an unexpected response shape.'}),
  'errors.shape.notificationPolicy': msg({id: 'errors.shape.notificationPolicy', message: 'The notification policy returned an unexpected response shape.'}),
  'errors.shape.notificationRequests': msg({id: 'errors.shape.notificationRequests', message: 'Notification requests returned an unexpected response shape (HTTP {status}).'}),
  'errors.shape.reportLookup': msg({id: 'errors.shape.reportLookup', message: 'Admin report lookup returned an unexpected response shape.'}),
  'errors.shape.emptyReportPatch': msg({id: 'errors.shape.emptyReportPatch', message: 'Nothing to update: set a category or rule ids first.'}),
  'errors.shape.uploadedFile': msg({id: 'errors.shape.uploadedFile', message: 'The server did not return the uploaded file.'}),
  'errors.unsupported.adminInsight': msg({id: 'errors.unsupported.adminInsight', message: 'Server insight {scope} is not available on this server.'}),
  'errors.unsupported.antennas': msg({id: 'errors.unsupported.antennas', message: 'Antennas are not available on this server.'}),
  'errors.unsupported.bookmarks': msg({id: 'errors.unsupported.bookmarks', message: 'Bookmarks are not available on this server.'}),
  'errors.unsupported.channels': msg({id: 'errors.unsupported.channels', message: 'Channels are not available on this server.'}),
  'errors.unsupported.clips': msg({id: 'errors.unsupported.clips', message: 'Clips are not available on this server.'}),
  'errors.unsupported.explore': msg({id: 'errors.unsupported.explore', message: 'Trending posts are not available on this server.'}),
  'errors.unsupported.lists': msg({id: 'errors.unsupported.lists', message: 'Lists are not available on this server.'}),
  'errors.unsupported.recommendations': msg({id: 'errors.unsupported.recommendations', message: 'Recommendations are not available on this server.'}),
  'errors.unsupported.markers': msg({id: 'errors.unsupported.markers', message: 'Marking notifications read is not on this server.'}),
  'errors.unsupported.reportDecision': msg({id: 'errors.unsupported.reportDecision', message: 'This server records no verdict on resolved reports.'}),
  'errors.filter.invalidRegex': msg({id: 'errors.filter.invalidRegex', message: 'Invalid regular expression on line {line}.'}),
  'errors.feeds.invalidDescriptor': msg({id: 'errors.feeds.invalidDescriptor', message: 'Invalid feed descriptor.'}),
}

// Generic fallback for unknown codes: the v1 `actionFailed` string, so even
// the fallback is a carried translation (never an invented message).
const FALLBACK = msg({id: 'errors.compose.actionFailed', message: 'Action failed.'})

export interface CodedError {
  code: string
  params?: Record<string, unknown>
}

export function isKnownErrorCode(code: string): boolean {
  return Object.hasOwn(FEDI_ERROR_MESSAGES, code)
}

/** Localize a FediError-shaped `{code, params}` for display. Pure. */
export function formatFediError(
  i18n: I18n,
  err: CodedError | null | undefined,
  values?: Record<string, unknown>,
): string {
  if (!err || typeof err.code !== 'string')
    return i18n._(FALLBACK.id, undefined, {message: FALLBACK.message})
  // The table is keyed by the `FediErrorCode` union, but runtime errors
  // also carry server wire codes — read through a string index so unknown
  // codes land on the generic fallback instead of failing typecheck.
  const table: Record<string, MessageDescriptor> =
    FEDI_ERROR_MESSAGES as unknown as Record<string, MessageDescriptor>
  const descriptor = table[err.code] ?? FALLBACK
  return i18n._(descriptor.id, {...err.params, ...values}, {message: descriptor.message})
}

/** A `{code, params}` pair only when `err` carries a KNOWN `FediErrorCode`
 * with object params — else null (the caller renders its generic text).
 * This is the single gate between raw throws and user-visible toasts:
 * nothing it rejects ever has its `message` displayed. Pure. */
export function toCodedError(err: unknown): CodedError | null {
  if (typeof err !== 'object' || err === null) return null
  const code = (err as {code?: unknown}).code
  if (typeof code !== 'string' || !isKnownErrorCode(code)) return null
  const params = (err as {params?: unknown}).params
  return {
    code,
    ...(params !== null && typeof params === 'object'
      ? {params: params as Record<string, unknown>}
      : {}),
  }
}

/** User-facing error text (X9.7): a known code renders its localized
 * message; anything else renders the caller's contextual `fallback`
 * (already translated at the call site). Raw error text and server
 * response text never reach the screen through here. Pure. */
export function errorText(i18n: I18n, err: unknown, fallback: string): string {
  const coded = toCodedError(err)
  if (!coded) return fallback
  return formatFediError(i18n, coded)
}
