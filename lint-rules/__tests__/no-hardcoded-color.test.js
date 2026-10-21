const {RuleTester} = require('eslint')

const rule = require('../no-hardcoded-color')

const tester = new RuleTester()

tester.run('no-hardcoded-color', rule, {
  valid: [
    {
      code: `const s = {backgroundColor: theme.palette.bg}`,
      filename: 'src/components/Dialog.tsx',
    },
    {
      code: `const s = {backgroundColor: overlayChrome.backdrop}`,
      filename: 'src/components/Dialog.tsx',
    },
    {
      code: `const s = {backgroundColor: 'transparent'}`,
      filename: 'src/components/Menu.tsx',
    },
    {
      code: `h('Svg', {fill: 'none'})`,
      filename: 'src/components/icons.tsx',
    },
    {
      code: `export const overlayChrome = {backdrop: '#000000'}`,
      filename: 'src/alf/themes.ts',
    },
    {
      code: `export const c = {bg: '#ffffff'}`,
      filename: 'src/components/__fixtures__/colors.ts',
    },
    {
      code: `const style = {fill: 'none'}`,
      filename: 'C:\\repo\\src\\components\\icons.tsx',
    },
  ],
  invalid: [
    {
      code: `const s = {backgroundColor: '#000000'}`,
      filename: 'src/components/Dialog.tsx',
      errors: [{messageId: 'noHardcodedColor'}],
    },
    {
      code: `const FG = '#fff'`,
      filename: 'src/components/Lightbox.tsx',
      errors: [{messageId: 'noHardcodedColor'}],
    },
    {
      code: `const s = {backgroundColor: 'rgba(0,0,0,0.6)'}`,
      filename: 'src/components/Lightbox.tsx',
      errors: [{messageId: 'noHardcodedColor'}],
    },
    {
      code: `h('Icon', {color: 'black'})`,
      filename: 'src/components/icons.tsx',
      errors: [{messageId: 'noHardcodedColor'}],
    },
    {
      code: `h('Icon', {color: 'WHITE'})`,
      filename: 'src/components/Toast.tsx',
      errors: [{messageId: 'noHardcodedColor'}],
    },
    {
      code: `const s = {color: 'rgb(255, 0, 0)'}`,
      filename: 'src/screens/Home.tsx',
      errors: [{messageId: 'noHardcodedColor'}],
    },
  ],
})
