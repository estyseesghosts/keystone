import {StyleSheet, View} from 'react-native'

import {EMOJI_STYLES, type EmojiStyle} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {UnicodeEmoji} from '#/components/EmojiImage'
import {Pressable} from '#/components/Pressable'
import {appearanceStore, useEmojiStyle, type AppearanceStore} from '#/state/appearance'

// Emoji art style picker (Settings → Emoji). Device-local, persisted
// through the appearance store (MMKV device scope), default OpenMoji.
//
// Only styles that render distinctly are offered: OpenMoji, Twemoji, and
// Noto resolve to version-pinned remote art; System uses the device font.
// Fluent is accepted by the stored setting but omitted here — fedi's
// resolver has no Fluent manifest yet, so it would render identically to
// System (never ship a row that changes nothing).

const PREVIEW_SEQUENCE = '👋'

const LABELS: Record<EmojiStyle, string> = {
  openmoji: 'OpenMoji',
  twemoji: 'Twemoji',
  noto: 'Noto Emoji',
  fluent: 'Fluent',
  system: 'System',
}

const HINTS: Record<EmojiStyle, string> = {
  openmoji: 'Default. Colourful open-source set.',
  twemoji: 'Classic flat set.',
  noto: 'Google’s set.',
  fluent: 'Not offered yet.',
  system: 'Your device font. No downloads.',
}

const OFFERED: EmojiStyle[] = EMOJI_STYLES.filter(s => s !== 'fluent')

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8},
  dot: {width: 8, height: 8, borderRadius: 4},
})

export function EmojiStyleSetting({store = appearanceStore}: {store?: AppearanceStore}) {
  const selected = useEmojiStyle(store)
  const theme = useTheme()
  return (
    <View style={[atoms.gap_sm]} accessibilityRole="radiogroup" accessibilityLabel="Emoji style">
      {OFFERED.map(option => {
        const active = selected === option
        return (
          <Pressable
            key={option}
            testID={`emoji-style-${option}`}
            accessibilityRole="radio"
            accessibilityState={{selected: active}}
            accessibilityLabel={`${LABELS[option]}${active ? ', selected' : ''}. ${HINTS[option]}`}
            onPress={() => store.setEmojiStyle(option)}
            style={[atoms.row, atoms.itemsCenter, styles.row]}>
            <UnicodeEmoji sequence={PREVIEW_SEQUENCE} style={option} size={22} />
            <View style={[atoms.flex1, atoms.gap_sm]}>
              <Body>
                {LABELS[option]}
                {option === 'openmoji' ? ' (default)' : ''}
              </Body>
              <Caption color="faint">{HINTS[option]}</Caption>
            </View>
            <View style={[styles.dot, {backgroundColor: active ? theme.palette.text : 'transparent'}]} />
          </Pressable>
        )
      })}
      <Caption color="faint">
        Applies to posts, reactions, and the emoji picker. System uses your device font.
      </Caption>
    </View>
  )
}
