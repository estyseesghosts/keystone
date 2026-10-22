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
 * - Misskey family on pinetree → the honest server reason (Pinetree has
 *   no chat);
 * - Misskey family on catodon → the client gap, unverified (chat is not
 *   confirmed there, so Keystone makes no promise);
 * - mastodon family on akkoma/pleroma → the honest server reason (no DM
 *   inbox Keystone can open there);
 * - everything else (misskey/sharkey past the gate, mastodon flavor,
 *   unknown, signed-out/stale caps) → the generic client-gap sentence.
 *
 * misskey/sharkey render this only when the capability is NOT supported
 * (stale caps, signed-out): where chat ships the gate is open and the
 * row is enabled. The sentence stays generic there — the gap is
 * Keystone's session state, not the server.
 */
export function messagingUnavailableReason(gate: MessagingGate = {}): string {
  if (gate.family === 'misskey') {
    if (gate.flavor === 'pinetree') {
      return t`This server has no chat.`
    }
    if (gate.flavor === 'catodon' || gate.flavor === 'unknown' || gate.flavor == null) {
      return t`Messaging is not implemented in Keystone yet for this server — chat support here is unverified, so this client has no chat screen for it. The gap is here, not on your server.`
    }
  }
  if (gate.family === 'mastodon' && (gate.flavor === 'akkoma' || gate.flavor === 'pleroma')) {
    return t`This server has no DM inbox Keystone can open.`
  }
  return t`Messaging is not implemented in Keystone yet — this client has no DM or chat screen. The gap is here, not on your server.`
}
