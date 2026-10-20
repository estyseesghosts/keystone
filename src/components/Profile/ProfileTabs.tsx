// Underline tab bar for the profile (v1 pattern: Featured / Posts /
// Replies / Media as an underlined tablist, not pill buttons). The
// Featured tab only appears when the backend packed a source
// (pinnedPosts / pinnedPostIds) — it ships absent, never faked. Instant
// motion: no transitions; the active tab is a 2px underline.
import {useMemo} from 'react'
import {StyleSheet, View} from 'react-native'

import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {borderWidth, space} from '#/alf/tokens'
import type {ProfileFeedTab} from '#/state/queries'

export const PROFILE_TAB_LABELS: Record<ProfileFeedTab, string> = {
  featured: 'Featured',
  posts: 'Posts',
  replies: 'Replies',
  media: 'Media',
}

const ORDER: ProfileFeedTab[] = ['featured', 'posts', 'replies', 'media']

export function ProfileTabs({
  tab,
  onChange,
  hasFeatured,
}: {
  tab: ProfileFeedTab
  onChange: (tab: ProfileFeedTab) => void
  hasFeatured: boolean
}) {
  const theme = useTheme()
  const visible = useMemo(
    () => ORDER.filter(t => t !== 'featured' || hasFeatured || tab === 'featured'),
    [hasFeatured, tab],
  )
  return (
    <View
      testID="profile-tabs"
      accessibilityRole="tablist"
      aria-label="Profile posts"
      style={[styles.bar, {borderBottomColor: theme.palette.edge}]}>
      {visible.map(t => {
        const active = t === tab
        return (
          <Pressable
            key={t}
            testID={`profile-tab-${t}`}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            onPress={() => onChange(t)}
            style={[
              styles.tab,
              // The active underline is layout only — no animation.
              active && {borderBottomColor: theme.palette.borderStrong},
            ]}>
            <Body color={active ? 'text' : 'muted'} style={active && styles.activeLabel}>
              {PROFILE_TAB_LABELS[t]}
            </Body>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderBottomWidth: borderWidth.hairline,
    paddingHorizontal: space.md,
  },
  tab: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  activeLabel: {fontWeight: '700'},
})
