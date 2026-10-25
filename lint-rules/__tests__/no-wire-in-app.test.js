const {RuleTester} = require('eslint')

const rule = require('../no-wire-in-app')

const tester = new RuleTester()

// NOTE (D3.8): the middle-segment cases below (`wire/client`, deep file
// imports) PASS under the old `/(^|\/)wire$/` rule — they are the evasion
// the segment ban closes. If you weaken the regex back to a trailing
// match, these tests go red; that red is the proof.
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
    {
      // Substring, not a segment: must never match.
      code: `import {x} from '@keystone/wireless'`,
      filename: 'src/state/queries/feed.ts',
    },
    {
      // Suffix without a segment boundary: must never match.
      code: `import {x} from './mywire'`,
      filename: 'src/components/Post.tsx',
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
    {
      // Middle segment: submodules of a wire dir are still wire.
      code: `import {x} from '@keystone/fedi/misskey/wire/client'`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noWireImport'}],
    },
    {
      // Deep file import under a wire dir.
      code: `import {x} from '../packages/fedi/src/mastodon/wire/types'`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noWireImport'}],
    },
    {
      // Relative wire dir with a nested file.
      code: `const w = require('./wire/http')`,
      filename: 'src/state/cache/patch.ts',
      errors: [{messageId: 'noWireImport'}],
    },
    {
      // Re-exporting wire is importing wire.
      code: `export {x} from '@keystone/fedi/mastodon/wire'`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noWireImport'}],
    },
  ],
})
