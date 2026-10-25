const {RuleTester} = require('eslint')

const rule = require('../no-wire-in-app')

const tester = new RuleTester()

// NOTE (D3.8): the middle-segment cases below (`wire/client`, deep file
// imports) PASS under the old `/(^|\/)wire$/` rule — they are the evasion
// the segment ban closes. If you weaken the regex back to a trailing
// match, these tests go red; that red is the proof.
//
// NOTE (X0.1): the `noDeepImport` cases below PASS under the old
// wire-segment-only rule — `@keystone/fedi/mastodon/client` has no `wire`
// segment. They are the deep-import evasion the subpath ban closes. The
// barrel (`@keystone/fedi`) and non-backend subpaths (`core/models`,
// `core/content/*`) must keep passing: domain models stay importable.
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
      // Non-backend subpaths stay importable (domain models, content AST).
      code: `import {Post} from '@keystone/fedi/core/models'`,
      filename: 'src/components/Post.tsx',
    },
    {
      code: `import {parseContent} from '@keystone/fedi/core/content/ast'`,
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
    {
      // The basename ban is scoped to the package specifier: relative
      // `./client` helpers in src/ are not fedi internals.
      code: `import {x} from './client'`,
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
    {
      // Deep import into the Mastodon backend family.
      code: `import {MastoClient} from '@keystone/fedi/mastodon/client'`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      // The backend dir root is internals too, not just its files.
      code: `import {x} from '@keystone/fedi/mastodon'`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      // Deep import into the Misskey backend family.
      code: `import {x} from '@keystone/fedi/misskey/adapt'`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      code: `const c = await import('@keystone/fedi/misskey/client')`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      // `core/http` is the transport seam; app code never touches it.
      code: `import {x} from '@keystone/fedi/core/http'`,
      filename: 'src/state/session/store.ts',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      code: `const h = require('@keystone/fedi/core/http')`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      // Backend basenames are internals wherever they hang.
      code: `import {x} from '@keystone/fedi/api/client'`,
      filename: 'src/components/Post.tsx',
      errors: [{messageId: 'noDeepImport'}],
    },
    {
      code: `export {x} from '@keystone/fedi/mastodon/endpoints'`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noDeepImport'}],
    },
  ],
})
