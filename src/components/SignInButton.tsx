import {msg} from '@lingui/macro'

import {Button} from '#/components/Button'
import {i18n} from '#/locale/i18n'
import {navigationRef} from '#/navigationRef'

// Sign-in entry for signed-out empty states (Home/Network feeds, profile,
// notifications). Navigates through the root ref so it works from any nested
// navigator — and renders nothing where no navigation is mounted (bare
// presentational tests), never an inert control in production.
export function SignInButton({
  label,
  testID = 'sign-in-button',
}: {
  label?: string
  testID?: string
}) {
  if (!navigationRef.isReady()) return null
  return (
    <Button
      label={label ?? i18n._(msg`Sign in`)}
      testID={testID}
      onPress={() => navigationRef.navigate('Login')}
    />
  )
}
