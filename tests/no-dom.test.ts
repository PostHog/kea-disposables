/**
 * @vitest-environment node
 *
 * The plugin is browser-oriented, but a published package gets imported into SSR renders and
 * node-environment test runners too. Nothing here may touch `document`.
 */
import { kea, path, resetContext } from 'kea'
import { beforeEach, describe, expect, it } from 'vitest'

import { disposablesPlugin } from '../src/index.ts'

describe('without a DOM', () => {
  beforeEach(() => {
    resetContext({ plugins: [disposablesPlugin], createStore: true })
  })

  it('has no document to speak of', () => {
    expect(typeof document).toBe('undefined')
  })

  it('mounts, runs setup immediately, and cleans up on unmount', () => {
    const logic = kea([path(['test', 'noDomLogic'])]).build()
    logic.mount()

    let cleanedUp = false
    const cache = logic.cache as any
    // Nothing is ever "hidden" without a document, so setup must run right away rather than
    // being deferred to a visibilitychange that will never fire.
    cache.disposables.add(() => {
      return () => {
        cleanedUp = true
      }
    }, 'k1')

    expect(cache.disposables.registry.has('k1')).toBe(true)

    logic.unmount()
    expect(cleanedUp).toBe(true)
    expect(cache.disposables.isDisposed).toBe(true)
  })

  it('supports dispose() and the post-unmount no-op contract', () => {
    const logic = kea([path(['test', 'noDomDisposeLogic'])]).build()
    logic.mount()
    const cache = logic.cache as any

    cache.disposables.add(() => () => {}, 'k1')
    expect(cache.disposables.dispose('k1')).toBe(true)

    logic.unmount()
    expect(cache.disposables.dispose('k1')).toBe(false)
    expect(() => cache.disposables.add(() => () => {}, 'k2')).not.toThrow()
  })
})
