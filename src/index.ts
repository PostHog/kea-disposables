import { afterMount } from 'kea'
import type { BuiltLogic, KeaPlugin, Logic, LogicBuilder } from 'kea'

export type DisposableFunction = () => void
export type SetupFunction = () => DisposableFunction

export type DisposableOptions = {
  pauseOnPageHidden?: boolean
}

type DisposableEntry = {
  setup: SetupFunction
  cleanup: DisposableFunction
  options: DisposableOptions
}

export type DisposablesManager = {
  add: (setup: SetupFunction, key?: string, options?: DisposableOptions) => void
  dispose: (key: string) => boolean
  registry: Map<string, DisposableEntry>
  keyCounter: number
  logicPath: string
  /**
   * True once the logic has begun its final unmount. It is set before the registered cleanups
   * run, so a cleanup that wakes a continuation already sees an inert manager. `add` and
   * `dispose` do nothing from that point on, which is what lets async work that outlives the
   * unmount call them unconditionally. Read it when the continuation itself must stop early,
   * for instance before reading `values` on a logic whose reducers are already detached.
   *
   * A disposed manager stays inert for the rest of its own life, but the next mount of the same
   * logic puts a fresh manager on the cache. So a continuation that reaches `cache.disposables`
   * late can find a live manager belonging to the logic's next life, and disposing a shared key
   * from there tears down the new life's resource. Capture what the continuation needs while the
   * logic is alive when that matters.
   */
  isDisposed: boolean
}

// Type for logic with disposables added
type LogicWithCache = BuiltLogic & {
  cache: { disposables?: DisposablesManager; [key: string]: any }
}

// Global state for visibility tracking
const globalVisibilityState = {
  allManagers: new Set<DisposablesManager>(),
  listenerAttached: false,
  handler: null as (() => void) | null,
}

/**
 * The plugin is browser-oriented, but the package must survive being imported and mounted where
 * there is no DOM (SSR prerender, a node-environment test runner). Everything visibility-related
 * degrades to "always visible, never paused" there rather than throwing on `document`.
 */
const hasDocument = (): boolean => typeof document !== 'undefined'

const isPageHidden = (): boolean => hasDocument() && document.hidden

const safeCleanup = (cleanup: DisposableFunction, logicPath: string): void => {
  try {
    cleanup()
  } catch (error) {
    console.error(`[KEA] Disposable cleanup failed in logic ${logicPath}:`, error)
  }
}

const safeSetup = (setup: SetupFunction, logicPath: string): DisposableFunction | null => {
  try {
    return setup()
  } catch (error) {
    console.error(`[KEA] Disposable setup failed in logic ${logicPath}:`, error)
    return null
  }
}

const pauseAllDisposables = (): void => {
  globalVisibilityState.allManagers.forEach((manager) => {
    manager.registry.forEach((entry) => {
      if (entry.options.pauseOnPageHidden !== false && entry.cleanup) {
        safeCleanup(entry.cleanup, manager.logicPath)
      }
    })
  })
}

const resumeAllDisposables = (): void => {
  globalVisibilityState.allManagers.forEach((manager) => {
    manager.registry.forEach((entry) => {
      if (entry.options.pauseOnPageHidden !== false) {
        const cleanup = safeSetup(entry.setup, manager.logicPath)
        if (cleanup) {
          entry.cleanup = cleanup
        } else {
          // Setup failed - replace cleanup with no-op to prevent stale cleanup from running
          entry.cleanup = () => {}
        }
      }
    })
  })
}

const attachGlobalVisibilityListener = (): void => {
  if (globalVisibilityState.listenerAttached || !hasDocument()) {
    return
  }

  const handleVisibilityChange = (): void => {
    if (document.hidden) {
      pauseAllDisposables()
    } else {
      resumeAllDisposables()
    }
  }

  globalVisibilityState.handler = handleVisibilityChange
  document.addEventListener('visibilitychange', handleVisibilityChange)
  globalVisibilityState.listenerAttached = true
}

