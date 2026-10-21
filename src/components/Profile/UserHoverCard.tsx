import {useState} from 'react'
import {Image, Platform, StyleSheet, View} from 'react-native'

import {msg, t} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import type {Account} from '@keystone/fedi'
import {displayNameOf} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {formatCount, useLocale} from '#/locale/i18n'
import {formatFediError, isKnownErrorCode} from '#/lib/localeErrors'
import {showToast} from '#/lib/toast'
import {useGraphActions, useRelationship} from '#/state/queries/graph'

// Desktop-only profile hover preview (P7, v1 `hover` dict parity).
// Web-only by design: returns null on native, where hover does not exist.
//
// NOT mounted anywhere yet: mount points live in coordinator-owned files
// (see the mount-point list in this file's docs below). The trigger owns
// hover timing (`onHoverIn`/`onHoverOut`); this component is the card
// itself: avatar + name + handle + stats + bio + follow action.
//
// Follow is capability-gated like every action: refused gates render the
// button disabled with the gate reason, never inert. Failures toast the
// localized `FediError` code via `formatFediError`.

export type HoverFollowState = 'follow' | 'following' | 'requested'

export function UserHoverCard({
  account,
  sessionId,
  onOpenProfile,
  testID,
}: {
  account: Account
  sessionId: string
  onOpenProfile?: () => void
  testID?: string
}) {
  // Native has no hover: the card never renders there, so native trees
  // never pay for the relationship query either (hooks below are
  // web-only in practice — see `UserHoverCardView` for the pure UI).
  if (Platform.OS !== 'web') return null
  return (
    <UserHoverCardLoader
      account={account}
      sessionId={sessionId}
      onOpenProfile={onOpenProfile}
      testID={testID}
    />
  )
}

function UserHoverCardLoader({
  account,
  sessionId,
  onOpenProfile,
  testID,
}: {
  account: Account
  sessionId: string
  onOpenProfile?: () => void
  testID?: string
}) {
  const {i18n} = useLingui()
  const actions = useGraphActions(sessionId, {id: account.id, locked: account.locked})
  const relQuery = useRelationship(sessionId, account.id)
  const [busy, setBusy] = useState(false)
  const rel = relQuery.data ?? null
  const state: HoverFollowState = rel?.hasPendingFollowRequestFromYou
    ? 'requested'
    : rel?.isFollowing
      ? 'following'
      : 'follow'
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try {
      await actions.follow.set(state === 'follow' ? 'following' : 'none')
    } catch (e) {
      const err = e as {code?: unknown; params?: Record<string, unknown>; message?: unknown}
      showToast(
        typeof err.code === 'string' && isKnownErrorCode(err.code)
          ? formatFediError(i18n, {code: err.code, params: err.params})
          : typeof err.message === 'string' && err.message
            ? err.message
            : i18n._(msg`Action failed.`),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <UserHoverCardView
      account={account}
      followState={state}
      followAllowed={actions.follow.gate.enabled}
      followReason={actions.follow.gate.enabled ? undefined : actions.follow.gate.reason}
      busy={busy}
      onToggleFollow={() => void toggle()}
      onOpenProfile={onOpenProfile}
      testID={testID}
    />
  )
}

export function UserHoverCardView({
  account,
  followState,
  followAllowed,
  followReason,
  busy,
  onToggleFollow,
  onOpenProfile,
  testID,
}: {
  account: Account
  followState: HoverFollowState
  followAllowed: boolean
  followReason?: string
  busy?: boolean
  onToggleFollow: () => void
  onOpenProfile?: () => void
  testID?: string
}) {
  const theme = useTheme()
  const locale = useLocale()
  const {i18n} = useLingui()
  const name = displayNameOf(account)
  // `t` translates against the shared singleton (the same instance the
  // root `I18nProvider` binds); this component already re-renders on
  // locale switches via `useLocale` below.
  const label = t`Profile preview for ${name}`
  const followLabel =
    followState === 'following'
      ? i18n._(msg`Unfollow`)
      : followState === 'requested'
        ? i18n._(msg`Requested`)
        : i18n._(msg`Follow`)
  const openLabel = i18n._(msg`Open profile`)
  const notes = formatCount(locale, account.statusesCount)
  const following = formatCount(locale, account.followingCount)
  const followers = formatCount(locale, account.followersCount)
  // Placeholder names come from the variable names, so the source string
  // stays `{notes} notes · …` — the same id the catalogs were seeded with.
  const stats = t`${notes} notes · ${following} following · ${followers} followers`
  const styles = StyleSheet.create({
    card: {
      backgroundColor: theme.palette.bg,
      borderColor: theme.palette.edge,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      gap: 8,
      width: 300,
    },
    row: {flexDirection: 'row', alignItems: 'center', gap: 10},
    avatar: {width: 48, height: 48, borderRadius: 24, backgroundColor: theme.palette.bgSoft},
  })
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={styles.card}>
      <View style={styles.row}>
        {account.avatarUrl ? (
          <Image
            source={{uri: account.avatarUrl}}
            style={styles.avatar}
            accessibilityLabel={name}
            testID={testID ? `${testID}-avatar` : undefined}
          />
        ) : null}
        <View style={{flex: 1, minWidth: 0}}>
          <Body numberOfLines={1}>{name}</Body>
          <Caption color="faint" numberOfLines={1}>
            @{account.acct}
            {account.locked ? i18n._(msg` · locked`) : ''}
            {account.bot ? i18n._(msg` · automated`) : ''}
          </Caption>
        </View>
        <Pressable
          testID={testID ? `${testID}-follow` : undefined}
          disabled={!followAllowed || busy}
          accessibilityRole="button"
          accessibilityState={{disabled: !followAllowed || busy}}
          accessibilityLabel={
            !followAllowed && followReason ? `${followLabel}. ${followReason}` : followLabel
          }
          onPress={onToggleFollow}
          style={{paddingHorizontal: 12, paddingVertical: 8}}>
          <Body>{busy ? '…' : followLabel}</Body>
        </Pressable>
      </View>
      <Caption numberOfLines={3}>{stats}</Caption>
      {account.bio.plain ? (
        <Caption color="muted" numberOfLines={4}>
          {account.bio.plain}
        </Caption>
      ) : null}
      {onOpenProfile ? (
        <Pressable
          testID={testID ? `${testID}-open` : undefined}
          accessibilityRole="link"
          accessibilityLabel={openLabel}
          onPress={onOpenProfile}
          style={{paddingVertical: 4}}>
          <Caption color="faint">{openLabel}</Caption>
        </Pressable>
      ) : null}
      {!followAllowed && followReason ? <Caption color="faint">{followReason}</Caption> : null}
    </View>
  )
}

// --- Suggested mount points (coordinator-owned — NOT mounted here) ---
//
// 1. `src/components/Post/PostCard.tsx:136-142` (`avatar-press-…`): wrap
//    the avatar `Pressable`'s web hover (`onHoverIn` opens after ~400ms,
//    `onHoverOut` closes) in an `AnchoredPopup`-style web layer keyed by
//    `post.author.id` + active `sessionId`.
// 2. `src/components/Post/PostCard.tsx:399-414` (author name press): same
//    hover treatment as the avatar for the display-name press.
// 3. `src/components/Notification/NotificationRow.tsx` (actor avatar):
//    same treatment keyed by the actor's account id + session.
// 4. `src/screens/User.tsx` (profile header): NOT a mount — the full
//    page already shows this information; hover cards are for embeds.
