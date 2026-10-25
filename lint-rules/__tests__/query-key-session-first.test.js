const {RuleTester} = require('eslint')

const rule = require('../query-key-session-first')

const tester = new RuleTester()

// Every key starts with the session id (or is built by createQueryKey).
// A literal-first array (`['post', id]`, `['signed-out', ...]`) is either
// kind-first or a hand-rolled scope — both defeat multi-account cache
// isolation. Conditionals and builder calls are left to the convention:
// they are not array literals, so neither branch can be verified here.
tester.run('query-key-session-first', rule, {
  valid: [
    {
      code: `useQuery({queryKey: [sessionId, 'post']})`,
      filename: 'src/state/queries/post.ts',
    },
    {
      code: `useInfiniteQuery({queryKey: [sessionId, 'post-feed', descriptor]})`,
      filename: 'src/state/queries/feed.ts',
    },
    {
      code: `useQuery({queryKey: feedQueryKey(sessionId, 'home')})`,
      filename: 'src/state/queries/feed.ts',
    },
    {
      // The 'signed-out' scope, via the sanctioned builder.
      code: `useQuery({queryKey: createQueryKey('signed-out', 'probe')})`,
      filename: 'src/state/queries/probe.ts',
    },
    {
      code: `useQuery({queryKey})`,
      filename: 'src/state/queries/feed.ts',
    },
    {
      code: `client.invalidateQueries({queryKey: key})`,
      filename: 'src/state/streaming.ts',
    },
    {
      code: `client.setQueryData(key, value)`,
      filename: 'src/state/cache/patch.ts',
    },
    {
      // Conditionals are not array literals: not verifiable, not flagged.
      code: `useQuery({queryKey: sessionId ? feedQueryKey(sessionId) : ['feed', 'signed-out']})`,
      filename: 'src/state/queries/feed.ts',
    },
    {
      // Fixtures use fake literal ids; the ban targets shipped code.
      code: `client.setQueryData(['sess-a', 'post'], post)`,
      filename: 'src/state/queries/feed.test.ts',
    },
    {
      code: `expect(qc.getQueryData(['sess-a', 'post'])).toBe(post)`,
      filename: 'src/state/cache/__tests__/patch.ts',
    },
  ],
  invalid: [
    {
      // Kind-first: the session id must come first.
      code: `useQuery({queryKey: ['post', postId]})`,
      filename: 'src/state/queries/post.ts',
      errors: [{messageId: 'noUnscopedKey'}],
    },
    {
      // Hand-rolled 'signed-out' scope: must go through createQueryKey.
      code: `useQuery({queryKey: ['signed-out', 'probe']})`,
      filename: 'src/state/queries/probe.ts',
      errors: [{messageId: 'noUnscopedKey'}],
    },
    {
      code: `useInfiniteQuery({queryKey: ['post-feed', sessionId]})`,
      filename: 'src/state/queries/feed.ts',
      errors: [{messageId: 'noUnscopedKey'}],
    },
    {
      code: `client.setQueryData(['sess-a', 'post'], post)`,
      filename: 'src/state/cache/patch.ts',
      errors: [{messageId: 'noUnscopedKey'}],
    },
    {
      code: `client.invalidateQueries({queryKey: ['notifications', sessionId]})`,
      filename: 'src/state/streaming.ts',
      errors: [{messageId: 'noUnscopedKey'}],
    },
  ],
})
