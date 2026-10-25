// Local ESLint plugin: Keystone boundary rules. See rule files for docs.
module.exports = {
  rules: {
    'no-ui-in-fedi': require('./no-ui-in-fedi'),
    'no-wire-in-app': require('./no-wire-in-app'),
    'no-hardcoded-color': require('./no-hardcoded-color'),
    'query-key-session-first': require('./query-key-session-first'),
    'no-inner-html': require('./no-inner-html'),
    'no-literal-ui-string': require('./no-literal-ui-string'),
    'prefer-logical-style': require('./prefer-logical-style'),
    'no-any-in-tests': require('./no-any-in-tests'),
  },
}
