const {RuleTester} = require('eslint')

const rule = require('../no-ui-in-fedi')

const tester = new RuleTester()

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
  ],
})
