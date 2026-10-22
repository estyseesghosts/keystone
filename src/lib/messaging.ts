// Messaging gates (clickstone §0.9, P6.2 §2.1).
//
// `direct_messages` is `supported` on the flavors where Keystone ships the
// inbox surface (mastodon + akkoma — `/api/v1/conversations`). Every row
// that would open a conversation renders disabled WITH one of these
// reasons when the gate is closed — never a silent absence, and never a
// claim that the server cannot do it where the gap is Keystone's:
// both families have DMs/chat serverside.

import {t} from '@lingui/macro'

import type {ServerFamily, ServerFlavor} from '@keystone/fedi'

// Locale boot (P5): `t` evaluates at call time against the shared
// singleton, which needs an activated locale — same guard as
// `menuModel.ts`. Importing the app locale module boots `en` first.
import '#/locale/i18n'

export interface MessagingGate {
  family?: ServerFamily | null
  /** Detected flavor, when the session reported one. Unknown/absent
   * keeps the generic client-gap sentence — an unverified server is never
   * blamed for a missing inbox. */
  flavor?: ServerFlavor | null
}

/**
 * Why a messaging row is disabled. Per-flavor by P6.2:
 * - Misskey family → the client gap (chat is slice 2.2; the server is
 *   not blamed);
 * - mastodon family on akkoma/pleroma → the honest server reason (no DM
 *   inbox Keystone can open there);
 * - everything else (mastodon flavor, unknown, signed-out/stale caps) →
 *   the generic client-gap sentence.
 */
export function messagingUnavailableReason(gate: MessagingGate = {}): string {
  if (gate.family === 'misskey') {
    return t`Messaging is not implemented in Keystone yet — Misskey chat ships in a later slice, so this client has no chat screen. The gap is here, not on your server.`
  }
  if (gate.family === 'mastodon' && (gate.flavor === 'akkoma' || gate.flavor === 'pleroma')) {
    return t`This server has no DM inbox Keystone can open.`
  }
  return t`Messaging is not implemented in Keystone yet — this client has no DM or chat screen. The gap is here, not on your server.`
}
