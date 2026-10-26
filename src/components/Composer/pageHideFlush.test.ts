import {
  realPageHideTargets,
  subscribePageHideFlush,
  type PageHideTarget,
} from './pageHideFlush'

function fakeTargets(hidden = false) {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), {hidden})
  return {
    win,
    doc,
    setHidden(value: boolean) {
      ;(doc as {hidden: boolean}).hidden = value
    },
  }
}

describe('subscribePageHideFlush', () => {
  it('flushes on pagehide', () => {
    const {win, doc} = fakeTargets()
    const onHide = jest.fn()
    const cleanup = subscribePageHideFlush(
      onHide,
      win as unknown as PageHideTarget,
      doc as unknown as PageHideTarget,
    )
    win.dispatchEvent(new Event('pagehide'))
    expect(onHide).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('flushes on visibilitychange only while hidden', () => {
    const {doc} = fakeTargets(false)
    const win = new EventTarget()
    const onHide = jest.fn()
    const cleanup = subscribePageHideFlush(
      onHide,
      win as unknown as PageHideTarget,
      doc as unknown as PageHideTarget,
    )
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(onHide).not.toHaveBeenCalled()
    ;(doc as {hidden: boolean}).hidden = true
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(onHide).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('subscribes pagehide without a document target', () => {
    const win = new EventTarget()
    const onHide = jest.fn()
    const cleanup = subscribePageHideFlush(onHide, win as unknown as PageHideTarget, undefined)
    win.dispatchEvent(new Event('pagehide'))
    expect(onHide).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('no-ops without a window target and cleans up detached listeners', () => {
    const onHide = jest.fn()
    const cleanup = subscribePageHideFlush(onHide, undefined, undefined)
    expect(cleanup).not.toThrow()
    const {win, doc} = fakeTargets(true)
    const stop = subscribePageHideFlush(
      onHide,
      win as unknown as PageHideTarget,
      doc as unknown as PageHideTarget,
    )
    stop()
    win.dispatchEvent(new Event('pagehide'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(onHide).not.toHaveBeenCalled()
  })

  it('real targets resolve safely in this env (no DOM globals required)', () => {
    // The RN test env has no `document` (like a native device); whatever
    // stub `window` exists here, resolving and subscribing must be safe
    // and must never flush spontaneously.
    const targets = realPageHideTargets()
    expect(targets.doc).toBeUndefined()
    const onHide = jest.fn()
    const cleanup = subscribePageHideFlush(onHide, targets.win, targets.doc)
    expect(onHide).not.toHaveBeenCalled()
    expect(() => cleanup()).not.toThrow()
  })
})
