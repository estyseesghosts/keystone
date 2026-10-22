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

import {useMemo, useRef} from 'react'
import {Image, Linking, StyleSheet, View} from 'react-native'

import {msg, t} from '@lingui/macro'

import {
  displayNameOf,
  handleOf,
  safeHttpUrl,
  type Account,
  type Notification,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {RichText, defaultHashtagPress, defaultMentionPress} from '#/components/RichText'
import {postBodyNodes, postEmojis} from '#/components/Post/body'
import {formatRelativeTime} from '#/components/Post/time'
import {i18n, useLocale} from '#/locale/i18n'
import {navigationRef} from '#/navigationRef'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'

const AVATAR = 40

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12},
  avatar: {width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 1},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  main: {flex: 1, gap: 2, minWidth: 0},
  headline: {flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap'},
  name: {fontWeight: '700', flexShrink: 1},
  dismiss: {paddingHorizontal: 8, paddingVertical: 8, alignSelf: 'flex-start'},
})

export function notificationKindLabel(notification: Notification): string {
  switch (notification.kind) {
    case 'follow':
      return t`followed you`
    case 'mention':
      return t`mentioned you`
    case 'reply':
      return t`replied to you`
    case 'renote':
      return t`reposted your post`
    case 'quote':
      return t`quoted your post`
    case 'reaction':
      return notification.reaction ? t`reacted ${notification.reaction}` : t`reacted to your post`
    case 'favourite':
      return t`liked your post`
    case 'pollVote':
      return t`voted in your poll`
    case 'pollEnded':
      return t`a poll ended`
    case 'receiveFollowRequest':
      return t`requested to follow you`
    case 'followRequestAccepted':
      return t`accepted your follow request`
    case 'achievement':
      return t`earned an achievement`
    case 'app':
      return t`sent an update`
    // Misskey system rows (clickstone §1.11): the viewer's OWN account did
    // this, so the labels never name an actor.
    case 'note':
      return t`posted a new note`
    case 'scheduledNotePosted':
      return t`posted your scheduled note`
    case 'scheduledNotePostFailed':
      return t`could not post your scheduled note`
    case 'exportCompleted':
      return t`completed your export`
    case 'roleAssigned':
      return t`gave you a role`
    case 'login':
      return t`signed in to your account`
    case 'createToken':
      return t`created an access token`
    case 'test':
      return t`sent a test notification`
    case 'chatRoomInvitation':
      return t`invited you to a chat room`
    case 'unknown':
    default:
      // Unknown wires still get the raw type, never a guessed action.
      return notification.rawType || t`sent a notification`
  }
}

/** Kinds the viewer's own account caused: the wire packs no actor for
 * them, so the row renders no avatar/name — never an invented one. */
const VIEWER_EVENT_KINDS: ReadonlySet<Notification['kind']> = new Set([
  'scheduledNotePosted',
  'scheduledNotePostFailed',
  'exportCompleted',
  'roleAssigned',
  'login',
  'createToken',
  'test',
  'achievement',
])

export function isViewerEvent(notification: Notification): boolean {
  return VIEWER_EVENT_KINDS.has(notification.kind)
}

const EXPORTED_ENTITY_LABELS: Record<string, () => string> = {
  note: () => t`notes`,
  following: () => t`following`,
  muting: () => t`mutes`,
  blocking: () => t`blocks`,
  clip: () => t`clips`,
  antenna: () => t`antennas`,
  customEmoji: () => t`custom emoji`,
  favorite: () => t`favorites`,
  userList: () => t`lists`,
}

/** Secondary line the wire actually packed (role name, export target).
 * Null where the row has no honest detail — never a token dump. */
export function notificationKindDetail(notification: Notification): string | null {
  if (notification.kind === 'roleAssigned') return notification.ext.roleName ?? null
  if (notification.kind === 'exportCompleted') {
    const entity = notification.ext.exportedEntity
    if (!entity) return null
    const label = EXPORTED_ENTITY_LABELS[entity]
    return label ? label() : entity
  }
  return null
}

function openAuthorProfile(accountId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Main', {screen: 'User', params: {id: accountId}} as never)
}

function openPostDetail(postId: string) {
  if (!navigationRef.isReady()) return
  navigationRef.navigate('Note', {id: postId})
}

