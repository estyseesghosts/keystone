// @keystone/fedi — pure-TS data layer (core, misskey, mastodon).
//
// Public domain surface for the app in `src/`: domain models, detection,
// backend interface, transport, sessions, hosting, and error codes. Wire
// types never cross into `src/` (enforced by `no-wire-in-app`); UI and
// framework imports never enter here (enforced by `no-ui-in-fedi`).
export * from "./core/errors";
export * from "./core/feedDescriptor";
export * from "./core/models";
export * from "./core/detect";
export * from "./core/backend";
export * from "./core/http";
export * from "./core/config";
export * from "./core/hosting";
export * from "./core/boot";
export * from "./core/quoteUri";
export * from "./core/sessions";
export * from "./misskey/adapt";
export * from "./misskey/auth";
export * from "./misskey/backend";
export * from "./misskey/client";
export * from "./misskey/clips";
export * from "./misskey/chat";
export * from "./misskey/customEmoji";
export {
  bareEmojiName,
  customEmojiNameFromReaction,
  customReactionCode,
  isLocalEmojiHost,
  parseEmojiCode,
  stripEmojiColons,
} from "./misskey/emoji";
export type { CustomEmoji as MisskeyCustomEmojiListing, ParsedEmojiCode } from "./misskey/emoji";
export * from "./misskey/external";
export * from "./misskey/like";
export * from "./misskey/favorites";
export * from "./misskey/featured";
export * from "./misskey/followRequests";
export * from "./misskey/importExport";
export * from "./misskey/likeEmoji";
export * from "./misskey/mutes";
export * from "./misskey/noteEdit";
export * from "./misskey/quote";
export * from "./misskey/remotepost";
export * from "./misskey/schedule";
export * from "./misskey/serverDrafts";
export * from "./misskey/softMute";
export * from "./core/graph";
export * from "./misskey/stream";
export * from "./misskey/thread";
export * from "./misskey/translate";

// Content AST: the one allow-listed inline tree for MFM + HTML
// (slice 2.4). Both parsers and the tree consumers (quote markers,
// tag pruning, folding) meet here — never raw server strings.
export * from "./core/content/ast";
export * from "./core/content/fromMfm";
export * from "./core/content/fromHtml";
// Pure `api/` ports (no DOM, no i18n): MFM fold + tag blocks, link
// previews, picker emoji data, emoji asset URLs. `FoldResult` is aliased:
// the bare name is the Mastodon tree fold's (`./mastodon/presentation`).
export {
  FOLD_BUDGET,
  lastWhitespaceAtOrBefore,
  foldMfm,
  type FoldResult as MfmFoldResult,
} from "./api/fold";
export * from "./api/tags";
export * from "./api/linkpreview";
export * from "./api/composer";
export {
  DEFAULT_LIKE_EMOJI,
  HEART_REACTION,
  MAX_FAVOURITES,
  MAX_RECENTS,
  QUICK_REACTIONS,
  COMPOSER_EMOJI,
  UNICODE_EMOJIS,
  UNICODE_EMOJI_GROUPS,
  addFavourite,
  filterCustomEmojis,
  filterUnicode,
  groupCustomByCategory,
  isHeartReaction,
  isLikeActive,
  lookupPackedEmojis,
  parseLikeEmoji,
  parseStoredList,
  removeFavourite,
  sameEmojiKey,
  shouldHideChip,
  splitNameEmojis,
  splitRemoteEmojiCodes,
  touchRecent,
  visibleReactions,
} from "./api/emoji";
export type {
  CustomEmojiGroup,
  NamePart,
  TextSegment,
  UnicodeEmojiGroup,
} from "./api/emoji";
export * from "./api/emojiAssets";
// Mastodon-family adapter: domain models + backend factory are the primary
// surface (wire types in `./mastodon/wire` stay internal — tests reach them
// via the relative path, never this barrel). `ServerFamily`/`FeatureSupport`
// from `./mastodon/instance` are aliased: the unqualified names are core's.
export {
  htmlToPlainText,
  htmlContentOf,
  visibilityOfWire,
  adaptAccount as adaptMastodonAccount,
  adaptCredentialAccount,
  adaptMedia as adaptMastodonMedia,
  adaptPoll as adaptMastodonPoll,
  adaptStatus,
  adaptRelationship,
  adaptV2Notification,
  adaptNotification as adaptMastodonNotification,
  encodeContinuation as encodeMastodonContinuation,
  decodeContinuation as decodeMastodonContinuation,
  pageOf as mastodonPageOf,
} from "./mastodon/adapt";
export {
  verifySessionAccount,
  finishOAuthExchange,
  firstPartyPasswordSignin,
  firstPartyMfa,
  injectedSignin,
} from "./mastodon/auth";
export * from "./mastodon/backend";
export {
  DEFAULT_TIMEOUT_MS as MASTODON_DEFAULT_TIMEOUT_MS,
  buildQueryString as buildMastodonQueryString,
  toFormParams as mastodonFormParams,
  parseRateLimit,
  request as mastodonRequest,
  createClient as createMastodonClient,
  isUnsupportedError as isMastodonUnsupportedError,
  isAuthError as isMastodonAuthError,
  isRateLimitError as isMastodonRateLimitError,
  isTimeoutError as isMastodonTimeoutError,
} from "./mastodon/client";
export type {
  QueryPrimitive as MastodonQueryPrimitive,
  QueryValue as MastodonQueryValue,
  MastoErrorKind,
  RateLimitInfo as MastodonRateLimitInfo,
  RequestResult as MastodonRequestResult,
  RequestOptions as MastodonRequestOptions,
  MastoClient,
} from "./mastodon/client";
export { MastoHttpError } from "./mastodon/client";
export * from "./mastodon/compose";
export * from "./mastodon/conversations";
export * from "./mastodon/endpoints";
export type {
  ServerFamily as MastodonServerFamily,
  FeatureSupport as MastodonFeatureSupport,
} from "./mastodon/instance";
export type {
  InstanceCapabilities,
  KnownFeature,
} from "./mastodon/instance";
export {
  normalizeStreamingOrigin,
  detectFamily,
  fetchNodeinfo,
  fetchInstanceCapabilities,
  reactionsSupported,
} from "./mastodon/instance";
export * from "./mastodon/oauth";
export * from "./mastodon/pagination";
export * from "./mastodon/presentation";
export * from "./mastodon/quoteMarker";
export * from "./mastodon/statusActions";
export {
  streamingSupported as mastodonStreamSupported,
  streamUrl as mastodonStreamUrl,
  createStreamHandle as createMastodonStreamHandle,
} from "./mastodon/stream";
export type {
  MastoStreamStatus,
  MastoSocket,
  WebSocketFactory as MastodonWebSocketFactory,
  StreamHandleOptions as MastodonStreamHandleOptions,
} from "./mastodon/stream";
export * from "./mastodon/thread";
// Session-bound routing facade (slice 2.5): the family router choosing
// misskey/mastodon backends from the session family/flavor, over the
// `core/sessions` store seam. `api/backend` holds the home-target helpers;
// `api/client` the router. Names already owned by `misskey/auth`
// (`signinFlow`, `mintAppToken`, app identity) and `misskey/client`
// (`isUnsupportedError`, `isPermissionError`) are reused, never redefined.
export * from "./api/backend";
export * from "./api/client";