/**
 * Tear a manager down: mark it inert, run every registered cleanup, empty the registry, and
 * unregister it from visibility tracking. Shared by the final unmount and by context teardown.
 *
 * `isDisposed` is set *before* the cleanups run, so anything a cleanup wakes up (an aborted
 * request resuming inside a `finally`, for instance) sees an inert manager rather than
 * re-registering a resource on a logic that is going away.
 */
const disposeManager = (manager: DisposablesManager): void => {
  globalVisibilityState.allManagers.delete(manager)
  manager.isDisposed = true
  manager.registry.forEach((entry) => {
    safeCleanup(entry.cleanup, manager.logicPath)
  })
  manager.registry.clear()
}

const detachGlobalVisibilityListener = (): void => {
  if (!globalVisibilityState.listenerAttached || !globalVisibilityState.handler) {
    return
  }
  if (globalVisibilityState.allManagers.size === 0) {
    document.removeEventListener('visibilitychange', globalVisibilityState.handler)
    globalVisibilityState.listenerAttached = false
    globalVisibilityState.handler = null
  }
}

const initializeDisposablesManager = (logic: LogicWithCache): void => {
  // A logic that mounts again keeps the same cache, so the disposed manager from its previous
  // life is still attached. Replace it, or every `add` in the new `afterMount` is a no-op and
  // the logic silently loses its timers and listeners for the rest of the session.
  if (logic.cache.disposables && !logic.cache.disposables.isDisposed) {
    return
  }

  const manager: DisposablesManager = {
    registry: new Map(),
    keyCounter: 0,
    logicPath: logic.pathString,
    isDisposed: false,
    add: (setup: SetupFunction, key?: string, options?: DisposableOptions) => {
      if (manager.isDisposed) {
        return
      }
      const disposableKey = key ?? `__auto_${manager.keyCounter++}`
      const disposableOptions: DisposableOptions = { pauseOnPageHidden: true, ...options }

      // If replacing a keyed disposable, clean up the previous one first
      if (key && manager.registry.has(disposableKey)) {
        const previousEntry = manager.registry.get(disposableKey)!
        safeCleanup(previousEntry.cleanup, manager.logicPath)
      }

      // If the page is currently hidden and this disposable opts into
      // pause/resume, register it without running setup. resumeAllDisposables
      // will run setup the next time the page becomes visible. Without this,
      // anything calling add() from a listener/loader while hidden (e.g.
      // re-scheduling a poll inside a fetch's `finally`) creates a live
      // timer/listener that should be paused — defeating the auto-pause.
      const startPaused = isPageHidden() && disposableOptions.pauseOnPageHidden !== false
      if (startPaused) {
        manager.registry.set(disposableKey, {
          setup,
          cleanup: () => {},
          options: disposableOptions,
        })
        return
      }

      // Run setup function to get cleanup function
      const cleanup = safeSetup(setup, manager.logicPath)
      if (cleanup) {
        manager.registry.set(disposableKey, {
          setup,
          cleanup,
          options: disposableOptions,
        })
      }
    },
    dispose: (key: string) => {
      if (manager.isDisposed) {
        return false
      }
      if (!manager.registry.has(key)) {
        return false
      }

      const entry = manager.registry.get(key)!
      safeCleanup(entry.cleanup, manager.logicPath)
      manager.registry.delete(key)
      return true
    },
  }

  logic.cache.disposables = manager

  // Register this manager for global visibility tracking
  globalVisibilityState.allManagers.add(manager)
  attachGlobalVisibilityListener()
}

/**
 * Shape of `logic.cache` once `disposablesPlugin` is registered.
 *
 * Kea types `cache` as `Record<string, any>`, so `cache.disposables.add(...)` already compiles —
 * it just is not checked. Annotate the destructured `cache` with this to get real completions:
 *
 * ```typescript
 * listeners(({ cache }: { cache: DisposablesCache }) => ({ ... }))
 * ```
 */
export type DisposablesCache = Record<string, any> & {
  disposables: DisposablesManager
}

