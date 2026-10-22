// Learn more https://docs.expo.io/guides/customizing-metro
import type {CustomResolver} from '@expo/metro/metro-resolver'
import {getDefaultConfig} from '@expo/metro-config'

// NOTE: no Sentry wrapper (we don't vendor Sentry). The gesture-handler
// web guard mirrors Bluesky's metro.config.ts. Worklets bundle mode is
// deliberately OFF (see DECISIONS.md): its babel plugin writes
// node_modules/react-native-worklets/.worklets/*.js mid-build and this
// repo's Metro setup cannot hash the generated files
// ("Failed to get the SHA-1"), so all native bundles fail. Classic inline
// worklets need no generated files.
const config = getDefaultConfig(import.meta.dirname)

if (typeof process.env.RN_SRC_EXT === 'string') {
  // inject `.e2e.ts` and `.e2e.tsx` into the sourceExts when running tests)
  config.resolver.sourceExts.unshift(...process.env.RN_SRC_EXT.split(','))
}

config.resolver.assetExts = [...config.resolver.assetExts, 'woff2']

if (config.resolver.resolveRequest) {
  throw Error('Update this override because it is conflicting now.')
}

const resolver: CustomResolver = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    /^react-native-gesture-handler(\/|$)/.test(moduleName)
  ) {
    throw new Error(
      `react-native-gesture-handler must not be imported on web (requested from ${context.originModulePath})`,
    )
  }
  return context.resolveRequest(context, moduleName, platform)
}

// @ts-expect-error readonly property
config.resolver.resolveRequest = resolver

// Re-enable Watchman: @expo/metro-config sets `resolver.useWatchman = null`,
// leaving the Node crawler, which misses files created or changed after
// Metro starts (babel-generated `.worklets/*.js` → "Failed to get the SHA-1"
// on every bundle; edited sources served stale until restart). Watchman is a
// dev-machine prerequisite (see docs; `brew install watchman`).
;(config.resolver as unknown as {useWatchman?: boolean}).useWatchman = true

config.transformer.getTransformOptions = () =>
  Promise.resolve({
    transform: {
      experimentalImportSupport: true,
      inlineRequires: true as false, // ??? typescript why?
    },
  })

export default config
