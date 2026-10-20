/* Manual mock for expo-video (native module): a host view plus a stub
 * player hook. Auto-applied to every suite (root `__mocks__`). */
const React = require('react')
const {View} = require('react-native')

function useVideoPlayer(source, setup) {
  const player = React.useMemo(() => {
    const p = {loop: false, play: () => undefined, pause: () => undefined}
    if (typeof setup === 'function') {
      try {
        setup(p)
      } catch {
        // Ignore.
      }
    }
    return p
  }, [])
  return player
}

function VideoView(props) {
  return React.createElement(View, {
    testID: props.testID ?? 'expo-video',
    accessibilityLabel: props.accessibilityLabel,
    accessibilityRole: 'image',
  })
}

function createVideoPlayer() {
  return {loop: false, play: () => undefined, pause: () => undefined}
}

module.exports = {useVideoPlayer, VideoView, createVideoPlayer}
