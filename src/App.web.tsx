import {Text, View} from 'react-native'

// Web root component. Mirrors App.tsx for the scaffold; web-only
// divergences land here per the platform-files pattern.
export default function App() {
  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <Text>Keystone</Text>
    </View>
  )
}
