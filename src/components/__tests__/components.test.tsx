import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'

import {ThemeProvider} from '#/alf/index'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {Divider} from '#/components/Divider'
import {Link} from '#/components/Link'
import {Loader} from '#/components/Loader'
import {Menu} from '#/components/Menu'
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
