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
  contentFromFieldValue,
  contentFromHtml,
  contentFromMfm,
  displayNameOf,
  handleOf,
  type Account,
  type Backend,
  type Relationship,
} from '@keystone/fedi'

import {msg} from '@lingui/macro'

import {useTheme} from '#/alf/index'
import {useShellLayout} from '#/alf/breakpoints'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {Body, Caption, Heading} from '#/alf/typography'
import {formatCompactCount, formatCount, useLocale, useI18n} from '#/locale/i18n'
import {DisplayName, shouldCollapseName} from '#/components/DisplayName'
import {Pressable} from '#/components/Pressable'
import {RichText} from '#/components/RichText'
import {radius, space} from '#/alf/tokens'
import {ProfileAvatar} from '#/components/Profile/ProfileAvatar'
import {ProfileBanner} from '#/components/Profile/ProfileBanner'
import {profileDetailLayout} from '#/components/Profile/profileDetailLayout'

export function FollowStateCaption({relationship}: {relationship: Relationship | null}) {
  const i18n = useI18n()
  if (!relationship) return null
  const parts: string[] = []
  if (relationship.isFollowing) parts.push(i18n._(msg`You follow this account.`))
  if (relationship.isFollowed) parts.push(i18n._(msg`Follows you.`))
  if (relationship.hasPendingFollowRequestFromYou) parts.push(i18n._(msg`Follow request pending.`))
  if (parts.length === 0) return null
  return <Caption color="faint">{parts.join(' ')}</Caption>
}

function StatCard({
  testID,
  value,
  label,
  onPress,
  accessibilityLabel,
}: {
  testID?: string
  value: string
  label: string
  onPress?: () => void
  accessibilityLabel?: string
}) {
  const theme = useTheme()
  const cardStyle = [styles.statCard, {backgroundColor: theme.palette.bgSoft}]
  const inner = (
    <>
      <Heading style={styles.statText}>{value}</Heading>
      <Caption color="faint" style={styles.statText}>
        {label}
      </Caption>
    </>
  )
  if (!onPress) {
    return (
      <View testID={testID} style={cardStyle}>
        {inner}
      </View>
    )
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={cardStyle}>
      {inner}
    </Pressable>
  )
}

function StatsCards({
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
  const locale = useLocale()
  const i18n = useI18n()
  // Same gates as the old one-line stats: hidden counts stay hidden —
  // the posts card renders alone with the honest caption, never a
  // placeholder card. Numbers show compact; accessibility labels keep
  // the exact digits.
  const hiddenCounts =
    (account.ffVisibility === 'private' && !isSelf) ||
    (account.ffVisibility === 'followers' && !isSelf && !account.isFollowing)
  const postsExact = formatCount(locale, account.statusesCount)
  const followingExact = formatCount(locale, account.followingCount)
  const followersExact = formatCount(locale, account.followersCount)
  return (
    <>
      <View testID="profile-stats" style={styles.statsRow}>
        <StatCard
          testID="profile-stat-posts"
          value={formatCompactCount(locale, account.statusesCount)}
          label={i18n._(msg`posts`)}
        />
        {!hiddenCounts ? (
          onPressFollowing ? (
            <StatCard
              testID="profile-following-link"
              value={formatCompactCount(locale, account.followingCount)}
              label={i18n._(msg`following`)}
              onPress={onPressFollowing}
              accessibilityLabel={i18n._(msg`${followingExact} following. Open following list.`)}
            />
          ) : (
            <StatCard
              testID="profile-stat-following"
              value={formatCompactCount(locale, account.followingCount)}
              label={i18n._(msg`following`)}
            />
          )
        ) : null}
        {!hiddenCounts ? (
          onPressFollowers ? (
            <StatCard
              testID="profile-followers-link"
              value={formatCompactCount(locale, account.followersCount)}
              label={i18n._(msg`followers`)}
              onPress={onPressFollowers}
              accessibilityLabel={i18n._(msg`${followersExact} followers. Open followers list.`)}
            />
          ) : (
            <StatCard
              testID="profile-stat-followers"
              value={formatCompactCount(locale, account.followersCount)}
              label={i18n._(msg`followers`)}
            />
          )
        ) : null}
      </View>
      {account.ffVisibility === 'private' && !isSelf ? (
        <Caption color="faint">
          {i18n._(msg`${postsExact} posts · Following and followers are hidden.`)}
        </Caption>
      ) : null}
      {account.ffVisibility === 'followers' && !isSelf && !account.isFollowing ? (
        <Caption color="faint">
          {i18n._(msg`${postsExact} posts · Following and followers are visible to followers.`)}
        </Caption>
      ) : null}
    </>
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
  const i18n = useI18n()
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
  // raw markup ever renders. Field values gain live markdown links,
  // bare URLs, and mention chips (`contentFromFieldValue`); lone-handle
  // labels become mentions and lone-hashtag labels become tags, same as
  // the post parsers. Unparseable-but-nonempty values fall back
  // to plain text (shown, never dropped).
  const fieldNodes = useMemo(
    () => account.fields.map(f => contentFromFieldValue(f.value)),
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
  // Stat cards ride with the bio: under it in the bio column/cell,
  // or after the fields when there is no bio to attach to.
  const stats = (
    <StatsCards
      account={account}
      isSelf={isSelf}
      onPressFollowers={onPressFollowers}
      onPressFollowing={onPressFollowing}
    />
  )
  const statsAfterFields = !hasBio ? stats : null
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
            {account.locked ? <Caption color="faint">{i18n._(msg`Locked account.`)}</Caption> : null}
            {account.bot ? <Caption color="faint">{i18n._(msg`Automated account.`)}</Caption> : null}
            {account.movedTo ? (
              <Caption color="faint" testID="profile-moved-banner">
                {i18n._(msg`This account has moved to ${account.movedTo.acct}.`)}
              </Caption>
            ) : null}
          </View>
          {actions ? (
            <View testID="profile-identity-actions" style={styles.identityActions}>
              {actions}
            </View>
          ) : null}
        </View>
        {detail === 'split' ? (
          <View testID="profile-detail-split" style={styles.splitRow}>
            <View style={styles.splitCell}>
              {bioCard}
              {stats}
            </View>
            <View style={styles.splitCell}>{fieldsList}</View>
          </View>
        ) : detail === 'center-bio' ? (
          <View testID="profile-detail-center-bio" style={styles.centerRow}>
            <View style={styles.centerCell}>
              {bioCard}
              {stats}
            </View>
          </View>
        ) : detail === 'center-fields' ? (
          <>
            <View testID="profile-detail-center-fields" style={styles.centerRow}>
              <View style={styles.centerCell}>{fieldsList}</View>
            </View>
            {statsAfterFields}
          </>
        ) : detail === 'stack' ? (
          <View testID="profile-detail-stack" style={styles.stack}>
            {bioCard}
            {hasBio ? stats : null}
            {fieldsList}
            {statsAfterFields}
          </View>
        ) : (
          statsAfterFields
        )}
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
  // Cells stack their content (bio card, then stat cards) with the
  // same rhythm as the stacked layout.
  splitCell: {flex: 1, gap: space.sm},
  centerRow: {width: '100%', flexDirection: 'row', justifyContent: 'center'},
  centerCell: {width: '50%', gap: space.sm},
  // Stat cards: three equal cards in a row, same surface as the bio and
  // field cards, number over label, centered like the diagram.
  statsRow: {width: '100%', flexDirection: 'row', gap: space.sm},
  statCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.xs,
  },
  statText: {textAlign: 'center'},
})
