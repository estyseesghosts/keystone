import {render} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'

import {
  BackIcon,
  BellIcon,
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
          <Icon size={24} color="#111111" />
        </ThemeProvider>,
      )
      expect(tree.toJSON()).toBeTruthy()
    })
  }

  it('HeartIcon fills when asked', () => {
    const tree = render(
      <ThemeProvider theme="light">
        <HeartIcon size={24} color="#111111" filled />
      </ThemeProvider>,
    )
    expect(tree.toJSON()).toBeTruthy()
  })
})
