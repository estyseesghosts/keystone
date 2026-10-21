// Notification row (W4/N20/C12, F11-half): pressable actor + post excerpt.
//
// - The actor area (avatar + name) navigates to the actor's profile. Grouped
//   rows aggregate several actors: the row shows the first actor with a
//   packed account (fallback: the first actor's id-only label, never a
//   fabricated profile) plus an "and N others" line, and the press navigates
//   to the FIRST actor's profile (there is no actor-list route in scope).
// - The post excerpt navigates to the post detail.
// - Actor display names render through `DisplayName` (F11 custom emoji),
//   never plain `displayNameOf` in row text.
// - Timestamps reuse `formatRelativeTime` (the post header helper) —
//   relative, never raw ISO.
// - The avatar is intentionally local (40px row avatar): `ProfileAvatar` is
//   a fixed 72px header treatment and does not fit a row.

import {Image, StyleSheet, View} from 'react-native'

import {
  displayNameOf,
  handleOf,
  safeHttpUrl,
  type Account,
  type Notification,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {DisplayName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {formatRelativeTime} from '#/components/Post/time'
import {navigationRef} from '#/navigationRef'

const AVATAR = 40

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12},
  avatar: {width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 1},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  main: {flex: 1, gap: 2, minWidth: 0},
  headline: {flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap'},
  name: {fontWeight: '700', flexShrink: 1},
})

export function notificationKindLabel(notification: Notification): string {
  switch (notification.kind) {
    case 'follow':
      return 'followed you'
    case 'mention':
      return 'mentioned you'
    case 'reply':
      return 'replied to you'
    case 'renote':
      return 'reposted your post'
    case 'quote':
      return 'quoted your post'
    case 'reaction':
      return notification.reaction ? `reacted ${notification.reaction}` : 'reacted to your post'
    case 'favourite':
      return 'liked your post'
    case 'pollVote':
      return 'voted in your poll'
    case 'pollEnded':
      return 'a poll ended'
    case 'receiveFollowRequest':
      return 'requested to follow you'
    case 'followRequestAccepted':
      return 'accepted your follow request'
    case 'achievement':
      return 'earned an achievement'
    case 'app':
      return 'sent an update'
    case 'unknown':
    default:
      return notification.rawType || 'sent a notification'
  }
}

function openAuthorProfile(accountId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: 'User', params: {id: accountId}} as never)
}

function openPostDetail(postId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Note', {id: postId})
}

// Id-only actors the server listed without a packed account: a stable
// suffix label, never an invented name.
export function idOnlyActorLabel(actorId: string): string {
  return `…${actorId.slice(-6)}`
}

function NotificationAvatar({account, actorId}: {account: Account | null; actorId: string | null}) {
  const uri = account ? safeHttpUrl(account.avatarUrl) : null
  const name = account ? displayNameOf(account) : actorId ? idOnlyActorLabel(actorId) : 'Someone'
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'
  if (uri === null) {
    return (
      <View
        testID={actorId ? `notification-avatar-fallback-${actorId}` : 'notification-avatar-fallback'}
        accessibilityRole="image"
        accessibilityLabel={name}
        style={[styles.avatar, styles.avatarFallback]}>
        <Body>{initial}</Body>
      </View>
    )
  }
  return (
    <Image
      source={{uri}}
      style={styles.avatar}
      accessibilityRole="image"
      accessibilityLabel={name}
      testID={actorId ? `notification-avatar-${actorId}` : 'notification-avatar'}
    />
  )
}

export function NotificationRow({notification}: {notification: Notification}) {
  const actors = notification.actors
  const first = actors[0] ?? null
  // Display prefers the first PACKED account (an id-only first actor must
  // not hide a real name behind it); navigation always targets the FIRST
  // actor (documented choice — no actor-list route exists in this scope).
  const shownAccount = actors.find(a => a.account)?.account ?? first?.account ?? null
  const extraCount = Math.max(0, actors.length - 1)
  const excerpt = notification.post?.content.plain
  const label = notificationKindLabel(notification)
  return (
    <View testID={`notification-${notification.id}`} style={[atoms.py_sm, atoms.px_md, styles.row]}>
      <Pressable
        testID={`notification-actor-${notification.id}`}
        onPress={() => {
          if (first) openAuthorProfile(first.id)
        }}
        accessibilityRole="link"
        accessibilityLabel={
          shownAccount
            ? `Open profile of ${displayNameOf(shownAccount)}`
            : 'Open profile of the notifier'
        }>
        <NotificationAvatar account={shownAccount} actorId={first?.id ?? null} />
      </Pressable>
      <View style={styles.main}>
        <View style={styles.headline}>
          <Pressable
            testID={`notification-actor-name-${notification.id}`}
            onPress={() => {
              if (first) openAuthorProfile(first.id)
            }}
            accessibilityRole="link"
            accessibilityLabel={
              shownAccount
                ? `Open profile of ${displayNameOf(shownAccount)}`
                : 'Open profile of the notifier'
            }>
            {shownAccount ? (
              <>
                <DisplayName
                  account={shownAccount}
                  size={15}
                  textStyle={styles.name}
                  testID={`notification-actor-displayname-${notification.id}`}
                />
                <Caption color="muted" numberOfLines={1}>
                  {handleOf(shownAccount)}
                </Caption>
              </>
            ) : (
              <Body>{first ? idOnlyActorLabel(first.id) : 'Someone'}</Body>
            )}
          </Pressable>
          <Body>{label}</Body>
        </View>
        {extraCount > 0 ? (
          <Caption color="faint" testID={`notification-others-${notification.id}`}>
            {`and ${extraCount} other${extraCount === 1 ? '' : 's'}`}
          </Caption>
        ) : null}
        {excerpt ? (
          <Pressable
            testID={`notification-post-${notification.id}`}
            onPress={() => {
              if (notification.post) openPostDetail(notification.post.id)
            }}
            accessibilityRole="link"
            accessibilityLabel="Open the post">
            <Caption color="faint" numberOfLines={2}>
              {excerpt.slice(0, 140)}
            </Caption>
          </Pressable>
        ) : null}
        <Caption color="faint" testID={`notification-time-${notification.id}`}>
          {formatRelativeTime(notification.createdAt)}
        </Caption>
        {notification.read === true ? <Caption color="faint">Read</Caption> : null}
        {notification.read === false ? <Caption color="faint">New</Caption> : null}
      </View>
    </View>
  )
}
