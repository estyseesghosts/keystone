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
  hasRealDisplayName,
  type Account,
  type Relationship,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Body, Caption, Heading} from '#/alf/typography'
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

function StatsLine({account, isSelf}: {account: Account; isSelf: boolean}) {
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
  return (
    <Caption color="faint" testID="profile-stats">
      {posts} · {account.followingCount} following · {account.followersCount} followers
    </Caption>
  )
}

export function ProfileHeader({
  account,
  isSelf,
  relationship,
  actions,
}: {
  account: Account
  isSelf: boolean
  relationship: Relationship | null
  /** Follow controls (others) or settings entry (self), supplied by the caller. */
  actions?: ReactNode
}) {
  const theme = useTheme()
  const bioNodes = useMemo(
    () =>
      account.bio.mfm
        ? contentFromMfm(account.bio.mfm)
        : account.bio.html
          ? contentFromHtml(account.bio.html)
          : null,
    [account.bio.html, account.bio.mfm],
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
        <Heading testID="profile-name">{displayNameOf(account)}</Heading>
        {hasRealDisplayName(account) ? (
          <Caption color="faint" testID="profile-handle">
            {handleOf(account)}
          </Caption>
        ) : null}
        {account.locked ? <Caption color="faint">Locked account.</Caption> : null}
        {account.bot ? <Caption color="faint">Automated account.</Caption> : null}
        {bioNodes ? (
          <RichText
            testID="profile-bio"
            nodes={bioNodes}
            emojis={account.emojis}
            textStyle={{color: theme.palette.text}}
          />
        ) : account.bio.plain ? (
          <Body testID="profile-bio">{account.bio.plain}</Body>
        ) : null}
        <StatsLine account={account} isSelf={isSelf} />
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
})
