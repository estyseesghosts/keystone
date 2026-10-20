import {ActivityIndicator} from 'react-native'

import {useTheme} from '#/alf/index'

export function Loader({testID}: {testID?: string}) {
  const theme = useTheme()
  return (
    <ActivityIndicator
      testID={testID}
      size="small"
      color={theme.palette.muted}
    />
  )
}
