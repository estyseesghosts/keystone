// Profile header (Keystone v1 pattern, our own code): banner, an
// avatar straddling the banner's bottom edge, a left-justified
// identity row (name/handle text plus the action slot on its right),
// bio and profile fields in rounded cards (split halves on desktop,
// stacked on mobile), then stats gated on ffVisibility. A Misskey-family profile background
// paints behind the header content; anything else is `palette.bg`.
// Wire types never cross here: only domain models from `@keystone/fedi`.
import {useMemo, useState, type ReactNode} from 'react'
import {Image, StyleSheet, View} from 'react-native'

import {
  contentFromHtml,
  contentFromMfm,
  displayNameOf,
  handleOf,
  type Account,
  type Backend,
  type Relationship,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {useShellLayout} from '#/alf/breakpoints'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {Body, Caption} from '#/alf/typography'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'
import {radius, space} from '#/alf/tokens'
import {ProfileAvatar} from '#/components/Profile/ProfileAvatar'
import {ProfileBanner} from '#/components/Profile/ProfileBanner'
import {profileDetailLayout} from '#/components/Profile/profileDetailLayout'

export function FollowStateCaption({relationship}: {relationship: Relationship | null}) {
  if (!relationship) return null
  const parts: string[] = []
  if (relationship.isFollowing) parts.push('You follow this account.')
  if (relationship.isFollowed) parts.push('Follows you.')
  if (relationship.hasPendingFollowRequestFromYou) parts.push('Follow request pending.')
  if (parts.length === 0) return null
  return <Caption color="faint">{parts.join(' ')}</Caption>
}

function StatsLine({
  account,
  isSelf,
  onPressFollowers,
  onPressFollowing,
}: {
  account: Account
  isSelf: boolean
  onPressFollowers?: () => void
  onPressFollowing?: () => void
}) {
  const posts = `${account.statusesCount} posts`
  if (account.ffVisibility === 'private' && !isSelf) {
    return (
      <Caption color="faint" testID="profile-stats">
        {posts} · Following and followers are hidden.
      </Caption>
    )
  }
  if (account.ffVisibility === 'followers' && !isSelf && !account.isFollowing) {
    return (
      <Caption color="faint" testID="profile-stats">
        {posts} · Following and followers are visible to followers.
      </Caption>
    )
  }
  if (!onPressFollowers && !onPressFollowing) {
    return (
      <Caption color="faint" testID="profile-stats">
        {posts} · {account.followingCount} following · {account.followersCount} followers
      </Caption>
    )
  }
  return (
    <View testID="profile-stats" style={styles.statsRow}>
      <Caption color="faint">{posts} · </Caption>
      {onPressFollowing ? (
        <Pressable
          testID="profile-following-link"
          accessibilityRole="link"
          accessibilityLabel={`${account.followingCount} following. Open following list.`}
          onPress={onPressFollowing}>
          <Caption color="faint">{`${account.followingCount} following`}</Caption>
        </Pressable>
      ) : (
        <Caption color="faint">{`${account.followingCount} following`}</Caption>
      )}
      <Caption color="faint"> · </Caption>
      {onPressFollowers ? (
        <Pressable
          testID="profile-followers-link"
          accessibilityRole="link"
          accessibilityLabel={`${account.followersCount} followers. Open followers list.`}
          onPress={onPressFollowers}>
          <Caption color="faint">{`${account.followersCount} followers`}</Caption>
        </Pressable>
      ) : (
        <Caption color="faint">{`${account.followersCount} followers`}</Caption>
      )}
    </View>
  )
}

export function ProfileHeader({
  account,
  sessionId = null,
  backend = null,
  isSelf,
  relationship,
  actions,
  onPressFollowers,
  onPressFollowing,
}: {
  account: Account
  /** Owning session (WS-C remote emoji fallback): explicit wins;
   * otherwise the active session; null = packed-only resolution. */
  sessionId?: string | null
  /** Backend for mention → account resolution in the bio/fields (avatar
   * + display name chips). Omit where none is handy: chips fall back to
   * the handle label, taps still route. */
  backend?: Backend | null
  isSelf: boolean
  relationship: Relationship | null
  /** Follow controls (others) or settings entry (self), supplied by the caller. */
  actions?: ReactNode
  /** When provided, the matching stats count renders as a link. */
  onPressFollowers?: () => void
  /** When provided, the matching stats count renders as a link. */
  onPressFollowing?: () => void
}) {
  const theme = useTheme()
  const desktop = useShellLayout() !== 'mobile'
  // A failed background image unmounts to `palette.bg`. Never a broken
  // icon, never a retry.
  const [bgFailed, setBgFailed] = useState(false)
  // WS-C: the profile screen passes its session when known; the
  // DisplayName/RichText pair falls back to the active session, so
  // remote `:name@host:` codes in names and bios resolve there too.
  const activeId = useOptionalActiveSession()?.id ?? null
  const sid = sessionId ?? activeId
  const bioNodes = useMemo(
    () =>
      account.bio.mfm
        ? contentFromMfm(account.bio.mfm)
        : account.bio.html
          ? contentFromHtml(account.bio.html)
          : null,
    [account.bio.html, account.bio.mfm],
  )
  // Profile fields (C14): Mastodon-family values arrive as HTML, Misskey
  // values as plain text — both go through the allow-listed AST so no
  // raw markup ever renders. Unparseable-but-nonempty values fall back
  // to plain text (shown, never dropped).
  const fieldNodes = useMemo(
    () => account.fields.map(f => contentFromHtml(f.value)),
    // `fields` is replaced wholesale by the adapter; the array identity
    // is the correct dep.
    [account.fields],
  )
  const hasBio = (bioNodes?.length ?? 0) > 0 || (account.bio.plain?.length ?? 0) > 0
  const hasFields = account.fields.length > 0
  const detail = profileDetailLayout({desktop, hasBio, hasFields})
  const bioCard = hasBio ? (
    <View
      testID="profile-bio-card"
      style={[styles.card, {backgroundColor: theme.palette.bgSoft}]}>
      {bioNodes?.length ? (
        <RichText
          testID="profile-bio"
          nodes={bioNodes}
          emojis={account.emojis}
          sessionId={sid}
          backend={backend}
          authorHost={account.host}
          textStyle={{color: theme.palette.text}}
        />
      ) : (
        <Body testID="profile-bio">{account.bio.plain}</Body>
      )}
    </View>
  ) : null
  const fieldsList = hasFields ? (
    <View testID="profile-fields" style={styles.fields}>
      {account.fields.map((f, i) => (
        <View
          key={`${f.name}-${i}`}
          testID={`profile-field-${i}`}
          style={[styles.card, {backgroundColor: theme.palette.bgSoft}]}>
          <Caption color="faint">
            {f.name}
            {f.verifiedAt ? ' · Verified.' : ''}
          </Caption>
          {fieldNodes[i]?.length ? (
            <RichText
              nodes={fieldNodes[i]}
              emojis={account.emojis}
              sessionId={sid}
              backend={backend}
              authorHost={account.host}
              textStyle={{color: theme.palette.text}}
            />
          ) : (
            <Body>{f.value}</Body>
          )}
        </View>
      ))}
    </View>
  ) : null
  return (
    <View testID="profile-header" style={{backgroundColor: theme.palette.bg}}>
      {account.backgroundUrl && !bgFailed ? (
        <Image
          testID="profile-background"
          source={{uri: account.backgroundUrl}}
          resizeMode="cover"
          accessibilityElementsHidden
          importantForAccessibility="no"
          onError={() => setBgFailed(true)}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <ProfileBanner uri={account.headerUrl} />
      <View style={styles.body}>
        <View style={styles.avatarRow}>
          <View style={styles.avatarOverlap}>
            <ProfileAvatar uri={account.avatarUrl} name={displayNameOf(account)} />
          </View>
        </View>
        {/* Identity row: left-justified name/handle text takes the free
            space (long names truncate via DisplayName's single line, never
            pushing the buttons); actions sit to its right in the same
            visual row. */}
        <View testID="profile-identity-row" style={styles.identityRow}>
          <View testID="profile-identity" style={styles.identityText}>
            {/* F11-half: custom-emoji names render through DisplayName.
                Name==handle collapse (v1): the handle renders AS the display
                name — one line, no second smaller handle line. */}
            {shouldCollapseName(account) ? (
              <DisplayName
                account={{...account, displayName: handleOf(account)}}
                sessionId={sid}
                size={20}
                testID="profile-name"
              />
            ) : (
              <>
                <DisplayName account={account} sessionId={sid} size={20} testID="profile-name" />
                <Caption color="faint" testID="profile-handle">
                  {handleOf(account)}
                </Caption>
              </>
            )}
            {account.locked ? <Caption color="faint">Locked account.</Caption> : null}
            {account.bot ? <Caption color="faint">Automated account.</Caption> : null}
          </View>
          {actions ? (
            <View testID="profile-identity-actions" style={styles.identityActions}>
              {actions}
            </View>
          ) : null}
        </View>
        {detail === 'split' ? (
          <View testID="profile-detail-split" style={styles.splitRow}>
            <View style={styles.splitCell}>{bioCard}</View>
            <View style={styles.splitCell}>{fieldsList}</View>
          </View>
        ) : detail === 'center-bio' ? (
          <View testID="profile-detail-center-bio" style={styles.centerRow}>
            <View style={styles.centerCell}>{bioCard}</View>
          </View>
        ) : detail === 'center-fields' ? (
          <View testID="profile-detail-center-fields" style={styles.centerRow}>
            <View style={styles.centerCell}>{fieldsList}</View>
          </View>
        ) : detail === 'stack' ? (
          <View testID="profile-detail-stack" style={styles.stack}>
            {bioCard}
            {fieldsList}
          </View>
        ) : null}
        <StatsLine
          account={account}
          isSelf={isSelf}
          onPressFollowers={onPressFollowers}
          onPressFollowing={onPressFollowing}
        />
        <FollowStateCaption relationship={relationship} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.md,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  // Half of the 96px avatar: it straddles the banner edge.
  avatarOverlap: {marginTop: -48},
  // Identity row: the text column takes the free space and truncates
  // (DisplayName is single-line); the buttons keep their size at the
  // right and are never pushed by long names/handles.
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    width: '100%',
  },
  identityText: {flex: 1, minWidth: 0, alignItems: 'flex-start'},
  identityActions: {flexShrink: 0, alignItems: 'center', justifyContent: 'center'},
  card: {
    borderRadius: radius.lg,
    padding: space.md,
  },
  fields: {gap: space.sm},
  stack: {width: '100%', gap: space.sm},
  splitRow: {width: '100%', flexDirection: 'row', gap: space.md, alignItems: 'flex-start'},
  splitCell: {flex: 1},
  centerRow: {width: '100%', flexDirection: 'row', justifyContent: 'center'},
  centerCell: {width: '50%'},
  statsRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'},
})
