import type {ReactNode} from 'react'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import type {RootParamList} from '#/routes'

// Shared chrome for every Settings section screen: the section title plus
// a Back control that navigates to the Settings index route (a real
// navigator route, so system/browser back exits the section correctly).
export function SectionShell({title, children}: {title: string; children: ReactNode}) {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  return (
    <>
      <Heading>{title}</Heading>
      <Button
        label="Back"
        variant="secondary"
        onPress={() => nav.navigate('Settings', {})}
        testID="settings-back"
      />
      {children}
    </>
  )
}
