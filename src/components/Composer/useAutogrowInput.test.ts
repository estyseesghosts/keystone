// useAutogrowInput: floor/ceiling clamping for adaptive composer height.
import {act, renderHook} from '@testing-library/react-native'

import {useAutogrowInput} from './useAutogrowInput'

function sizeEvent(height: number) {
  return {nativeEvent: {contentSize: {height}}} as never
}

describe('useAutogrowInput', () => {
  it('rests at null, clamps content height to [min, max], and contracts', () => {
    const {result} = renderHook(() => useAutogrowInput(72, 320))
    expect(result.current.height).toBeNull()
    act(() => result.current.onContentSizeChange(sizeEvent(10)))
    expect(result.current.height).toBe(72)
    act(() => result.current.onContentSizeChange(sizeEvent(200.2)))
    expect(result.current.height).toBe(201)
    act(() => result.current.onContentSizeChange(sizeEvent(900)))
    expect(result.current.height).toBe(320)
    act(() => result.current.onContentSizeChange(sizeEvent(90)))
    expect(result.current.height).toBe(90)
  })
})
