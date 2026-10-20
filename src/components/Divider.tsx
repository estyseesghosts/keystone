import {View} from 'react-native'

import {useTheme} from '#/alf/index'

export function Divider() {
  const theme = useTheme()
  return <View style={{height: 1, backgroundColor: theme.palette.border}} />
}
