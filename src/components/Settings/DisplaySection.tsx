import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {Button} from '#/components/Button'
import {
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  appearanceStore,
  useColorMode,
  useContentMode,
  useOnlyAuthorizedQuotes,
  useTextScale,
  type AppearanceStore,
  type ColorMode,
  type ContentMode,
} from '#/state/appearance'
import {i18n} from '#/locale/i18n'

import {EmojiStyleSetting} from './EmojiStyleSetting'
import {PlaceholderRow, SettingRow} from './rows'

// Display section (v1 `/settings/display` parity): device-local
// appearance, available signed out too. Colour mode and text size read
// and write the real device prefs (the app theme consumes both at the
// root); the emoji-style picker lives here per v1 (relocated from the
// old flat page, not duplicated). Themes, palettes, user fonts, and the
// post-content override have no consumer in this app yet, so they render
// as honest placeholders — never fake rows.

const DOT_SIZE = 8

const COLOR_MODE_VALUES: ColorMode[] = ['system', 'light', 'dark']

/** Colour-mode rows, resolved at render time (module constants would
 * freeze the boot locale — the locale switches at runtime). */
function colorModeRow(value: ColorMode): {title: string; hint: string} {
  switch (value) {
    case 'system':
      return {title: i18n._(msg`System`), hint: i18n._(msg`Follow the device setting.`)}
    case 'light':
      return {title: i18n._(msg`Light`), hint: i18n._(msg`Always light.`)}
    case 'dark':
      return {title: i18n._(msg`Dark`), hint: i18n._(msg`Always dark.`)}
  }
}

function ColorModeRow({store = appearanceStore}: {store?: AppearanceStore}) {
  const selected = useColorMode(store)
  const theme = useTheme()
  return (
    <SettingRow title={i18n._(msg`Colour mode`)} hint={i18n._(msg`Light or dark app chrome.`)} testID="color-mode-row">
      <View style={[atoms.gap_sm]} accessibilityRole="radiogroup" accessibilityLabel={i18n._(msg`Colour mode`)}>
        {COLOR_MODE_VALUES.map(value => {
          const option = {value, ...colorModeRow(value)}
          const active = selected === option.value
          return (
            <Pressable
              key={option.value}
              testID={`color-mode-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{selected: active}}
              accessibilityLabel={`${option.title}${active ? ', selected' : ''}. ${option.hint}`}
              onPress={() => store.setColorMode(option.value)}
              style={[atoms.row, atoms.itemsCenter, {gap: 12, paddingVertical: 8}]}>
              <View
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  backgroundColor: active ? theme.palette.text : 'transparent',
                }}
              />
              <View style={[atoms.flex1, atoms.gap_sm]}>
                <Body>{option.title}</Body>
                <Caption color="faint">{option.hint}</Caption>
              </View>
            </Pressable>
          )
        })}
      </View>
    </SettingRow>
  )
}

function TextSizeRow({store = appearanceStore}: {store?: AppearanceStore}) {
  const scale = useTextScale(store)
  const percent = Math.round(scale * 100)
  return (
    <SettingRow
      title={i18n._(msg`Text size`)}
      hint={i18n._(msg`Prose text (posts, bios, composer) at ${percent}%. Chrome stays fixed.`)}
      testID="text-size-row">
      <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
        <Button
          label={i18n._(msg`Smaller`)}
          variant="secondary"
          disabled={scale <= TEXT_SCALE_MIN}
          disabledReason={i18n._(msg`Already at the smallest size.`)}
          onPress={() => store.setTextScale(Math.round((scale - 0.1) * 10) / 10)}
          testID="text-size-decrease"
        />
        <Body testID="text-size-value">{percent}%</Body>
        <Button
          label={i18n._(msg`Larger`)}
          variant="secondary"
          disabled={scale >= TEXT_SCALE_MAX}
          disabledReason={i18n._(msg`Already at the largest size.`)}
          onPress={() => store.setTextScale(Math.round((scale + 0.1) * 10) / 10)}
          testID="text-size-increase"
        />
        <Button
          label={i18n._(msg`Reset`)}
          variant="secondary"
          disabled={scale === 1}
          disabledReason={i18n._(msg`Already at the default size.`)}
          onPress={() => store.setTextScale(1)}
          testID="text-size-reset"
        />
      </View>
    </SettingRow>
  )
}

const CONTENT_MODE_VALUES: ContentMode[] = ['auto', 'plain']

/** Content-mode rows, resolved at render time (see `colorModeRow`). */
function contentModeRow(value: ContentMode): {title: string; hint: string} {
  switch (value) {
    case 'auto':
      return {title: i18n._(msg`Automatic`), hint: i18n._(msg`Each post renders through its own source parser.`)}
    case 'plain':
      return {title: i18n._(msg`Plain text`), hint: i18n._(msg`Posts, bios and quotes render as plain text.`)}
  }
}

function ContentModeRow({store = appearanceStore}: {store?: AppearanceStore}) {
  const selected = useContentMode(store)
  const theme = useTheme()
  return (
    <SettingRow
      title={i18n._(msg`Post content`)}
      hint={i18n._(msg`How post bodies, bios and quotes render.`)}
      testID="content-mode-row">
      <View style={[atoms.gap_sm]} accessibilityRole="radiogroup" accessibilityLabel={i18n._(msg`Post content`)}>
        {CONTENT_MODE_VALUES.map(value => {
          const option = {value, ...contentModeRow(value)}
          const active = selected === option.value
          return (
            <Pressable
              key={option.value}
              testID={`content-mode-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{selected: active}}
              accessibilityLabel={`${option.title}${active ? ', selected' : ''}. ${option.hint}`}
              onPress={() => store.setContentMode(option.value)}
              style={[atoms.row, atoms.itemsCenter, {gap: 12, paddingVertical: 8}]}>
              <View
                style={{
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  backgroundColor: active ? theme.palette.text : 'transparent',
                }}
              />
              <View style={[atoms.flex1, atoms.gap_sm]}>
                <Body>{option.title}</Body>
                <Caption color="faint">{option.hint}</Caption>
              </View>
            </Pressable>
          )
        })}
      </View>
    </SettingRow>
  )
}

