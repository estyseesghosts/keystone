const {RuleTester} = require('eslint')

const rule = require('../no-wire-in-app')

const tester = new RuleTester()

tester.run('no-wire-in-app', rule, {
  valid: [
    {
      code: `import {Post} from '@keystone/fedi'`,
      filename: 'src/components/Post.tsx',
    },
    {
      code: `import {parseDescriptor} from '@keystone/fedi'`,
      filename: 'src/state/queries/feed.ts',
    },
  ],
  invalid: [
    {
      code: `import {wireNote} from '@keystone/fedi/misskey/wire'`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noWireImport'}],
    },
    {
      code: `import {x} from '../packages/fedi/src/mastodon/wire'`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noWireImport'}],
    },
    {
      code: `const w = await import('@keystone/fedi/misskey/wire')`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noWireImport'}],
    },
  ],
})
