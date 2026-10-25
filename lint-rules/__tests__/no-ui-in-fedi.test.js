const {RuleTester} = require('eslint')

const rule = require('../no-ui-in-fedi')

const tester = new RuleTester()

// NOTE (D3.8, re-plumbed after): the `globalThis` / `navigator` / `self` /
// `fetch` invalid cases below PASS under the old
// `window/document/localStorage`-only rule — they are the seams the ban
// closes. The `SEAM_ALLOWLIST` valid cases pin the one deliberate
// narrowing left (test files build the seam; the HTTP edge owns the single
// fetch default and the two stream transports construct sockets — every
// other transport threads an injected `fetchImpl`). If a new file needs one
// of these globals, add a seam — not an allowlist entry.
//
// NOTE (X0.1): `BANNED_IMPORT` is a prefix ban, not an exact-match list.
// The `react-native-mmkv` / `@react-native-async-storage` / `@expo` /
// `@tanstack` cases below PASS under the old `react-native($|/)` matcher —
// they are the ecosystem gap the prefix ban closes. Pure-TS libs (`zod`,
// `mfm-js`, `eventemitter3`) must keep passing; if a UI-adjacent package
// needs an exception, record it in `docs/DECISIONS.md` — not in the rule.
tester.run('no-ui-in-fedi', rule, {
  valid: [
    {
      code: `import {EventEmitter} from 'eventemitter3'`,
      filename: 'packages/fedi/src/misskey/stream.ts',
    },
    {
      code: `import {z} from 'zod'`,
      filename: 'packages/fedi/src/core/sessions.ts',
    },
    {
      code: `import {parse} from 'mfm-js'`,
      filename: 'packages/fedi/src/core/content/parse.ts',
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
      // The seam edge: the HTTP core owns the single lazy fetch default
      // every other transport falls back to (re-plumbed, not a new use).
      code: `const r = await fetch(url)`,
      filename: 'packages/fedi/src/core/http.ts',
    },
    {
      // Socket construction stays on the platform edge (re-plumb remainder).
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
      code: `import {useState} from 'react'`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `import {createRoot} from 'react-dom/client'`,
      filename: 'packages/fedi/src/core/sessions.ts',
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
      // `react-native-*` ecosystem packages are UI framework code.
      code: `import mmkv from 'react-native-mmkv'`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `const anim = await import('react-native-reanimated')`,
      filename: 'packages/fedi/src/misskey/adapt.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      // `@react-native/*` and `@react-native-*/*` are UI framework code.
      code: `import AsyncStorage from '@react-native-async-storage/async-storage'`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `const net = require('@react-native-community/netinfo')`,
      filename: 'packages/fedi/src/core/detect.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      // `expo-*` and `@expo/*` are UI framework code.
      code: `import {getRandomValues} from 'expo-crypto'`,
      filename: 'packages/fedi/src/core/random.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `import {Ionicons} from '@expo/vector-icons'`,
      filename: 'packages/fedi/src/misskey/adapt.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      // `@tanstack/*` is UI state-layer code.
      code: `import {useQuery} from '@tanstack/react-query'`,
      filename: 'packages/fedi/src/core/backend.ts',
      errors: [{messageId: 'noUiImport'}],
    },
    {
      code: `export * from '@tanstack/query-async-storage-persister'`,
      filename: 'packages/fedi/src/core/sessions.ts',
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
      // Re-plumbed transports default from the edge, never the global:
      // a `?? fetch` fallback is banned outside `core/http.ts`.
      code: `const fetchImpl = opts.fetchImpl ?? fetch`,
      filename: 'packages/fedi/src/api/linkpreview.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      // Same for the session store: revocation threads the seam.
      code: `const fetchImpl = opts.fetchImpl ?? fetch`,
      filename: 'packages/fedi/src/core/sessions.ts',
      errors: [{messageId: 'noBrowserGlobal'}],
    },
    {
      // Re-plumbed detectors name no global at all (`fetchImpl` param only).
      code: `const r = await fetch(url)`,
      filename: 'packages/fedi/src/core/detect.ts',
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
