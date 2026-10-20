// Learn more https://docs.expo.io/guides/customizing-metro
import {getBundleModeMetroConfig} from 'react-native-worklets/bundleMode/index.js'
import type {CustomResolver} from '@expo/metro/metro-resolver'
import {getDefaultConfig} from '@expo/metro-config'

// NOTE: no Sentry wrapper (we don't vendor Sentry). Worklets bundle mode
// and the gesture-handler web guard mirror Bluesky's metro.config.ts.
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

config.transformer.getTransformOptions = () =>
  Promise.resolve({
    transform: {
      experimentalImportSupport: true,
      inlineRequires: true as false, // ??? typescript why?
    },
  })

export default getBundleModeMetroConfig(config)
