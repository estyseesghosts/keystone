// Messaging gate (clickstone §0.9 — "Messaging is gated, not invisible").
//
// `direct_messages` is `unsupported` on every flavor until Wave 2 ships a
// messaging surface (slice 2.1 Mastodon conversations, slice 2.2 Misskey
// chat). Every row that would open a conversation renders disabled WITH
// this reason — never a silent absence, and never a claim that the server
// cannot do it: both families have DMs/chat serverside. When a surface
// lands, flip the flag for that flavor and replace the row's gate; the
// reason below goes away with it.

import {t} from '@lingui/macro'

// Locale boot (P5): `t` evaluates at call time against the shared
// singleton, which needs an activated locale — same guard as
// `menuModel.ts`. Importing the app locale module boots `en` first.
import '#/locale/i18n'

/**
 * Why a messaging row is disabled today. Deliberately a client-gap
 * sentence: this is Keystone's missing surface, not a server limitation.
 */
export function messagingUnavailableReason(): string {
  return t`Messaging is not implemented in Keystone yet — this client has no DM or chat screen. The gap is here, not on your server.`
}
