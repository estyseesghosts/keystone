// Live-connection status badge (S4 streaming UI, v1 `StreamBadge`
// parity): a slim in-flow row above the feed. Renders nothing when live
// is unavailable (unsupported server, no channel, signed out) — feeds
// keep working via paging + refresh regardless of what this shows.
//
// One live counter, never two: this badge reports CONNECTION state only
// (live/connecting/reconnecting/error). The unread-notifications count
// stays W4's cache-derived badge (`NotificationsUnreadBadge`); this badge
// never shows a number.
//
// The status arrives as a prop from the `useFeedLive` mount (which owns
// the `onStatusChange` subscription); this component holds no store
// reads, so there is nothing for the React Compiler to freeze.
import {StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import type {StreamState} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {Caption} from '#/alf/typography'
import {Button} from '#/components/Button'

export function StreamStatusBadge({
  status,
  onRetry,
}: {
  status: StreamState
  /** Manual re-dial (error state only). */
  onRetry: () => void
}) {
  const {i18n} = useLingui()
  const theme = useTheme()

  if (status === 'unavailable') return null

  const label =
    status === 'connected'
      ? i18n._(msg`Live`)
      : status === 'connecting'
        ? i18n._(msg`Connecting…`)
        : status === 'reconnecting'
          ? i18n._(msg`Reconnecting…`)
          : i18n._(msg`Live updates unavailable`)

  const dot =
    status === 'connected'
      ? theme.palette.text
      : status === 'error'
        ? theme.palette.text
        : theme.palette.faint

  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 4,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: dot,
    },
  })

  return (
    <View testID="stream-status" accessibilityLiveRegion="polite" style={styles.row}>
      <View style={styles.dot} />
      <Caption color="faint">{label}</Caption>
      {status === 'error' ? (
        <Button
          label={i18n._(msg`Retry`)}
          variant="secondary"
          onPress={onRetry}
          testID="stream-retry"
        />
      ) : null}
    </View>
  )
}
