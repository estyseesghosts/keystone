import type {ReactNode} from 'react'
import {useNavigation, type NavigationProp} from '@react-navigation/native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'

import {Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import type {RootParamList} from '#/routes'

// Shared chrome for every Settings section screen: the section title plus
// a Back control that navigates to the Settings index route (a real
// navigator route, so system/browser back exits the section correctly).
export function SectionShell({title, children}: {title: string; children: ReactNode}) {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const i18n = useI18n()
  return (
    <>
      <Heading>{title}</Heading>
      <Button
        label={i18n._(
          msg({message: 'Back', context: 'navigation', comment: 'Go back to the Settings index'}),
        )}
        variant="secondary"
        onPress={() => nav.navigate('Settings', {})}
        testID="settings-back"
      />
      {children}
    </>
  )
}
