import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'
import {Platform, StyleSheet} from 'react-native'

import {ThemeProvider} from '#/alf/index'
import {Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {Divider} from '#/components/Divider'
import {Link} from '#/components/Link'
import {Loader} from '#/components/Loader'
import {Menu} from '#/components/Menu'
import {Pressable} from '#/components/Pressable'
import {Toast} from '#/components/Toast'
import {TextField} from '#/components/forms/TextField'

i18n.load('en', {})
i18n.activate('en')

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('Button', () => {
  it('fires onPress when enabled', () => {
    const onPress = jest.fn()
    renderWithProviders(<Button label="Save" onPress={onPress} />)
    fireEvent.press(screen.getByText('Save'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('disabled buttons carry their reason', () => {
    renderWithProviders(
      <Button
        label="Repost"
        onPress={() => {}}
        disabled
        disabledReason="Not supported here"
      />,
    )
    expect(screen.getByLabelText('Repost. Not supported here')).toBeTruthy()
  })
})

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button label="Open" onPress={() => setOpen(true)} />
        <Dialog
          testID="d"
          open={open}
          onClose={() => setOpen(false)}
          title="Title">
          <Button label="Inside" onPress={() => {}} />
        </Dialog>
      </>
    )
  }

  it('is hidden when closed, opens, and closes via backdrop and ✕', () => {
    renderWithProviders(<Harness />)
    expect(screen.queryByTestId('d')).toBeNull()
    fireEvent.press(screen.getByText('Open'))
    expect(screen.getByText('Title')).toBeTruthy()
    fireEvent.press(screen.getByTestId('d-backdrop'))
    expect(screen.queryByTestId('d')).toBeNull()
    fireEvent.press(screen.getByText('Open'))
    fireEvent.press(screen.getByTestId('d-close'))
    expect(screen.queryByTestId('d')).toBeNull()
  })
})

describe('Menu', () => {
  it('selects an item and closes; disabled items show reasons', () => {
    const onA = jest.fn()
    renderWithProviders(
      <Menu
        testID="m"
        label="Options"
        items={[
          {key: 'a', label: 'Copy link', onSelect: onA},
          {
            key: 'b',
            label: 'Schedule',
            onSelect: () => {},
            disabled: true,
            reason: 'Not supported here',
          },
        ]}
      />,
    )
    fireEvent.press(screen.getByText('Options'))
    expect(screen.getByText('Not supported here')).toBeTruthy()
    fireEvent.press(screen.getByTestId('m-item-a'))
    expect(onA).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('m-item-a')).toBeNull()
  })
})

describe('forms + misc', () => {
  it('TextField changes text and shows errors', () => {
    const onChangeText = jest.fn()
    renderWithProviders(
      <TextField
        testID="f"
        label="Server"
        value=""
        onChangeText={onChangeText}
        error="Required"
      />,
    )
    fireEvent.changeText(screen.getByTestId('f'), 'mastodon.social')
    expect(onChangeText).toHaveBeenCalledWith('mastodon.social')
    expect(screen.getByText('Required')).toBeTruthy()
  })

  it('renders Link, Loader, Divider, Toast', () => {
    const onPress = jest.fn()
    renderWithProviders(
      <>
        <Link label="Learn more" onPress={onPress} />
        <Loader testID="loader" />
        <Divider />
        <Toast message="Saved" />
      </>,
    )
    fireEvent.press(screen.getByText('Learn more'))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('loader')).toBeTruthy()
    expect(screen.getByText('Saved')).toBeTruthy()
  })
})

describe('Heading semantics (X10.1, a11y 8)', () => {
  it('sets the header role with an optional web level', () => {
    renderWithProviders(<Heading level={2}>Section</Heading>)
    const el = screen.getByText('Section')
    expect(el.props.accessibilityRole).toBe('header')
    expect(screen.getByRole('header')).toBeTruthy()
  })
})

describe('Pressable hover + focus (X10.1, a11y 11)', () => {
  const realOS = Platform.OS

  function setOS(os: string) {
    Object.defineProperty(Platform, 'OS', {value: os, configurable: true})
  }

  afterEach(() => {
    setOS(realOS)
  })

  function ringOf(testID: string): {outlineWidth?: number} {
    const el = screen.getByTestId(testID)
    const flat = StyleSheet.flatten(el.props.style) as {outlineWidth?: number}
    return flat ?? {}
  }

  it('draws the alf focus ring on web focus only, and dims on hover', () => {
    setOS('web')
    const {unmount} = renderWithProviders(
      <Pressable testID="p" onPress={() => {}}>
        <></>
      </Pressable>,
    )
    try {
      expect(ringOf('p').outlineWidth).toBeUndefined()
      fireEvent(screen.getByTestId('p'), 'hoverIn')
      const hovered = StyleSheet.flatten(screen.getByTestId('p').props.style) as {opacity?: number}
      expect(hovered.opacity).toBe(0.85)
      fireEvent(screen.getByTestId('p'), 'hoverOut')
      fireEvent(screen.getByTestId('p'), 'focus')
      expect(ringOf('p').outlineWidth).toBe(2)
      fireEvent(screen.getByTestId('p'), 'blur')
      expect(ringOf('p').outlineWidth).toBeUndefined()
    } finally {
      unmount()
    }
  })

  it('draws no ring on native focus', () => {
    setOS('ios')
    const {unmount} = renderWithProviders(
      <Pressable testID="p" onPress={() => {}}>
        <></>
      </Pressable>,
    )
    try {
      fireEvent(screen.getByTestId('p'), 'focus')
      expect(ringOf('p').outlineWidth).toBeUndefined()
    } finally {
      unmount()
    }
  })

  it('still chains a caller’s own hover/focus handlers', () => {
    const onFocus = jest.fn()
    const onHoverIn = jest.fn()
    const {unmount} = renderWithProviders(
      <Pressable testID="p" onPress={() => {}} onFocus={onFocus} onHoverIn={onHoverIn}>
        <></>
      </Pressable>,
    )
    try {
      fireEvent(screen.getByTestId('p'), 'focus')
      fireEvent(screen.getByTestId('p'), 'hoverIn')
      expect(onFocus).toHaveBeenCalledTimes(1)
      expect(onHoverIn).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })
})