/** Quote display policy (WS-A): Mastodon "authorized quotes" is a
 * filter, not the data model. OFF (default) renders every quote card;
 * ON hides unauthorized cards behind a tap-to-reveal row. Device-local,
 * like text size. */
export function QuotePolicyRow({store = appearanceStore}: {store?: AppearanceStore}) {
  const onlyAuthorized = useOnlyAuthorizedQuotes(store)
  return (
    <SettingRow
      title={i18n._(msg`Only show authorized quotes`)}
      hint={i18n._(msg`Hide quotes the author has not approved behind a tap-to-reveal row. Off shows every quote.`)}
      testID="quote-policy-row">
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{checked: onlyAuthorized}}
        accessibilityLabel={`${i18n._(msg`Only show authorized quotes`)}: ${onlyAuthorized ? i18n._(msg`on`) : i18n._(msg`off`)}`}
        onPress={() => store.setOnlyAuthorizedQuotes(!onlyAuthorized)}
        testID="quote-policy-row-toggle"
        style={[atoms.row, atoms.itemsCenter, {paddingVertical: 8}]}>
        <Body>{onlyAuthorized ? i18n._(msg`On`) : i18n._(msg`Off`)}</Body>
      </Pressable>
    </SettingRow>
  )
}

export function DisplaySection() {
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-display">
      <ColorModeRow />
      <TextSizeRow />
      <SettingRow
        title={i18n._(msg`Emoji style`)}
        hint={i18n._(msg`Art set for unicode emoji everywhere.`)}
        testID="emoji-style-row">
        <EmojiStyleSetting />
      </SettingRow>
      <ContentModeRow />
      <QuotePolicyRow />
      <PlaceholderRow
        title={i18n._(msg`Theme`)}
        hint={i18n._(msg`Keystone modern or terminal.`)}
        reason={i18n._(msg`Not wired yet — the app ships one light/dark pair.`)}
        testID="placeholder-theme"
      />
      <PlaceholderRow
        title={i18n._(msg`Palette`)}
        hint={i18n._(msg`A variation within a theme.`)}
        reason={i18n._(msg`Not wired yet — the app ships one light/dark pair.`)}
        testID="placeholder-palette"
      />
      <PlaceholderRow
        title={i18n._(msg`Font`)}
        hint={i18n._(msg`Override the theme typeface.`)}
        reason={i18n._(msg`Not wired yet — no custom-font loading on native.`)}
        testID="placeholder-font"
      />
    </View>
  )
}
