/**
 * Declares `ExpoReactNativeFactoryProvider` conformance on the app delegate.
 *
 * Required by `EXExpoAppSceneDelegate` (see `UIApplicationSceneManifest` in
 * `app.config.js`): on `scene(willConnectTo:)` it casts
 * `UIApplication.shared.delegate` to the provider to fetch the
 * `RCTReactNativeFactory`, and `fatalError`s when the cast fails. The stock
 * Expo template already declares the two stored properties the protocol
 * needs (`window`, `reactNativeFactory`; `reactNativeFactoryModuleName`
 * defaults to `"main"`), so only the conformance declaration is missing.
 *
 * Applied as a prebuild mod (not a hand-edit) so `expo prebuild --clean`
 * cannot drop it. Fails loudly if the template's class declaration drifts.
 */
const {withAppDelegate} = require('@expo/config-plugins')

const ANCHOR = 'class AppDelegate: ExpoAppDelegate {'
const PATCHED =
  'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'

function withSceneLifecycle(config) {
  return withAppDelegate(config, mod => {
    const {contents, language} = mod.modResults
    if (language !== 'swift') {
      return mod
    }
    if (contents.includes(PATCHED)) {
      return mod
    }
    if (!contents.includes(ANCHOR)) {
      throw new Error(
        '[withSceneLifecycle] AppDelegate template drifted: expected `'
          + ANCHOR
          + '`. Update plugins/withSceneLifecycle.js.',
      )
    }
    mod.modResults.contents = contents.replace(ANCHOR, PATCHED)
    return mod
  })
}

module.exports = withSceneLifecycle
