// Explore shared rows (D3.7 split of `src/screens/Explore.tsx`): the
// separator, section title, account/tag rows used by the Explore tabs and
// the trending/tags search views. Pure presentation — navigation stays
// with the tab that renders the row (`onOpen` callbacks).

import {Image, StyleSheet, View} from 'react-native'

import {displayNameOf, handleOf, type Account, type TrendingTag} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

/** 1px theme-border rule between explore entries (v1 feed rule, same as
 * the post separators). */
export function RowSeparator({testID}: {testID: string}) {
  const theme = useTheme()
  return <View testID={testID} style={{height: 1, backgroundColor: theme.palette.border}} />
}

export function ExploreAvatar({account}: {account: Account}) {
  const theme = useTheme()
  const label = displayNameOf(account).slice(0, 1).toUpperCase()
  if (account.avatarUrl) {
    return (
      <Image
        source={{uri: account.avatarUrl}}
        style={styles.avatar}
        accessibilityIgnoresInvertColors
        accessibilityLabel={`${displayNameOf(account)} profile picture`}
        testID={`explore-avatar-${account.id}`}
      />
    )
  }
  return (
    <View
      style={[styles.avatar, styles.avatarFallback, {backgroundColor: theme.palette.raise}]}
      testID={`explore-avatar-${account.id}`}>
      <Body>{label}</Body>
    </View>
  )
}

export function AccountRow({account, onOpen}: {account: Account; onOpen: () => void}) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={displayNameOf(account)}
      testID={`explore-account-${account.id}`}>
      <View style={[atoms.py_sm, atoms.px_md, styles.accountRow]}>
        <ExploreAvatar account={account} />
        <View style={styles.accountText}>
          <Body>{displayNameOf(account)}</Body>
          <Caption color="faint">{handleOf(account)}</Caption>
        </View>
      </View>
    </Pressable>
  )
}

export function TagChip({tag, onOpen}: {tag: TrendingTag; onOpen: () => void}) {
  const counts =
    tag.users != null || tag.uses != null
      ? [tag.users != null ? `${tag.users} people` : null, tag.uses != null ? `${tag.uses} posts` : null]
          .filter(Boolean)
          .join(' · ')
      : null
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`#${tag.name}`}
      testID={`explore-tag-${tag.name}`}>
      <View style={[atoms.py_sm, atoms.px_md]}>
        <Body>{`#${tag.name}`}</Body>
        {counts ? <Caption color="faint">{counts}</Caption> : null}
      </View>
    </Pressable>
  )
}

export function SectionTitle({label}: {label: string}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm]}>
      <Caption color="faint">{label}</Caption>
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: {width: 44, height: 44, borderRadius: 22},
  avatarFallback: {alignItems: 'center', justifyContent: 'center'},
  accountRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  accountText: {flex: 1, minWidth: 0},
})
