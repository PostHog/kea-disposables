import { type BuiltLogic, kea, path, resetContext } from 'kea'

import { disposablesPlugin } from '../src/index.ts'

/** Re-create the kea context with only this plugin registered. Call in `beforeEach`. */
export const initTests = (): void => {
  resetContext({
    plugins: [disposablesPlugin],
    createStore: true,
  })
}

/**
 * jsdom leaves `document.hidden` as a non-configurable getter on the prototype, so each test
 * overrides it on the instance and fires the event the plugin actually listens for.
 */
export const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** A mounted, otherwise-empty logic. Each call gets a distinct path so kea builds a fresh one. */
let logicCounter = 0
export const buildLogic = (name?: string): BuiltLogic => {
  const pathString = name ?? `testLogic${logicCounter++}`
  return kea([path(['test', pathString])]).build()
}

/** Typed accessor for the manager the plugin hangs off `logic.cache`. */
export const disposablesOf = (logic: BuiltLogic): DisposablesManagerLike => (logic.cache as any).disposables

type DisposablesManagerLike = {
  add: (setup: () => () => void, key?: string, options?: { pauseOnPageHidden?: boolean }) => void
  dispose: (key: string) => boolean
  registry: Map<string, unknown>
  keyCounter: number
  logicPath: string
  isDisposed: boolean
}

/** Counters for a setup/cleanup pair, so tests can assert how many times each ran. */
export const makeCounter = (): {
  setup: () => () => void
  setupCalls: () => number
  cleanupCalls: () => number
} => {
  let setupCalls = 0
  let cleanupCalls = 0
  return {
    setup: () => {
      setupCalls += 1
      return () => {
        cleanupCalls += 1
      }
    },
    setupCalls: () => setupCalls,
    cleanupCalls: () => cleanupCalls,
  }
}
