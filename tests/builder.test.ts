import { type BuiltLogic, actions, kea, listeners, path, resetContext } from 'kea'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { disposables, disposablesPlugin, getDisposables } from '../src/index.ts'
import { initTests, makeCounter, setHidden } from './helpers.ts'

describe('disposables() logic builder', () => {
  beforeEach(() => {
    initTests()
    setHidden(false)
  })

  it('registers each keyed disposable on mount and tears them all down on unmount', () => {
    const a = makeCounter()
    const b = makeCounter()
    const logic = kea([
      path(['test', 'builderBasic']),
      disposables({ first: a.setup, second: b.setup }),
    ]).build()

    // Nothing runs until the logic mounts.
    expect(a.setupCalls()).toBe(0)

    logic.mount()
    expect(a.setupCalls()).toBe(1)
    expect(b.setupCalls()).toBe(1)
    expect([...getDisposables(logic).registry.keys()]).toEqual(['first', 'second'])

    logic.unmount()
    expect(a.cleanupCalls()).toBe(1)
    expect(b.cleanupCalls()).toBe(1)
  })

  it('accepts a function of the logic, so setups can reach actions', () => {
    const logic = kea([
      path(['test', 'builderFn']),
      actions({ ping: true }),
      listeners(() => ({ ping: () => {} })),
      disposables(({ actions: a }: any) => ({
        pinger: () => {
          const id = setInterval(() => a.ping(), 1000)
          return () => clearInterval(id)
        },
      })),
    ]).build()

    vi.useFakeTimers()
    logic.mount()
    expect(getDisposables(logic).registry.has('pinger')).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    logic.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('passes options through, so an entry can opt out of pausing', () => {
    const paused = makeCounter()
    const always = makeCounter()
    const logic = kea([
      path(['test', 'builderOptions']),
      disposables({
        paused: paused.setup,
        always: { setup: always.setup, options: { pauseOnPageHidden: false } },
      }),
    ]).build()
    logic.mount()

    setHidden(true)
    expect(paused.cleanupCalls()).toBe(1)
    expect(always.cleanupCalls()).toBe(0)

    logic.unmount()
    setHidden(false)
  })

  it('produces ordinary keys, so dispose() and re-add still work', () => {
    const counter = makeCounter()
    const logic = kea([path(['test', 'builderKeys']), disposables({ poller: counter.setup })]).build()
    logic.mount()

    expect(getDisposables(logic).dispose('poller')).toBe(true)
    expect(counter.cleanupCalls()).toBe(1)

    getDisposables(logic).add(counter.setup, 'poller')
    expect(counter.setupCalls()).toBe(2)
    logic.unmount()
  })
})

describe('beforeCloseContext', () => {
  afterEach(() => {
    setHidden(false)
  })

  it('disposes logics that resetContext() drops without unmounting', () => {
    // resetContext() removes every logic from the store without unmounting it, so beforeUnmount
    // never fires. Without this hook the interval below would run for the rest of the page's life.
    initTests()
    setHidden(false)
    const counter = makeCounter()
    const logic = kea([path(['test', 'contextReset']), disposables({ poller: counter.setup })]).build()
    logic.mount()
    expect(counter.setupCalls()).toBe(1)
    expect(counter.cleanupCalls()).toBe(0)

    resetContext({ plugins: [disposablesPlugin], createStore: true })

    expect(counter.cleanupCalls()).toBe(1)
    expect(getDisposables(logic).isDisposed).toBe(true)
    expect(getDisposables(logic).registry.size).toBe(0)
  })

  it('leaves no live interval behind across a context reset', () => {
    vi.useFakeTimers()
    initTests()
    setHidden(false)
    const logic = kea([
      path(['test', 'contextResetTimer']),
      disposables({
        poller: () => {
          const id = setInterval(() => {}, 1000)
          return () => clearInterval(id)
        },
      }),
    ]).build()
    logic.mount()
    expect(vi.getTimerCount()).toBe(1)

    resetContext({ plugins: [disposablesPlugin], createStore: true })
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it('detaches the global visibility listener on context teardown', () => {
    initTests()
    setHidden(false)
    const logic = kea([path(['test', 'contextResetListener'])]).build()
    logic.mount()

    const removeEventListener = vi.spyOn(document, 'removeEventListener')
    resetContext({ plugins: [disposablesPlugin], createStore: true })

    expect(removeEventListener.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1)
    removeEventListener.mockRestore()
  })

  it('stops responding to visibility changes for logics from the closed context', () => {
    initTests()
    setHidden(false)
    const counter = makeCounter()
    const logic: BuiltLogic = kea([
      path(['test', 'contextResetVisibility']),
      disposables({ poller: counter.setup }),
    ]).build()
    logic.mount()
    expect(counter.setupCalls()).toBe(1)

    resetContext({ plugins: [disposablesPlugin], createStore: true })
    expect(counter.cleanupCalls()).toBe(1)

    setHidden(true)
    setHidden(false)
    expect(counter.setupCalls()).toBe(1)
    expect(counter.cleanupCalls()).toBe(1)
  })
})
