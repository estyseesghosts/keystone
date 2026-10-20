/* Manual mock for expo-image (native module): renders a host view carrying
 * the same test/alternative-text props. Auto-applied (root `__mocks__`). */
const React = require('react')
const {View} = require('react-native')

function Image(props) {
  return React.createElement(View, {
    testID: props.testID ?? 'expo-image',
    accessibilityLabel: props.accessibilityLabel ?? props.alt,
    accessibilityRole: 'image',
  })
}

function ImageBackground(props) {
  return React.createElement(View, {testID: 'expo-image-background'}, props.children)
}

module.exports = {Image, ImageBackground}
