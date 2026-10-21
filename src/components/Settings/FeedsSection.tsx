import {View} from 'react-native'

import {t} from '@lingui/macro'

import {atoms} from '#/alf/atoms'
import {Body} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'
import {feedPrefsStore, useFeedPrefs, type FeedPrefsStore} from '#/state/feedPrefs'

import {SettingRow} from './rows'

// Feeds section (v1 `/settings/feeds` parity): which optional Network
// tabs the reader wants. Social is always shown when the server supports
// it (it is the preferred default); Local hides while Social is
// available unless turned on here, and is always shown when Social is
// unavailable. Federated hides when turned off here (default on).
// The Network tab bar reads these prefs (see `state/queries/feeds`).

function FeedToggle({
  title,
  hint,
  value,
  onToggle,
  testID,
}: {
  title: string
  hint: string
  value: boolean
  onToggle: (next: boolean) => void
  testID?: string
}) {
  return (
    <SettingRow title={title} hint={hint} testID={testID}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{checked: value}}
        accessibilityLabel={`${title}: ${value ? 'on' : 'off'}`}
        onPress={() => onToggle(!value)}
        testID={testID ? `${testID}-toggle` : undefined}
        style={[atoms.row, atoms.itemsCenter, {paddingVertical: 8}]}>
        <Body>{value ? t`On` : t`Off`}</Body>
      </Pressable>
    </SettingRow>
  )
}

export function FeedsSection({store = feedPrefsStore}: {store?: FeedPrefsStore}) {
  const prefs = useFeedPrefs(store)
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-feeds">
      <FeedToggle
        title={t`Show Local tab`}
        hint={t`Show Local even while Social is available. Local always shows when Social is unavailable.`}
        value={prefs.showLocal}
        onToggle={next => store.set({showLocal: next})}
        testID="feed-show-local"
      />
      <FeedToggle
        title={t`Show Federated tab`}
        hint={t`Show the Federated timeline alongside the default tab.`}
        value={prefs.showFederated}
        onToggle={next => store.set({showFederated: next})}
        testID="feed-show-federated"
      />
    </View>
  )
}
