import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {i18n} from '#/locale/i18n'
import {
  privacyStore,
  useLinkPreviewMode,
  usePrivacyShield,
  type LinkPreviewMode,
  type PrivacyStore,
} from '#/state/privacyShield'

import {PlaceholderRow, SettingRow} from './rows'

// Privacy section (repair X2.5): the link-preview policy (D5 default
// `tap`) and the app-switcher shield (D6 default off). Device-local,
// like display prefs. Mounted by the coordinator under Settings; every
// row is real (reads/writes the real prefs) except the OS-level
// screenshot row, which is an honest placeholder — Android FLAG_SECURE
// needs a native module (out of scope).

const DOT_SIZE = 8

const PREVIEW_MODES: LinkPreviewMode[] = ['tap', 'auto-public', 'off']

/** Preview-mode rows, resolved at render time (the boot locale must not
 * freeze into module constants — the locale switches at runtime). */
function previewModeRow(value: LinkPreviewMode): {title: string; hint: string} {
  switch (value) {
    case 'tap':
      return {
        title: i18n._(msg`Tap to load`),
        hint: i18n._(msg`Never fetch automatically. Tap a card to load its preview.`),
      }
    case 'auto-public':
      return {
        title: i18n._(msg`Automatic for public posts`),
        hint: i18n._(msg`Load previews automatically on public posts only. Never for direct, followers-only, or specified posts.`),
      }
    case 'off':
      return {
        title: i18n._(msg`Off`),
        hint: i18n._(msg`Never load previews; show server cards only.`),
      }
  }
}

function LinkPreviewRow({store = privacyStore}: {store?: PrivacyStore}) {
  const selected = useLinkPreviewMode(store)
  const theme = useTheme()
  return (
    <SettingRow
      title={i18n._(msg`Link previews`)}
      hint={i18n._(msg`How link previews in posts load. Private posts never load automatically.`)}
      testID="link-preview-row">
      <View style={[atoms.gap_sm]} accessibilityRole="radiogroup" accessibilityLabel={i18n._(msg`Link previews`)}>
        {PREVIEW_MODES.map(value => {
          const option = {value, ...previewModeRow(value)}
          const active = selected === option.value
          return (
            <Pressable
              key={option.value}
              testID={`link-preview-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{selected: active}}
              accessibilityLabel={`${option.title}${active ? ', selected' : ''}. ${option.hint}`}
              onPress={() => store.setLinkPreviewMode(option.value)}
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
              </View>
            </Pressable>
          )
        })}
      </View>
    </SettingRow>
  )
}

function PrivacyShieldRow({store = privacyStore}: {store?: PrivacyStore}) {
  const shield = usePrivacyShield(store)
  return (
    <SettingRow
      title={i18n._(msg`Privacy shield`)}
      hint={i18n._(msg`Draw an opaque cover over the app when it goes to the background, so the task switcher shows nothing. Always on while a chat is open.`)}
      testID="privacy-shield-row">
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{checked: shield}}
        accessibilityLabel={`${i18n._(msg`Privacy shield`)}: ${shield ? i18n._(msg`on`) : i18n._(msg`off`)}`}
        onPress={() => store.setPrivacyShield(!shield)}
        testID="privacy-shield-row-toggle"
        style={[atoms.row, atoms.itemsCenter, {paddingVertical: 8}]}>
        <Body>{shield ? i18n._(msg`On`) : i18n._(msg`Off`)}</Body>
      </Pressable>
    </SettingRow>
  )
}

export function PrivacySection({store = privacyStore}: {store?: PrivacyStore}) {
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-privacy">
      <LinkPreviewRow store={store} />
      <PrivacyShieldRow store={store} />
      <PlaceholderRow
        title={i18n._(msg`OS screenshot blocking`)}
        hint={i18n._(msg`Block screenshots and screen recordings at the OS level.`)}
        reason={i18n._(msg`Needs a native screenshot-blocking module (not installed).`)}
        testID="placeholder-screenshot-blocking"
      />
    </View>
  )
}
