/**
 * Smoke-tests the built artifacts in `dist/`, which is what actually ships — the vitest suite
 * runs against `src/`. Checks that both the ESM and the CJS entrypoint load in plain node (no
 * DOM) and expose a usable plugin. Run after `pnpm build`.
 */
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)

const esm = await import('../dist/index.mjs')
const cjs = require('../dist/index.cjs')

for (const [label, mod] of [
  ['esm', esm],
  ['cjs', cjs],
]) {
  assert.equal(typeof mod.disposablesPlugin, 'object', `${label}: disposablesPlugin is not exported`)
  assert.equal(mod.disposablesPlugin.name, 'disposables', `${label}: unexpected plugin name`)
  assert.equal(typeof mod.disposablesPlugin.events.afterMount, 'function', `${label}: afterMount missing`)
  assert.equal(
    typeof mod.disposablesPlugin.events.beforeUnmount,
    'function',
    `${label}: beforeUnmount missing`,
  )
  assert.ok(
    !('default' in mod && label === 'cjs' && typeof mod.default === 'object'),
    `${label}: unexpected default export`,
  )
}

// Mount a real logic through the built ESM artifact, in node, with no DOM.
const { kea, path, resetContext } = await import('kea')
resetContext({ plugins: [esm.disposablesPlugin], createStore: true })

const logic = kea([path(['smoke', 'logic'])]).build()
logic.mount()

let cleanedUp = false
logic.cache.disposables.add(
  () => () => {
    cleanedUp = true
  },
  'resource',
)
assert.ok(logic.cache.disposables.registry.has('resource'), 'disposable was not registered')

logic.unmount()
assert.ok(cleanedUp, 'cleanup did not run on unmount')
assert.equal(logic.cache.disposables.dispose('resource'), false, 'dispose() is not inert after unmount')

// The builder path goes through kea's core afterMount builder — exercise it from dist too.
const { path: keaPath } = await import('kea')
resetContext({ plugins: [esm.disposablesPlugin], createStore: true })
let builderCleanedUp = false
const builderLogic = kea([
  keaPath(['smoke', 'builderLogic']),
  esm.disposables({
    resource: () => () => {
      builderCleanedUp = true
    },
  }),
]).build()
builderLogic.mount()
assert.ok(
  esm.getDisposables(builderLogic).registry.has('resource'),
  'builder did not register the disposable',
)
builderLogic.unmount()
assert.ok(builderCleanedUp, 'builder cleanup did not run on unmount')

console.log('smoke: dist ESM + CJS entrypoints OK')
