import { actions, kea, listeners, path, reducers } from 'kea'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initTests, setHidden } from './helpers.ts'

/** A logic shaped like the real thing this plugin exists for: a poller with a stop switch. */
const pollingLogic = kea([
  path(['test', 'pollingLogic']),
  actions({
    startPolling: true,
    stopPolling: true,
    poll: true,
  }),
  reducers({
    pollCount: [0, { poll: (state: number) => state + 1 }],
  }),
  listeners(({ actions: a, cache }: any) => ({
    startPolling: () => {
      cache.disposables.add(() => {
        const id = setInterval(() => a.poll(), 1000)
        return () => clearInterval(id)
      }, 'poller')
    },
    stopPolling: () => {
      cache.disposables.dispose('poller')
    },
  })),
])

describe('polling logic end to end', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    initTests()
    setHidden(false)
  })

  afterEach(() => {
    if (pollingLogic.isMounted()) {
      pollingLogic.unmount()
    }
    vi.useRealTimers()
  })

  it('polls on an interval and stops when disposed', () => {
    pollingLogic.mount()
    pollingLogic.actions.startPolling()

    vi.advanceTimersByTime(3000)
    expect(pollingLogic.values.pollCount).toBe(3)

    pollingLogic.actions.stopPolling()
    vi.advanceTimersByTime(5000)
    expect(pollingLogic.values.pollCount).toBe(3)
  })

  it('stops polling while the tab is hidden and picks back up on return', () => {
    pollingLogic.mount()
    pollingLogic.actions.startPolling()

    vi.advanceTimersByTime(2000)
    expect(pollingLogic.values.pollCount).toBe(2)

    setHidden(true)
    vi.advanceTimersByTime(60_000)
    expect(pollingLogic.values.pollCount).toBe(2)

    setHidden(false)
    vi.advanceTimersByTime(2000)
    expect(pollingLogic.values.pollCount).toBe(4)
  })

  it('leaves no live interval behind after unmount', () => {
    pollingLogic.mount()
    pollingLogic.actions.startPolling()
    vi.advanceTimersByTime(1000)
    expect(pollingLogic.values.pollCount).toBe(1)

    pollingLogic.unmount()
    // A leaked interval would keep firing and throw when it dispatched into a torn-down store.
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-scheduling the poll from a hidden tab does not start a live timer', () => {
    // The bug this plugin guards against: async work resuming while hidden re-arms its own
    // timer, quietly defeating the pause.
    pollingLogic.mount()
    pollingLogic.actions.startPolling()
    vi.advanceTimersByTime(1000)
    expect(pollingLogic.values.pollCount).toBe(1)

    setHidden(true)
    expect(vi.getTimerCount()).toBe(0)

    pollingLogic.actions.startPolling() // simulates a `finally` re-arming the poll
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(60_000)
    expect(pollingLogic.values.pollCount).toBe(1)

    setHidden(false)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(pollingLogic.values.pollCount).toBe(2)
  })
})