/**
 * Reads the disposables manager off a logic with a real type instead of `any`.
 *
 * `logic.cache` is `Record<string, any>` in kea and cannot be narrowed by module augmentation,
 * so this is the only way to get checked access from outside a logic's own builders.
 *
 * ```typescript
 * getDisposables(myLogic).dispose('poller')
 * ```
 */
export function getDisposables(logic: BuiltLogic | { cache: Record<string, any> }): DisposablesManager {
  return (logic as LogicWithCache).cache.disposables as DisposablesManager
}

/** A single entry in the {@link disposables} builder: a setup function, or one plus its options. */
export type DisposableDefinition = SetupFunction | { setup: SetupFunction; options?: DisposableOptions }

/** Keyed disposables to register on mount. Keys become the disposable keys. */
export type DisposablesInput = Record<string, DisposableDefinition>

/**
 * Logic builder that registers keyed disposables when the logic mounts.
 *
 * This is sugar over the imperative API for the common case — a resource whose whole life is the
 * logic's life — so you don't write an `afterMount` just to call `add`. Anything conditional or
 * re-armed later still wants `cache.disposables.add(...)` from a listener.
 *
 * ```typescript
 * import { kea, path } from 'kea'
 * import { disposables } from 'kea-disposables'
 *
 * const myLogic = kea([
 *     path(['scenes', 'myLogic']),
 *     disposables(({ actions }) => ({
 *         poller: () => {
 *             const id = setInterval(() => actions.poll(), 5000)
 *             return () => clearInterval(id)
 *         },
 *         // Opt a disposable out of pausing on hidden tabs:
 *         crossTabSync: {
 *             setup: () => {
 *                 const handler = (): void => actions.sync()
 *                 window.addEventListener('storage', handler)
 *                 return () => window.removeEventListener('storage', handler)
 *             },
 *             options: { pauseOnPageHidden: false },
 *         },
 *     })),
 * ])
 * ```
 *
 * The keys are ordinary disposable keys, so `cache.disposables.dispose('poller')` stops one early
 * and re-adding the same key later replaces it.
 */
export function disposables<L extends Logic = Logic>(
  input: DisposablesInput | ((logic: L) => DisposablesInput),
): LogicBuilder<L> {
  return (logic) => {
    // The plugin's own `afterMount` event runs before the core `afterMount` builder callbacks,
    // so the manager is already on the cache by the time this runs.
    afterMount(() => {
      const definitions = typeof input === 'function' ? input(logic as unknown as L) : input
      for (const [key, definition] of Object.entries(definitions)) {
        if (typeof definition === 'function') {
          getDisposables(logic).add(definition, key)
        } else {
          getDisposables(logic).add(definition.setup, key, definition.options)
        }
      }
    })(logic)
  }
}

