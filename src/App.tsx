import {Text, View} from 'react-native'

// Slice P1.1 placeholder: the app boots on all three targets and renders
// one line. No Bluesky UI is copied here; real shell lands in slice 1.5.
export default function App() {
  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
      <Text>Keystone</Text>
    </View>
  )
}
