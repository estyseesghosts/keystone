import {render, waitFor} from '@testing-library/react-native'
import {AccessibilityInfo} from 'react-native'

import {Body} from '#/alf/typography'
import {__resetReducedMotionForTests, useReducedMotionSetting} from '#/lib/motion'

function Probe() {
  const reduced = useReducedMotionSetting()
  return <Body testID="probe">{reduced ? 'reduced' : 'full'}</Body>
}

describe('useReducedMotionSetting (P9)', () => {
  beforeEach(() => {
    __resetReducedMotionForTests()
  })

  it('defaults to full motion when the bridge has no reduce-motion API', () => {
    const ai = AccessibilityInfo as unknown as Record<string, unknown>
    const savedIs = ai.isReduceMotionEnabled
    const savedAdd = ai.addEventListener
    delete ai.isReduceMotionEnabled
    delete ai.addEventListener
    try {
      const screen = render(<Probe />)
      expect(screen.getByTestId('probe')).toHaveTextContent('full')
    } finally {
      ai.isReduceMotionEnabled = savedIs
      ai.addEventListener = savedAdd
    }
  })

  it('follows the OS setting once it resolves', async () => {
    const ai = AccessibilityInfo as unknown as Record<string, jest.Mock | undefined>
    const savedIs = ai.isReduceMotionEnabled
    const savedAdd = ai.addEventListener
    ai.isReduceMotionEnabled = jest.fn().mockResolvedValue(true)
    ai.addEventListener = jest.fn().mockReturnValue({remove: jest.fn()})
    try {
      const screen = render(<Probe />)
      await waitFor(() => {
        expect(screen.getByTestId('probe')).toHaveTextContent('reduced')
      })
    } finally {
      ai.isReduceMotionEnabled = savedIs
      ai.addEventListener = savedAdd
    }
  })

  it('reacts to reduceMotionChanged events', async () => {
    const ai = AccessibilityInfo as unknown as Record<string, jest.Mock | undefined>
    const savedIs = ai.isReduceMotionEnabled
    const savedAdd = ai.addEventListener
    let handler: ((value: boolean) => void) | null = null
    const box = {
      get current() {
        return handler
      },
    }
    ai.isReduceMotionEnabled = jest.fn().mockResolvedValue(false)
    ai.addEventListener = jest.fn().mockImplementation((_event: string, cb: (v: boolean) => void) => {
      handler = cb
      return {remove: jest.fn()}
    })
    try {
      const screen = render(<Probe />)
      await waitFor(() => {
        expect(screen.getByTestId('probe')).toHaveTextContent('full')
      })
      box.current?.(true)
      await waitFor(() => {
        expect(screen.getByTestId('probe')).toHaveTextContent('reduced')
      })
    } finally {
      ai.isReduceMotionEnabled = savedIs
      ai.addEventListener = savedAdd
    }
  })
})
