/**
 * Android hardening for X1.6 (security M2/L3, privacy 3/11).
 *
 * What it does (release-relevant; debug behaviour is unchanged):
 *
 * - `android:usesCleartextTraffic="false"` plus `networkSecurityConfig` on
 *   the main application (security L3). The generated
 *   `network_security_config.xml` denies cleartext by default and
 *   allow-lists only loopback, the emulator loopback alias, and `.local`
 *   names. Debug source-sets get a permissive override so the dev bundle
 *   (Metro over LAN http) and the local rig keep working.
 * - `android:fullBackupContent` plus `android:dataExtractionRules` pointing
 *   at generated rules that exclude the MMKV directory (`files/mmkv/`, the
 *   `keystone` store). Dormant while `android.allowBackup` is false (set in
 *   `app.config.js`, security M2 / privacy 3); it only matters if backups
 *   are ever re-enabled.
 * - `tools:node="remove"` markers for `RECORD_AUDIO` and
 *   `SYSTEM_ALERT_WINDOW` in the main manifest (privacy 11). `RECORD_AUDIO`
 *   is also blocked by the `expo-image-picker` plugin config
 *   (`cameraPermission: false, microphonePermission: false` in
 *   `app.config.js`); the marker here is belt-and-suspenders so no other
 *   library can re-add it. `SYSTEM_ALERT_WINDOW` stays in the `debug`
 *   source-set (dev-client overlay) but leaves release builds.
 *
 * `android.allowBackup` itself is set in `app.config.js` (Expo core maps it
 * to the manifest); this plugin does not fight core over it.
 */
const {AndroidConfig, withAndroidManifest, withDangerousMod} = require('@expo/config-plugins')

const fs = require('fs')
const path = require('path')

const RECORD_AUDIO = 'android.permission.RECORD_AUDIO'
const SYSTEM_ALERT_WINDOW = 'android.permission.SYSTEM_ALERT_WINDOW'

// Blocked from the main (release) manifest. The `debug` source-set keeps its
// own SYSTEM_ALERT_WINDOW entry for the dev-client overlay.
const BLOCKED_IN_MAIN = [RECORD_AUDIO, SYSTEM_ALERT_WINDOW]

function networkSecurityConfigXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  X1.6 (security L3): deny cleartext by default. Only loopback, the
  Android-emulator loopback alias, and link-local \`.local\` names stay
  reachable over http (dev rigs, \`10.0.2.2\`, LAN servers). Everything
  else must use https. The fetch layer enforces the same allowlist
  (X2.2); this file is the native backstop. Debug source-sets override
  this file with a permissive config so Metro (LAN http) keeps working.
-->
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">localhost</domain>
    <domain includeSubdomains="true">127.0.0.1</domain>
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">local</domain>
  </domain-config>
</network-security-config>
`
}

function debugNetworkSecurityConfigXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  X1.6: debug-only override of the main network security config. The dev
  bundle loads over LAN http and the rig runs on localhost ports, so debug
  stays permissive (same as the pre-X1.6 behaviour where no config file
  existed and the debug manifest set \`usesCleartextTraffic="true"\`).
  Release builds never see this file.
-->
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`
}

function backupRulesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  X1.6 (security M2 / privacy 3): dormant unless \`android.allowBackup\`
  is ever re-enabled. The MMKV store (\`files/mmkv/\`, id \`keystone\`)
  holds session envelopes and the persisted query cache — none of it may
  enter a backup set.
-->
<full-backup-content>
  <exclude domain="file" path="mmkv/" />
</full-backup-content>
`
}

function dataExtractionRulesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  X1.6 (security M2 / privacy 3): API 31+ counterpart of
  backup_rules.xml, same exclusion. Dormant unless backups are
  re-enabled.
-->
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="file" path="mmkv/" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="file" path="mmkv/" />
  </device-transfer>
</data-extraction-rules>
`
}

function applyHardeningToManifest(androidManifest) {
  const manifest = AndroidConfig.Manifest.ensureToolsAvailable(androidManifest)
  const app = AndroidConfig.Manifest.getMainApplication(manifest)
  if (!app || !app.$) {
    throw new Error('[withAndroidHardening] MainApplication missing: template drifted.')
  }
  app.$['android:usesCleartextTraffic'] = 'false'
  app.$['android:networkSecurityConfig'] = '@xml/network_security_config'
  app.$['android:fullBackupContent'] = '@xml/backup_rules'
  app.$['android:dataExtractionRules'] = '@xml/data_extraction_rules'

  if (!Array.isArray(manifest.manifest['uses-permission'])) {
    manifest.manifest['uses-permission'] = []
  }
  for (const name of BLOCKED_IN_MAIN) {
    const survivors = manifest.manifest['uses-permission'].filter(
      entry => entry?.$?.['android:name'] !== name,
    )
    // Same shape as `withBlockedPermissions`: a `tools:node="remove"`
    // marker overwrites any library-contributed permission at merge time.
    // The `debug` source-set re-adds SYSTEM_ALERT_WINDOW explicitly, so
    // this only affects release.
    survivors.push({$: {'android:name': name, 'tools:node': 'remove'}})
    manifest.manifest['uses-permission'] = survivors
  }
  return manifest
}

const RES_XML_FILES = [
  ['app/src/main/res/xml/network_security_config.xml', networkSecurityConfigXml],
  ['app/src/main/res/xml/backup_rules.xml', backupRulesXml],
  ['app/src/main/res/xml/data_extraction_rules.xml', dataExtractionRulesXml],
  ['app/src/debug/res/xml/network_security_config.xml', debugNetworkSecurityConfigXml],
  ['app/src/debugOptimized/res/xml/network_security_config.xml', debugNetworkSecurityConfigXml],
]

function withAndroidHardening(config) {
  config = withAndroidManifest(config, mod => {
    mod.modResults = applyHardeningToManifest(mod.modResults)
    return mod
  })
  config = withDangerousMod(config, [
    'android',
    async mod => {
      for (const [relPath, build] of RES_XML_FILES) {
        const fullPath = path.join(mod.modRequest.platformProjectRoot, relPath)
        await fs.promises.mkdir(path.dirname(fullPath), {recursive: true})
        await fs.promises.writeFile(fullPath, build())
      }
      return mod
    },
  ])
  return config
}

module.exports = withAndroidHardening
module.exports.applyHardeningToManifest = applyHardeningToManifest
module.exports.networkSecurityConfigXml = networkSecurityConfigXml
module.exports.debugNetworkSecurityConfigXml = debugNetworkSecurityConfigXml
module.exports.backupRulesXml = backupRulesXml
module.exports.dataExtractionRulesXml = dataExtractionRulesXml
