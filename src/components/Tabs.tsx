// Shared boring plain underline tablist (v1 visual language, as
// established by ProfileTabs): a row tablist with a hairline bottom
// border, each tab a 2px bottom underline when active, active label
// strong text, inactive muted text. Instant — no animation. No pills,
// no borderRadius.full, no Button.
import {ScrollView, StyleSheet, View} from 'react-native'

import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {borderWidth, space} from '#/alf/tokens'

export type TabItem<T extends string> = {key: T; label: string}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  testID,
  testIDPrefix,
  accessibilityLabel,
}: {
  tabs: TabItem<T>[]
  active: T
  onChange: (key: T) => void
  /** Container testID (the tablist). Defaults to testIDPrefix. */
  testID?: string
  /** Item testID prefix: each tab is `${testIDPrefix}-${key}`. */
  testIDPrefix: string
  accessibilityLabel?: string
}) {
  const theme = useTheme()
  // Outer bar is a plain full-width View (it stretches in its column
  // parent, so the hairline always spans the screen). The scroll view
  // lives inside: short rows look identical to the old static bar, long
  // option rows scroll on narrow phones instead of overflowing.
  return (
    <View
      testID={testID ?? testIDPrefix}
      accessibilityRole="tablist"
      aria-label={accessibilityLabel}
      style={[styles.bar, {borderBottomColor: theme.palette.edge}]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        {tabs.map(t => {
          const selected = t.key === active
          return (
            <Pressable
              key={t.key}
              testID={`${testIDPrefix}-${t.key}`}
              accessibilityRole="tab"
              accessibilityState={{selected}}
              onPress={() => onChange(t.key)}
              style={[
                styles.tab,
                // The active underline is layout only — no animation.
                selected && {borderBottomColor: theme.palette.borderStrong},
              ]}>
              <Body color={selected ? 'text' : 'muted'} style={selected && styles.activeLabel}>
                {t.label}
              </Body>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: borderWidth.hairline,
    paddingHorizontal: space.md,
  },
  row: {
    flexDirection: 'row',
    flexGrow: 1,
  },
  tab: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  activeLabel: {fontWeight: '700'},
})
