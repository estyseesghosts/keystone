// Profile header (Keystone v1 pattern, our own code): banner, an
// avatar row overlapping the banner with the action slot on the right
// (follow controls for others — supplied by the caller), display name,
// handle, locked/bot markers, bio through the sole RichText renderer,
// and stats gated on ffVisibility. Wire types never cross here: only
// domain models from `@keystone/fedi`.
import {useMemo, type ReactNode} from 'react'
import {StyleSheet, View} from 'react-native'

import {
  contentFromHtml,
  contentFromMfm,
  displayNameOf,
  handleOf,
  type Account,
  type Relationship,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {Body, Caption} from '#/alf/typography'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'
import {space} from '#/alf/tokens'
import {ProfileAvatar} from '#/components/Profile/ProfileAvatar'
import {ProfileBanner} from '#/components/Profile/ProfileBanner'

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
  return (
    <View testID="profile-header">
      <ProfileBanner uri={account.headerUrl} />
      <View style={styles.body}>
        <View style={styles.avatarRow}>
          <View style={styles.avatarOverlap}>
            <ProfileAvatar uri={account.avatarUrl} name={displayNameOf(account)} />
          </View>
          <View style={styles.actionSlot}>{actions}</View>
        </View>
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
        {bioNodes ? (
          <RichText
            testID="profile-bio"
            nodes={bioNodes}
            emojis={account.emojis}
            sessionId={sid}
            authorHost={account.host}
            textStyle={{color: theme.palette.text}}
          />
        ) : account.bio.plain ? (
          <Body testID="profile-bio">{account.bio.plain}</Body>
        ) : null}
        {account.fields.length > 0 ? (
          <View testID="profile-fields" style={styles.fields}>
            {account.fields.map((f, i) => (
              <View key={`${f.name}-${i}`} testID={`profile-field-${i}`}>
                <Caption color="faint">
                  {f.name}
                  {f.verifiedAt ? ' · Verified.' : ''}
                </Caption>
                {fieldNodes[i]?.length ? (
                  <RichText
                    nodes={fieldNodes[i]}
                    emojis={account.emojis}
                    sessionId={sid}
                    authorHost={account.host}
                    textStyle={{color: theme.palette.text}}
                  />
                ) : (
                  <Body>{f.value}</Body>
                )}
              </View>
            ))}
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
    paddingBottom: space.sm,
    gap: space.sm,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  avatarOverlap: {marginTop: -36},
  actionSlot: {flex: 1, alignItems: 'flex-end', justifyContent: 'center'},
  fields: {gap: space.sm},
  statsRow: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center'},
})
