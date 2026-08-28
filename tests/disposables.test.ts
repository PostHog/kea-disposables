import { type BuiltLogic, kea, path } from 'kea'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { disposablesPlugin } from '../src/index.ts'
import { buildLogic, disposablesOf, initTests, makeCounter, setHidden } from './helpers.ts'

describe('disposablesPlugin', () => {
  let logic: BuiltLogic
  let setupCalls: number
  let cleanupCalls: number

  beforeEach(() => {
    initTests()
    setupCalls = 0
    cleanupCalls = 0
    setHidden(false)

    logic = buildLogic()
    logic.mount()
  })

  afterEach(() => {
    if (logic.isMounted()) {
      logic.unmount()
    }
    setHidden(false)
    vi.restoreAllMocks()
  })

  const makeSetup = () => () => {
    setupCalls += 1
    return () => {
      cleanupCalls += 1
    }
  }

  describe('mounting', () => {
    it('puts a manager on the cache of every mounted logic', () => {
      const manager = disposablesOf(logic)
      expect(manager).toBeDefined()
      expect(manager.isDisposed).toBe(false)
      expect(manager.registry.size).toBe(0)
      expect(manager.logicPath).toBe(logic.pathString)
    })

    it('keeps the existing manager when afterMount runs again on a live logic', () => {
      // kea normally only fires afterMount on the 0 -> 1 transition, but the plugin guards
      // against a second call regardless: replacing a live manager would orphan everything
      // already registered on it.
      setHidden(false)
      const manager = disposablesOf(logic)
      disposablesOf(logic).add(makeSetup(), 'k1')

      disposablesPlugin.events!.afterMount!(logic as any)

      expect(disposablesOf(logic)).toBe(manager)
      expect(disposablesOf(logic).registry.has('k1')).toBe(true)
      expect(cleanupCalls).toBe(0)
    })

    it('gives each logic its own independent manager', () => {
      const other = buildLogic()
      other.mount()

      expect(disposablesOf(other)).not.toBe(disposablesOf(logic))

      disposablesOf(logic).add(makeSetup(), 'k1')
      expect(disposablesOf(logic).registry.has('k1')).toBe(true)
      expect(disposablesOf(other).registry.has('k1')).toBe(false)

      other.unmount()
    })
  })

  describe.each<{
    label: string
    initialHidden: boolean
    options?: { pauseOnPageHidden?: boolean }
    expectedSetupCalls: number
    expectedRegistryHas: boolean
  }>([
    {
      label: 'visible, default options — runs setup immediately',
      initialHidden: false,
      expectedSetupCalls: 1,
      expectedRegistryHas: true,
    },
    {
      label: 'hidden, default options — defers setup, entry still registered',
      initialHidden: true,
      expectedSetupCalls: 0,
      expectedRegistryHas: true,
    },
    {
      label: 'hidden, pauseOnPageHidden=false — runs setup anyway',
      initialHidden: true,
      options: { pauseOnPageHidden: false },
      expectedSetupCalls: 1,
      expectedRegistryHas: true,
    },
  ])('add() — $label', ({ initialHidden, options, expectedSetupCalls, expectedRegistryHas }) => {
    it('matches expected setup/registry state', () => {
      setHidden(initialHidden)
      disposablesOf(logic).add(makeSetup(), 'k1', options)
      expect(setupCalls).toBe(expectedSetupCalls)
      expect(cleanupCalls).toBe(0)
      expect(disposablesOf(logic).registry.has('k1')).toBe(expectedRegistryHas)
    })
  })

  it('runs setup on next visibility-visible for paused-at-birth entries', () => {
    setHidden(true)
    disposablesOf(logic).add(makeSetup(), 'k1')
    expect(setupCalls).toBe(0)

    setHidden(false)
    expect(setupCalls).toBe(1)
  })

  describe.each<{
    label: string
    options?: { pauseOnPageHidden?: boolean }
    expectedCleanupCalls: number
  }>([
    {
      label: 'default — cleanup runs on hide',
      expectedCleanupCalls: 1,
    },
    {
      label: 'pauseOnPageHidden=false — cleanup does NOT run on hide',
      options: { pauseOnPageHidden: false },
      expectedCleanupCalls: 0,
    },
  ])('visibility-hidden cleanup — $label', ({ options, expectedCleanupCalls }) => {
    it('matches expected cleanup count', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'k1', options)
      expect(setupCalls).toBe(1)
      setHidden(true)
      expect(cleanupCalls).toBe(expectedCleanupCalls)
    })
  })

  it('does not re-run setup on show for a pauseOnPageHidden=false entry', () => {
    // The opt-out entry was never torn down on hide, so resuming it would leak a second
    // live listener on top of the one still running.
    setHidden(false)
    disposablesOf(logic).add(makeSetup(), 'k1', { pauseOnPageHidden: false })
    expect(setupCalls).toBe(1)

    setHidden(true)
    setHidden(false)
    expect(setupCalls).toBe(1)
    expect(cleanupCalls).toBe(0)
  })

  it('pauses and resumes across every mounted logic, not just the one that changed', () => {
    const other = buildLogic()
    other.mount()
    const otherCounter = makeCounter()

    setHidden(false)
    disposablesOf(logic).add(makeSetup(), 'k1')
    disposablesOf(other).add(otherCounter.setup, 'k1')
    expect(setupCalls).toBe(1)
    expect(otherCounter.setupCalls()).toBe(1)

    setHidden(true)
    expect(cleanupCalls).toBe(1)
    expect(otherCounter.cleanupCalls()).toBe(1)

    setHidden(false)
    expect(setupCalls).toBe(2)
    expect(otherCounter.setupCalls()).toBe(2)

    other.unmount()
  })

  describe('keys', () => {
    it('replacing a keyed disposable cleans up the previous one', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'k1')
      disposablesOf(logic).add(makeSetup(), 'k1')
      // first setup ran, first cleanup ran (because replaced), second setup ran
      expect(setupCalls).toBe(2)
      expect(cleanupCalls).toBe(1)
      expect(disposablesOf(logic).registry.size).toBe(1)
    })

    it('replacing a keyed disposable while hidden cleans up the previous and stores paused', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'k1')
      expect(setupCalls).toBe(1)

      setHidden(true)
      // visibility-hidden runs cleanup for the active entry
      expect(cleanupCalls).toBe(1)

      // replace while hidden — should not run setup
      disposablesOf(logic).add(makeSetup(), 'k1')
      expect(setupCalls).toBe(1) // unchanged
      // The plugin defensively re-runs the previous cleanup when replacing a key.
      // User-supplied cleanups must therefore be idempotent (clearTimeout on
      // an already-cleared id is fine). cleanupCalls bumps to 2 even though
      // the timer was already cleared on hide.
      expect(cleanupCalls).toBe(2)

      // Resume runs setup for the replaced entry
      setHidden(false)
      expect(setupCalls).toBe(2)
    })

    it('unnamed disposables get distinct auto keys and never replace each other', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup())
      disposablesOf(logic).add(makeSetup())
      disposablesOf(logic).add(makeSetup())

      expect(setupCalls).toBe(3)
      expect(cleanupCalls).toBe(0)
      expect(disposablesOf(logic).registry.size).toBe(3)
      expect([...disposablesOf(logic).registry.keys()]).toEqual(['__auto_0', '__auto_1', '__auto_2'])
    })

    it('regression: re-adding a disposable while hidden (poll-rescheduling pattern) does not start a live timer', () => {
      // Simulates the bug: a fetch's `finally` block calls add('pollTimeout', ...)
      // while the page is hidden. Before the fix, this would create a live timer.
      // After the fix, the setup is deferred to next visibility-visible.
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'pollTimeout')
      expect(setupCalls).toBe(1)

      setHidden(true)
      expect(cleanupCalls).toBe(1)

      // Simulate fetch returning and `finally` re-scheduling the timer
      disposablesOf(logic).add(makeSetup(), 'pollTimeout')
      // CRITICAL: setup must NOT run while hidden — that was the bug
      expect(setupCalls).toBe(1)

      // When the user returns to the tab, the timer should be set up
      setHidden(false)
      expect(setupCalls).toBe(2)
    })
  })

  describe.each<{
    label: string
    initialHidden: boolean
    expectedSetupCalls: number
    expectedCleanupCalls: number
  }>([
    {
      label: 'active entry — cleanup runs',
      initialHidden: false,
      expectedSetupCalls: 1,
      expectedCleanupCalls: 1,
    },
    {
      label: 'paused-at-birth entry — no user cleanup runs',
      initialHidden: true,
      expectedSetupCalls: 0,
      expectedCleanupCalls: 0,
    },
  ])('dispose() — $label', ({ initialHidden, expectedSetupCalls, expectedCleanupCalls }) => {
    it('removes entry and runs cleanup as expected', () => {
      setHidden(initialHidden)
      disposablesOf(logic).add(makeSetup(), 'k1')
      expect(setupCalls).toBe(expectedSetupCalls)
      disposablesOf(logic).dispose('k1')
      expect(cleanupCalls).toBe(expectedCleanupCalls)
      expect(disposablesOf(logic).registry.has('k1')).toBe(false)

      // Subsequent visibility changes should not affect anything
      setHidden(!initialHidden)
      setHidden(initialHidden)
      expect(setupCalls).toBe(expectedSetupCalls)
      expect(cleanupCalls).toBe(expectedCleanupCalls)
    })
  })

  it('dispose() returns true when it tore something down and false for an unknown key', () => {
    setHidden(false)
    disposablesOf(logic).add(makeSetup(), 'k1')

    expect(disposablesOf(logic).dispose('k1')).toBe(true)
    expect(disposablesOf(logic).dispose('k1')).toBe(false)
    expect(disposablesOf(logic).dispose('neverRegistered')).toBe(false)
    expect(cleanupCalls).toBe(1)
  })

  describe('error handling', () => {
    it('a throwing setup is logged, leaves no entry, and does not throw at the call site', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      setHidden(false)

      expect(() =>
        disposablesOf(logic).add(() => {
          throw new Error('setup boom')
        }, 'bad'),
      ).not.toThrow()

      expect(disposablesOf(logic).registry.has('bad')).toBe(false)
      expect(consoleError).toHaveBeenCalledOnce()
      expect(consoleError.mock.calls[0]?.[0]).toContain(logic.pathString)
    })

    it('a throwing cleanup is logged and does not stop the other cleanups from running', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      setHidden(false)

      disposablesOf(logic).add(
        () => () => {
          throw new Error('cleanup boom')
        },
        'bad',
      )
      disposablesOf(logic).add(makeSetup(), 'good')

      expect(() => logic.unmount()).not.toThrow()
      expect(cleanupCalls).toBe(1)
      expect(consoleError).toHaveBeenCalledOnce()
    })

    it('a setup that starts working and then throws on resume swaps in a no-op cleanup', () => {
      // Otherwise the next hide would re-run the *previous* life's cleanup against a
      // resource that was never re-created.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      let shouldThrow = false
      setHidden(false)

      disposablesOf(logic).add(() => {
        if (shouldThrow) {
          throw new Error('resume boom')
        }
        setupCalls += 1
        return () => {
          cleanupCalls += 1
        }
      }, 'flaky')
      expect(setupCalls).toBe(1)

      setHidden(true)
      expect(cleanupCalls).toBe(1)

      shouldThrow = true
      setHidden(false)
      expect(consoleError).toHaveBeenCalledOnce()

      // The stale cleanup must not run again on the next hide.
      setHidden(true)
      expect(cleanupCalls).toBe(1)
    })
  })

  describe('unmounting', () => {
    it('logic.unmount() disposes all registered disposables (no leak when a consumer omits beforeUnmount)', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'k1')
      disposablesOf(logic).add(makeSetup(), 'k2')
      expect(setupCalls).toBe(2)
      expect(cleanupCalls).toBe(0)

      logic.unmount()
      expect(cleanupCalls).toBe(2)
      expect(disposablesOf(logic).registry.size).toBe(0)
    })

    it('add() and dispose() are inert after unmount rather than throwing', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'k1')
      // A loader or listener closes over `cache`, then reaches `cache.disposables` when it
      // resumes. Read the manager the same way here, so nulling it on unmount fails this test.
      const cache = logic.cache as any

      logic.unmount()
      expect(cleanupCalls).toBe(1)
      expect(cache.disposables.isDisposed).toBe(true)

      expect(cache.disposables.dispose('k1')).toBe(false)

      cache.disposables.add(makeSetup(), 'k2')
      expect(setupCalls).toBe(1)
      expect(cache.disposables.registry.has('k2')).toBe(false)
    })

    it('does not dispose while another mount still holds the logic', () => {
      // kea reference-counts mounts. Cleanup belongs on the *final* unmount, or a logic
      // shared by two scenes loses its timers as soon as either one goes away.
      setHidden(false)
      const unmountSecond = logic.mount()
      disposablesOf(logic).add(makeSetup(), 'k1')

      unmountSecond()
      expect(cleanupCalls).toBe(0)
      expect(disposablesOf(logic).isDisposed).toBe(false)

      logic.unmount()
      expect(cleanupCalls).toBe(1)
      expect(disposablesOf(logic).isDisposed).toBe(true)
    })

    it('stops responding to visibility changes once unmounted', () => {
      setHidden(false)
      disposablesOf(logic).add(makeSetup(), 'k1')

      logic.unmount()
      expect(cleanupCalls).toBe(1)

      setHidden(true)
      setHidden(false)
      expect(setupCalls).toBe(1)
      expect(cleanupCalls).toBe(1)
    })

    it('mounting a built logic again replaces its disposed manager', () => {
      // Remounting a retained built logic keeps its cache. A manager left disposed there
      // makes every add() in the next afterMount a no-op, so the logic loses its timers and
      // listeners for good.
      setHidden(false)
      const remounted = kea([path(['test', 'disposablesRemountTest'])]).build()
      remounted.mount()
      disposablesOf(remounted).add(makeSetup(), 'k1')
      remounted.unmount()
      expect(cleanupCalls).toBe(1)
      expect(disposablesOf(remounted).isDisposed).toBe(true)

      remounted.mount()
      disposablesOf(remounted).add(makeSetup(), 'k1')
      expect(setupCalls).toBe(2)
      expect(disposablesOf(remounted).registry.has('k1')).toBe(true)
      expect(disposablesOf(remounted).isDisposed).toBe(false)
      remounted.unmount()
    })
  })

  describe('global visibilitychange listener', () => {
    it('is attached once no matter how many logics mount', () => {
      const addEventListener = vi.spyOn(document, 'addEventListener')
      const a = buildLogic()
      const b = buildLogic()
      a.mount()
      b.mount()

      const visibilityRegistrations = addEventListener.mock.calls.filter(
        ([type]) => type === 'visibilitychange',
      )
      expect(visibilityRegistrations).toHaveLength(0)

      a.unmount()
      b.unmount()
    })

    it('is detached only once the last manager is gone', () => {
      const removeEventListener = vi.spyOn(document, 'removeEventListener')
      const other = buildLogic()
      other.mount()

      const removals = (): number =>
        removeEventListener.mock.calls.filter(([type]) => type === 'visibilitychange').length

      other.unmount()
      expect(removals()).toBe(0)

      // `logic` from the outer beforeEach is still mounted; unmounting it empties the set.
      logic.unmount()
      expect(removals()).toBe(1)
    })
  })
})