/**
 * Kea plugin that provides automatic resource cleanup via disposables with smart pause/resume.
 *
 * ## Registering the plugin
 *
 * ```typescript
 * import { resetContext } from 'kea'
 * import { disposablesPlugin } from 'kea-disposables'
 *
 * resetContext({
 *     plugins: [disposablesPlugin],
 *     createStore: true,
 * })
 * ```
 *
 * Every logic mounted from that point on gets a `cache.disposables` manager.
 *
 * ## Usage
 *
 * The disposables system is similar to React's useEffect cleanup pattern - you provide
 * a setup function that returns a cleanup function. The cleanup runs automatically when
 * the logic unmounts.
 *
 * ```typescript
 * listeners(({ actions, cache }) => ({
 *     someAction: () => {
 *         // Add a disposable - like useEffect(() => { ... return cleanup }, [])
 *         cache.disposables.add(() => {
 *             // Setup code runs immediately
 *             const intervalId = setInterval(() => {
 *                 actions.pollData()
 *             }, 5000)
 *
 *             // Return cleanup function (like useEffect cleanup)
 *             return () => clearInterval(intervalId)
 *         }, 'pollingInterval') // Optional key for replacing/disposing specific disposables
 *     }
 * }))
 * ```
 *
 * ## Key Features
 *
 * - **Automatic cleanup**: Cleanup functions run when the logic unmounts
 * - **Smart pause/resume**: Disposables automatically pause when page is hidden
 * - **Named disposables**: Use keys to replace or dispose specific resources
 * - **Safe execution**: Errors in cleanup are caught and logged
 * - **Similar to useEffect**: Setup returns cleanup, just like React hooks
 *
 * ## Automatic Pause on Page Hidden
 *
 * By default, all disposables pause when the page is hidden and resume when visible.
 * This dramatically reduces CPU and network usage in background tabs.
 *
 * ```typescript
 * // This automatically pauses when page is hidden
 * cache.disposables.add(() => {
 *     const id = setInterval(() => actions.pollData(), 5000)
 *     return () => clearInterval(id)
 * }, 'polling')
 * ```
 *
 * For critical resources that must remain active (e.g., navigation tracking),
 * opt-out with `pauseOnPageHidden: false`:
 *
 * ```typescript
 * // This keeps running even when page is hidden
 * cache.disposables.add(() => {
 *     window.addEventListener('popstate', handler)
 *     return () => window.removeEventListener('popstate', handler)
 * }, 'navigation', { pauseOnPageHidden: false })
 * ```
 *
 * ## Common Use Cases
 *
 * - Event listeners (window.addEventListener)
 * - Timers (setTimeout, setInterval) - auto-pauses!
 * - Subscriptions (WebSocket, EventSource) - auto-pauses!
 * - External library cleanup
 *
 * @example Replace a disposable
 * ```typescript
 * // Each call with the same key replaces the previous one
 * cache.disposables.add(() => {
 *     const id = setTimeout(() => action(), 1000)
 *     return () => clearTimeout(id)
 * }, 'myTimer')
 *
 * // Later, this replaces the previous timer
 * cache.disposables.add(() => {
 *     const id = setTimeout(() => action(), 2000)
 *     return () => clearTimeout(id)
 * }, 'myTimer')
 * ```
 *
 * @example Manually dispose
 * ```typescript
 * // Stop polling without unmounting
 * cache.disposables.dispose('pollingInterval')
 * ```
 *
 * ## Safe to call after unmount
 *
 * `add` and `dispose` become no-ops once the logic unmounts, so a listener or loader that resumes
 * after the unmount can call them without a null check. When such a continuation must also skip
 * work of its own (dispatching an action, reading `values`), branch on `cache.disposables.isDisposed`.
 */
export const disposablesPlugin: KeaPlugin = {
  name: 'disposables',
  events: {
    afterMount(logic) {
      const typedLogic = logic as LogicWithCache
      initializeDisposablesManager(typedLogic)
    },
    beforeUnmount(logic) {
      const typedLogic = logic as LogicWithCache
      const manager = typedLogic.cache.disposables
      // Only dispose on final unmount, when logic.isMounted() has become false. kea
      // reference-counts mounts, so a logic shared by two scenes must survive the first one
      // going away with its timers intact.
      if (!typedLogic.isMounted() && manager && !manager.isDisposed) {
        // The manager itself stays on the cache instead of being nulled, because async work
        // that outlives the unmount still reaches for `cache.disposables.dispose(...)`, and a
        // null there throws a TypeError out of the continuation rather than doing nothing.
        disposeManager(manager)
        detachGlobalVisibilityListener()
      }
    },
    beforeCloseContext() {
      // `resetContext()` drops every logic from the store without unmounting it, so
      // `beforeUnmount` never fires and every interval, listener and subscription those logics
      // registered would stay live for the rest of the page's life. Storybook resets the context
      // on every story mount and most test setups reset between tests, so this is the common
      // case, not an edge case.
      //
      // Managers torn down here are left `isDisposed`, which is what a continuation belonging to
      // the old context should see.
      globalVisibilityState.allManagers.forEach(disposeManager)
      globalVisibilityState.allManagers.clear()
      detachGlobalVisibilityListener()
    },
  },
}
