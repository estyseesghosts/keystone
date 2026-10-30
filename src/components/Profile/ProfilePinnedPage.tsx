// Profile pinned page (P6.5 Pages, slice 7): the owner's pinned page on
// the profile. Packed `pinnedPage` renders directly; otherwise (Pinetree
// never packs) it fetches via `pages/show`. `mode='pinned'` honours
// `hideTitleWhenPinned`. Collapsible card with an "Open page" button.
// Absent id, pending, or failed fetch renders nothing — the profile
// never breaks for a missing pin.

import {useState} from 'react'
import {View} from 'react-native'
import {msg} from '@lingui/macro'

import type {Account} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {PageView} from '#/components/Page/PageView'
import {Pressable} from '#/components/Pressable'
import {ChevronIcon} from '#/components/icons'
import {i18n} from '#/locale/i18n'
import {navigationRef} from '#/navigationRef'
import {usePageQuery} from '#/state/queries/pages'

export function ProfilePinnedPage({
  account,
  sessionId,
  testID,
}: {
  account: Account
  sessionId: string | null
  testID?: string
}) {
  const [open, setOpen] = useState(true)
  const pinnedId = account.pinnedPageId
  const packed = account.pinnedPage != null && account.pinnedPage.id === pinnedId ? account.pinnedPage : null
  const fetched = usePageQuery(sessionId, packed || !pinnedId ? null : pinnedId)
  if (!pinnedId) return null
  if (!packed && (fetched.isPending || fetched.isError || !fetched.data)) {
    if (fetched.isPending) return <Loader testID={testID ? `${testID}-loading` : undefined} />
    return null
  }
  const page = packed ?? fetched.data!
  return (
    <View testID={testID} style={[atoms.gap_sm, atoms.p_md]}>
      <Pressable
        onPress={() => setOpen(v => !v)}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        accessibilityLabel={open ? i18n._(msg`Collapse pinned page`) : i18n._(msg`Expand pinned page`)}
        testID={testID ? `${testID}-toggle` : undefined}>
        <View style={[atoms.row, atoms.gap_sm]}>
          <Body>{i18n._(msg`Pinned page`)}</Body>
          <View style={atoms.flex1} />
          <ChevronIcon size={16} direction={open ? 'up' : 'down'} />
        </View>
      </Pressable>
      {open ? (
        <View style={[atoms.gap_sm]}>
          <PageView page={page} sessionId={sessionId} mode="pinned" testID={testID ? `${testID}-view` : undefined} />
          <Button
            label={i18n._(msg`Open page`)}
            variant="secondary"
            onPress={() => navigationRef.navigate('Page', {id: page.id})}
            testID={testID ? `${testID}-open` : undefined}
          />
        </View>
      ) : null}
    </View>
  )
}
