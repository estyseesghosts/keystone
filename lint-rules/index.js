// Local ESLint plugin: Keystone boundary rules. See rule files for docs.
module.exports = {
  rules: {
    'no-ui-in-fedi': require('./no-ui-in-fedi'),
    'no-wire-in-app': require('./no-wire-in-app'),
  },
}
