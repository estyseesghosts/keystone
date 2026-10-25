const {RuleTester} = require('eslint')

const rule = require('../no-ui-in-fedi')

const tester = new RuleTester()

// NOTE (D3.8): the `globalThis` / `navigator` / `self` / `fetch` invalid
// cases below PASS under the old `window/document/localStorage`-only rule
// — they are the seams the ban closes. The `SEAM_ALLOWLIST` valid cases
// pin the two deliberate narrowings (test files build the seam; the ten
// transport modules predate the ban). If a new file needs one of these
// globals, add a seam — not an allowlist entry without the re-plumb.
tester.run('no-ui-in-fedi', rule, {
  valid: [
    {
      code: `import {EventEmitter} from 'eventemitter3'`,
      filename: 'packages/fedi/src/misskey/stream.ts',
    },
    {
      code: `import {Post} from '../models'`,
      filename: 'packages/fedi/src/misskey/adapt.ts',
    },
    {
      code: `const store = new Map()`,
      filename: 'packages/fedi/src/core/sessions.ts',
    },
    {
      // Local bindings named `self` are not the browser global.
      code: `const self = await cachedSelf(); void self;`,
      filename: 'packages/fedi/src/mastodon/backend.ts',
    },
    {
      // `selfId` / `selfish` are not the `self` identifier.
      code: `const selfId = session.accountId; void selfId;`,
      filename: 'packages/fedi/src/core/sessions.ts',
    },
    {
      // Tests build the seam: fetch mocks never ship.
      code: `globalThis.fetch = jest.fn()`,
      filename: 'packages/fedi/test/misskey-client.test.ts',
    },
    {
      // Tests build the seam: WebSocket stubs never ship.
      code: `const WS = globalThis.WebSocket`,
      filename: 'packages/fedi/test/mastodon-stream.test.ts',
    },
    {
      // Grandfathered transport seam: the HTTP core calls fetch directly
      // (re-plumb follow-up, not a new use).
      code: `const r = await fetch(url)`,
      filename: 'packages/fedi/src/core/http.ts',
    },
    {
      // Injectable-seam default: tests stub `fetchImpl`, production falls
      // back to the platform global (same re-plumb follow-up).
      code: `const fetchImpl = opts.fetchImpl ?? fetch`,
      filename: 'packages/fedi/src/api/linkpreview.ts',
    },
    {
      // Injectable-seam default: revocation takes `fetchImpl` (R1.4).
      code: `const fetchImpl = opts.fetchImpl ?? fetch`,
      filename: 'packages/fedi/src/core/sessions.ts',
    },
    {
      // Grandfathered transport seam: capability detection via WebSocket.
      code: `const WS = globalThis.WebSocket`,
      filename: 'packages/fedi/src/mastodon/stream.ts',
    },
  ],
  invalid: [
    {
      code: `import React from 'react'`,
      filename: 'packages/fedi/src/core/models.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `import {View} from 'react-native'`,
      filename: 'packages/fedi/src/misskey/adapt.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `import {getStore} from '#/storage'`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `export * from 'expo-constants'`,
      filename: 'packages/fedi/src/core/config.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `const host = window.location.host`,
      filename: 'packages/fedi/src/misskey/stream.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      code: `localStorage.getItem('key')`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      code: `const lang = navigator.language`,
      filename: 'packages/fedi/src/misskey/translate.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      code: `const app = globalThis.appCache`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      code: `const w = self.location.href`,
      filename: 'packages/fedi/src/core/detect.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      code: `const r = await fetch(url)`,
      filename: 'packages/fedi/src/core/backend.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      // The allowlist is per-identifier: `navigator` is banned even in a
      // grandfathered fetch file.
      code: `const lang = navigator.language; const r = await fetch(url)`,
      filename: 'packages/fedi/src/core/http.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      // The allowlist is per-file: `globalThis` is banned outside the two
      // stream transports.
      code: `const WS = globalThis.WebSocket`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
  ],
})
