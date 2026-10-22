import {render} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {themes} from '#/alf/themes'

import {
  BackIcon,
  BellIcon,
  ChannelIcon,
  CheckIcon,
  CloseIcon,
  HeartIcon,
  HomeIcon,
  LoginIcon,
  MoreIcon,
  NetworkIcon,
  PencilIcon,
  ProfileIcon,
  ReplyIcon,
  RepostIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
} from '../icons'

const icons = {
  BackIcon,
  BellIcon,
  ChannelIcon,
  CheckIcon,
  CloseIcon,
  HeartIcon,
  HomeIcon,
  LoginIcon,
  MoreIcon,
  NetworkIcon,
  PencilIcon,
  ProfileIcon,
  ReplyIcon,
  RepostIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
}

describe('icons', () => {
  for (const [name, Icon] of Object.entries(icons)) {
    it(`${name} renders an svg`, () => {
      const tree = render(
        <ThemeProvider theme="light">
          <Icon size={24} color={themes.light.palette.text} />
        </ThemeProvider>,
      )
      expect(tree.toJSON()).toBeTruthy()
    })
  }

  it('HeartIcon fills when asked', () => {
    const tree = render(
      <ThemeProvider theme="light">
        <HeartIcon size={24} color={themes.light.palette.text} filled />
      </ThemeProvider>,
    )
    expect(tree.toJSON()).toBeTruthy()
  })

  it('defaults to the theme text color (readable in both themes)', () => {
    for (const [theme, fg] of [
      ['light', themes.light.palette.text],
      ['dark', themes.dark.palette.text],
    ] as const) {
      const tree = render(
        <ThemeProvider theme={theme}>
          <HomeIcon size={24} />
        </ThemeProvider>,
      )
      expect(JSON.stringify(tree.toJSON())).toContain(fg)
      tree.unmount()
    }
  })

  it('MoreIcon and filled HeartIcon default to the theme text too', () => {
    const tree = render(
      <ThemeProvider theme="dark">
        <MoreIcon size={24} />
        <HeartIcon size={24} filled />
      </ThemeProvider>,
    )
    const hits = JSON.stringify(tree.toJSON()).split(themes.dark.palette.text).length - 1
    expect(hits).toBeGreaterThanOrEqual(2)
    tree.unmount()
  })
})
