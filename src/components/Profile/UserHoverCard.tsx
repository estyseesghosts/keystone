import {useMemo, useState} from 'react'
import {Image, Platform, StyleSheet, View} from 'react-native'

import {msg, t} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import type {Account, Backend} from '@keystone/fedi'
import {contentFromHtml, contentFromMfm, displayNameOf, safeHttpUrl} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'
import {formatCount, useLocale} from '#/locale/i18n'
import {formatFediError, isKnownErrorCode} from '#/lib/localeErrors'
import {showToast} from '#/lib/toast'
import {useGraphActions, useRelationship} from '#/state/queries/graph'
import {useFullAccount} from '#/state/queries/accounts'

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
  backend,
  onOpenProfile,
  testID,
}: {
  account: Account
  sessionId: string
  /** Session backend: bio mention chips resolve (avatar + display
   * name) and lite embedded authors upgrade to the full account
   * (banner/bio). Absent → static chips, embedded data as-is. */
  backend?: Backend | null
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
      backend={backend}
      onOpenProfile={onOpenProfile}
      testID={testID}
    />
  )
}

function UserHoverCardLoader({
  account,
  sessionId,
  backend,
  onOpenProfile,
  testID,
}: {
  account: Account
  sessionId: string
  backend?: Backend | null
  onOpenProfile?: () => void
  testID?: string
}) {
  const {i18n} = useLingui()
  const full = useFullAccount(backend ?? null, sessionId, account) ?? account
  const actions = useGraphActions(sessionId, {id: full.id, locked: full.locked})
  const relQuery = useRelationship(sessionId, full.id)
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
      account={full}
      sessionId={sessionId}
      backend={backend}
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
  sessionId = null,
  backend = null,
  followState,
  followAllowed,
  followReason,
  busy,
  onToggleFollow,
  onOpenProfile,
  testID,
}: {
  account: Account
  /** Owning session for bio RichText (WS-C emoji fallback); mention
   * chips in the bio resolve through this backend, static without it. */
  sessionId?: string | null
  backend?: Backend | null
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
  const bannerUri = safeHttpUrl(account.headerUrl)
  const bioNodes = useMemo(
    () =>
      account.bio.mfm
        ? contentFromMfm(account.bio.mfm)
        : account.bio.html
          ? contentFromHtml(account.bio.html)
          : null,
    [account.bio.html, account.bio.mfm],
  )
  const styles = StyleSheet.create({
    card: {
      backgroundColor: theme.palette.bg,
      borderColor: theme.palette.edge,
      borderWidth: 1,
      borderRadius: 12,
      overflow: 'hidden',
      width: 320,
    },
    banner: {
      width: '100%',
      height: 88,
      backgroundColor: theme.palette.bgSoft,
    },
    body: {
      paddingHorizontal: 12,
      paddingBottom: 12,
      gap: 6,
    },
    avatarRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
    avatarOverlap: {marginTop: -28},
    avatar: {width: 56, height: 56, borderRadius: 28, backgroundColor: theme.palette.bgSoft},
    followSlot: {flex: 1, alignItems: 'flex-end'},
    followButton: {
      borderWidth: 1,
      borderColor: theme.palette.edge,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    openLink: {textDecorationLine: 'underline'},
  })
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      style={styles.card}>
      {bannerUri ? (
        <Image
          source={{uri: bannerUri}}
          style={styles.banner}
          accessibilityIgnoresInvertColors
          testID={testID ? `${testID}-banner` : undefined}
        />
      ) : (
        <View style={styles.banner} testID={testID ? `${testID}-banner` : undefined} />
      )}
      <View style={styles.body}>
        <View style={styles.avatarRow}>
          <View style={styles.avatarOverlap}>
            {account.avatarUrl ? (
              <Image
                source={{uri: account.avatarUrl}}
                style={styles.avatar}
                accessibilityLabel={name}
                testID={testID ? `${testID}-avatar` : undefined}
              />
            ) : (
              <View
                style={[styles.avatar, {alignItems: 'center', justifyContent: 'center'}]}
                testID={testID ? `${testID}-avatar` : undefined}>
                <Body>{name.slice(0, 1).toUpperCase()}</Body>
              </View>
            )}
          </View>
          <View style={styles.followSlot}>
            <Pressable
              testID={testID ? `${testID}-follow` : undefined}
              disabled={!followAllowed || busy}
              accessibilityRole="button"
              accessibilityState={{disabled: !followAllowed || busy}}
              accessibilityLabel={
                !followAllowed && followReason ? `${followLabel}. ${followReason}` : followLabel
              }
              onPress={onToggleFollow}
              style={styles.followButton}>
              <Body>{busy ? '…' : followLabel}</Body>
            </Pressable>
          </View>
        </View>
        <Body numberOfLines={1}>{name}</Body>
        <Caption color="faint" numberOfLines={1}>
          @{account.acct}
          {account.locked ? i18n._(msg` · locked`) : ''}
          {account.bot ? i18n._(msg` · automated`) : ''}
        </Caption>
        {bioNodes ? (
          <RichText
            nodes={bioNodes}
            emojis={account.emojis}
            sessionId={sessionId}
            backend={backend}
            authorHost={account.host}
            testID={testID ? `${testID}-bio` : undefined}
          />
        ) : account.bio.plain ? (
          <Caption color="muted" numberOfLines={4}>
            {account.bio.plain}
          </Caption>
        ) : null}
        <Caption numberOfLines={1}>{stats}</Caption>
        {onOpenProfile ? (
          <Pressable
            testID={testID ? `${testID}-open` : undefined}
            accessibilityRole="link"
            accessibilityLabel={openLabel}
            onPress={onOpenProfile}
            style={{paddingVertical: 4, alignSelf: 'flex-start'}}>
            <Caption color="faint" style={styles.openLink}>
              {openLabel}
            </Caption>
          </Pressable>
        ) : null}
        {!followAllowed && followReason ? <Caption color="faint">{followReason}</Caption> : null}
      </View>
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
