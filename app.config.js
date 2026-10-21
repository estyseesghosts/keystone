// @ts-check

/**
 * Minimal Expo config: app identity placeholders + web target.
 * Deliberately NOT copying Bluesky's app config (no Sentry, no EAS
 * updates, no share/notification extensions, no brand assets).
 *
 * TODO(D3, owner): confirm app name, slug, scheme, ios bundleIdentifier
 * and android package before any store/TestFlight build (plan §7 D3).
 */
const pkg = require('./package.json')

/**
 * @param {import('@expo/config-types').ExpoConfig} _config
 * @returns {{ expo: import('@expo/config-types').ExpoConfig }}
 */
module.exports = function (_config) {
  const VERSION = pkg.version

  return {
    expo: {
      version: VERSION,
      name: 'Keystone',
      slug: 'keystone',
      scheme: 'keystone',
      userInterfaceStyle: 'automatic',
      ios: {
        supportsTablet: true,
        bundleIdentifier: 'app.keystone.dev',
      },
      android: {
        package: 'app.keystone.dev',
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#1f3a5f',
        },
      },
      icon: './assets/icon.png',
      web: {
        bundler: 'metro',
        favicon: './assets/favicon.png',
        splash: {
          image: './assets/splash.png',
          resizeMode: 'cover',
          backgroundColor: '#1f3a5f',
        },
      },
      plugins: [],
    },
  }
}
