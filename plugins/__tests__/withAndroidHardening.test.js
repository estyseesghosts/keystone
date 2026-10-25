// Config-level assertions for X1.6 (security M2/L3, privacy 3/11).
// Pure manifest-object fixtures — no prebuild, no device.
const hardening = require('../withAndroidHardening')

const {
  applyHardeningToManifest,
  networkSecurityConfigXml,
  debugNetworkSecurityConfigXml,
  backupRulesXml,
  dataExtractionRulesXml,
} = hardening

function fixtureManifest() {
  return {
    manifest: {
      $: {
        'xmlns:android': 'http://schemas.android.com/apk/res/android',
      },
      'uses-permission': [
        {$: {'android:name': 'android.permission.INTERNET'}},
        {$: {'android:name': 'android.permission.RECORD_AUDIO'}},
        {$: {'android:name': 'android.permission.SYSTEM_ALERT_WINDOW'}},
        {$: {'android:name': 'android.permission.VIBRATE'}},
      ],
      application: [
        {
          $: {
            'android:name': '.MainApplication',
            'android:allowBackup': 'false',
          },
        },
      ],
    },
  }
}

function mainApp(manifest) {
  return manifest.manifest.application[0].$
}

function permissionNames(manifest) {
  return manifest.manifest['uses-permission'].map(entry => entry.$)
}

describe('withAndroidHardening manifest', () => {
  it('pins cleartext off and points at the generated configs', () => {
    const out = applyHardeningToManifest(fixtureManifest())
    const app = mainApp(out)
    expect(app['android:usesCleartextTraffic']).toBe('false')
    expect(app['android:networkSecurityConfig']).toBe('@xml/network_security_config')
    expect(app['android:fullBackupContent']).toBe('@xml/backup_rules')
    expect(app['android:dataExtractionRules']).toBe('@xml/data_extraction_rules')
  })

  it('replaces RECORD_AUDIO and SYSTEM_ALERT_WINDOW with remove markers', () => {
    const out = applyHardeningToManifest(fixtureManifest())
    const names = permissionNames(out)
    expect(names).toContainEqual({
      'android:name': 'android.permission.RECORD_AUDIO',
      'tools:node': 'remove',
    })
    expect(names).toContainEqual({
      'android:name': 'android.permission.SYSTEM_ALERT_WINDOW',
      'tools:node': 'remove',
    })
    expect(names).toContainEqual({'android:name': 'android.permission.INTERNET'})
    expect(names).toContainEqual({'android:name': 'android.permission.VIBRATE'})
    // No plain (non-marker) grant survives for either blocked permission.
    for (const entry of names) {
      if (
        entry['android:name'] === 'android.permission.RECORD_AUDIO' ||
        entry['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW'
      ) {
        expect(entry['tools:node']).toBe('remove')
      }
    }
  })

  it('is idempotent (no duplicate markers on re-apply)', () => {
    const once = applyHardeningToManifest(fixtureManifest())
    const twice = applyHardeningToManifest(once)
    const names = twice.manifest['uses-permission'].map(entry => entry.$['android:name'])
    expect(names.filter(n => n === 'android.permission.RECORD_AUDIO')).toHaveLength(1)
    expect(names.filter(n => n === 'android.permission.SYSTEM_ALERT_WINDOW')).toHaveLength(1)
  })

  it('fails loudly when the MainApplication template drifts', () => {
    expect(() => applyHardeningToManifest({manifest: {$: {}}})).toThrow(
      '[withAndroidHardening]',
    )
  })
})

describe('withAndroidHardening res/xml', () => {
  it('denies cleartext by default, allow-lists only local targets', () => {
    const xml = networkSecurityConfigXml()
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false">')
    expect(xml).toContain('localhost')
    expect(xml).toContain('127.0.0.1')
    expect(xml).toContain('10.0.2.2')
  })

  it('keeps the debug override permissive (Metro over LAN http)', () => {
    expect(debugNetworkSecurityConfigXml()).toContain(
      '<base-config cleartextTrafficPermitted="true" />',
    )
  })

  it('excludes the MMKV directory from both backup rule files', () => {
    expect(backupRulesXml()).toContain('<exclude domain="file" path="mmkv/" />')
    expect(dataExtractionRulesXml()).toContain('<exclude domain="file" path="mmkv/" />')
  })
})
