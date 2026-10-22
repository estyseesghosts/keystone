/**
 * Pins the Apple Development Team on the app target's build configurations
 * (`CODE_SIGN_STYLE=Automatic`, `DEVELOPMENT_TEAM`, `CODE_SIGN_IDENTITY`).
 *
 * Manual edits to `ios/*.pbxproj` do not survive `expo prebuild` (it
 * regenerates the project), so the team lives here instead. The team ID is
 * not a secret; override with `APPLE_TEAM_ID` when moving to a paid team.
 */
const {withXcodeProject} = require('@expo/config-plugins')

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID ?? '67SBCKD5UK'

function withAppleTeamId(config) {
  return withXcodeProject(config, mod => {
    const section = mod.modResults.pbxXCBuildConfigurationSection()
    for (const key of Object.keys(section)) {
      const buildSettings = section[key]?.buildSettings
      if (buildSettings) {
        buildSettings.CODE_SIGN_STYLE = 'Automatic'
        buildSettings.DEVELOPMENT_TEAM = APPLE_TEAM_ID
        // NOTE: embedded quotes are required — the xcodeproj serializer
        // emits the value verbatim, and an unquoted `Apple Development`
        // corrupts project.pbxproj (spaces split the token).
        buildSettings.CODE_SIGN_IDENTITY = '"Apple Development"'
      }
    }
    return mod
  })
}

module.exports = withAppleTeamId