function openChatRoom(roomId: string) {
  if (!navigationRef.isReady()) return
  // The room screen carries the honest unavailable state when the room
  // is gone (or the server has no `chat/*`) — navigating is never a
  // dead end, and no access is assumed before the fetch.
  navigationRef.navigate('ChatRoom', {roomId} as never)
}

// Id-only actors the server listed without a packed account: a stable
// suffix label, never an invented name.
export function idOnlyActorLabel(actorId: string): string {
  return `…${actorId.slice(-6)}`
}

function NotificationAvatar({account, actorId}: {account: Account | null; actorId: string | null}) {
  const theme = useTheme()
  const uri = account ? safeHttpUrl(account.avatarUrl) : null
  const name = account ? displayNameOf(account) : actorId ? idOnlyActorLabel(actorId) : t`Someone`
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'
  if (uri === null) {
    // Explicit disc background behind the initial (same pairing as
    // `ProfileAvatar`): text never sits on an unknown surface.
    return (
      <View
        testID={actorId ? `notification-avatar-fallback-${actorId}` : 'notification-avatar-fallback'}
        accessibilityRole="image"
        accessibilityLabel={name}
        style={[styles.avatar, styles.avatarFallback, {backgroundColor: theme.palette.bgSoft}]}>
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

export function NotificationRow({
  notification,
  sessionId = null,
  onDismiss = null,
}: {
  notification: Notification
  /** Owning session (WS-C remote emoji fallback): explicit wins;
   * otherwise the active session; null = packed-only resolution. */
  sessionId?: string | null
  /** Per-row dismiss (Mastodon family, clickstone §1.11). Null = the
   * server has no dismiss endpoint (or the family has none at all), so NO
   * control renders — an unsupported action is never shown inert. */
  onDismiss?: (() => void) | null
}) {
  // Singleton `i18n` (not the hook) keeps provider-less trees — jest,
  // previews — rendering; `useLocale` below still re-renders on switch.
  const locale = useLocale()
  const activeId = useOptionalActiveSession()?.id ?? null
  const sid = sessionId ?? activeId
  const actors = notification.actors
  const first = actors[0] ?? null
  // Display prefers the first PACKED account (an id-only first actor must
  // not hide a real name behind it); navigation always targets the FIRST
  // actor (documented choice — no actor-list route exists in this scope).
  const shownAccount = actors.find(a => a.account)?.account ?? first?.account ?? null
  // Grouped rows (`notification_groups`) carry the server total in
  // `ext.groupedCount` beside the sampled actors: "N others" counts past
  // the shown name off the total (12 total → "and 11 others"), never off
  // the sample length. Flat rows and groups that report no count fall
  // back to the actor list. The max() keeps an inconsistent envelope
  // (total below the packed samples) from understating known actors.
  const serverTotal = notification.ext.groupedCount ?? 0
  const extraCount = Math.max(actors.length - 1, serverTotal > 0 ? serverTotal - 1 : 0)
  const post = notification.post ?? null
  // Tappable excerpt (E2/E3): posts carrying MFM/HTML render through the
  // sole RichText renderer so mentions land on the profile and hashtags
  // on the Tag screen; plain-only posts keep the text excerpt.
  const excerptNodes = useMemo(
    () => (post && (post.content.mfm || post.content.html) ? postBodyNodes(post) : null),
    [post],
  )
  const excerptEmojis = useMemo(() => (post ? postEmojis(post) : null), [post])
  // Inner mention/tag/link taps navigate themselves; the row press below
  // stands down when one just landed (same guard as the card body).
  const linkGuard = useRef(0)
  const stampLink = () => {
    linkGuard.current = Date.now()
  }
  const excerpt = notification.post?.content.plain
  const label = notificationKindLabel(notification)
  const detail = notificationKindDetail(notification)
  // Viewer-event rows (Misskey system types) pack no actor at all: render
  // no avatar and no name rather than an invented "Someone" profile.
  const viewerEvent = isViewerEvent(notification) && first === null
  return (
    <View testID={`notification-${notification.id}`} style={[atoms.py_sm, atoms.px_md, styles.row]}>
      {viewerEvent ? null : (
        <Pressable
          testID={`notification-actor-${notification.id}`}
          onPress={() => {
            if (first) openAuthorProfile(first.id)
          }}
          accessibilityRole="link"
          accessibilityLabel={
            shownAccount
              ? i18n._(msg`Open profile of ${displayNameOf(shownAccount)}`)
              : i18n._(msg`Open profile of the notifier`)
          }>
          <NotificationAvatar account={shownAccount} actorId={first?.id ?? null} />
        </Pressable>
      )}
      <View style={styles.main}>
        <View style={styles.headline}>
          {viewerEvent ? null : (
            <Pressable
              testID={`notification-actor-name-${notification.id}`}
              onPress={() => {
                if (first) openAuthorProfile(first.id)
              }}
              accessibilityRole="link"
              accessibilityLabel={
                shownAccount
                  ? i18n._(msg`Open profile of ${displayNameOf(shownAccount)}`)
                  : i18n._(msg`Open profile of the notifier`)
              }>
              {shownAccount ? (
                shouldCollapseName(shownAccount) ? (
                  <DisplayName
                    account={{...shownAccount, displayName: handleOf(shownAccount)}}
                    sessionId={sid}
                    size={15}
                    textStyle={styles.name}
                    testID={`notification-actor-displayname-${notification.id}`}
                  />
                ) : (
                  <>
                    <DisplayName
                      account={shownAccount}
                      sessionId={sid}
                      size={15}
                      textStyle={styles.name}
                      testID={`notification-actor-displayname-${notification.id}`}
                    />
                    <Caption color="muted" numberOfLines={1}>
                      {handleOf(shownAccount)}
                    </Caption>
                  </>
                )
              ) : (
                <Body>{first ? idOnlyActorLabel(first.id) : i18n._(msg`Someone`)}</Body>
              )}
            </Pressable>
          )}
          <Body>{label}</Body>
          {detail ? (
            <Caption color="muted" testID={`notification-detail-${notification.id}`}>
              {detail}
            </Caption>
          ) : null}
        </View>
        {extraCount > 0 ? (
          <Caption color="faint" testID={`notification-others-${notification.id}`}>
            {i18n._(msg`and ${extraCount} other${extraCount === 1 ? '' : 's'}`)}
          </Caption>
        ) : null}
        {excerptNodes !== null && excerptNodes.length > 0 ? (
          <Pressable
            testID={`notification-post-${notification.id}`}
            onPress={() => {
              if (Date.now() - linkGuard.current < 400) return
              if (notification.post) openPostDetail(notification.post.id)
            }}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open the post`)}>
            <RichText
              nodes={excerptNodes}
              emojis={excerptEmojis}
              sessionId={sid}
              authorHost={post?.author.host ?? null}
              numberOfLines={2}
              onMentionPress={(href, mentionLabel) => {
                stampLink()
                defaultMentionPress(href, mentionLabel)
              }}
              onHashtagPress={tag => {
                stampLink()
                defaultHashtagPress(tag)
              }}
              onLinkPress={href => {
                stampLink()
                void Linking.openURL(href).catch(() => {})
              }}
            />
          </Pressable>
        ) : excerpt ? (
          <Pressable
            testID={`notification-post-${notification.id}`}
            onPress={() => {
              if (notification.post) openPostDetail(notification.post.id)
            }}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open the post`)}>
            <Caption color="faint" numberOfLines={2}>
              {excerpt.slice(0, 140)}
            </Caption>
          </Pressable>
        ) : null}
        <Caption color="faint" testID={`notification-time-${notification.id}`}>
          {formatRelativeTime(notification.createdAt, undefined, locale)}
        </Caption>
        {notification.read === true ? <Caption color="faint">{i18n._(msg`Read`)}</Caption> : null}
        {notification.read === false ? <Caption color="faint">{i18n._(msg`New`)}</Caption> : null}
        {notification.kind === 'chatRoomInvitation' && notification.ext.invitedRoomId ? (
          <Pressable
            testID={`notification-room-${notification.id}`}
            onPress={() => {
              const roomId = notification.ext.invitedRoomId
              if (roomId) openChatRoom(roomId)
            }}
            accessibilityRole="link"
            accessibilityLabel={i18n._(msg`Open the chat room`)}>
            <Caption color="muted">
              {notification.ext.invitedRoomName ?? i18n._(msg`Open room`)}
            </Caption>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable
          testID={`notification-dismiss-${notification.id}`}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`Dismiss notification`)}
          style={styles.dismiss}>
          <Caption color="muted">{i18n._(msg`Dismiss`)}</Caption>
        </Pressable>
      ) : null}
    </View>
  )
}
