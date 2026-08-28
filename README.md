# kea-disposables

[![npm](https://img.shields.io/npm/v/kea-disposables.svg)](https://www.npmjs.com/package/kea-disposables)
[![CI](https://github.com/PostHog/kea-disposables/actions/workflows/ci.yml/badge.svg)](https://github.com/PostHog/kea-disposables/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/kea-disposables.svg)](./LICENSE)

A [Kea](https://keajs.org) plugin for automatic resource cleanup, with smart pause/resume on tab
visibility.

Register a timer, listener or subscription with a setup function that returns a cleanup function —
the same shape as `useEffect`. The plugin runs the cleanup when the logic unmounts, so you never
write a `beforeUnmount` whose only job is to `clearInterval`. As a bonus, background work stops
while the tab is hidden and picks back up when the user returns.

Extracted from the [PostHog](https://github.com/PostHog/posthog) monorepo, where it runs across
several hundred logics in production.

## Install

```bash
pnpm add kea-disposables
# npm install kea-disposables
# yarn add kea-disposables
```

`kea` (>= 3, including the v4 prereleases) is a peer dependency — the same range every
first-party kea plugin declares.

## Register the plugin

```typescript
import { resetContext } from 'kea'
import { disposablesPlugin } from 'kea-disposables'

resetContext({
  plugins: [disposablesPlugin],
  createStore: true,
})
```

Every logic mounted from that point on gets a `cache.disposables` manager. There is nothing to add
per-logic.

## Use it

```typescript
import { actions, kea, listeners, path } from 'kea'

const pollingLogic = kea([
  path(['scenes', 'pollingLogic']),
  actions({ startPolling: true, stopPolling: true, poll: true }),
  listeners(({ actions, cache }) => ({
    startPolling: () => {
      cache.disposables.add(() => {
        // Setup runs immediately…
        const id = setInterval(() => actions.poll(), 5000)
        // …and returns the cleanup, exactly like a useEffect.
        return () => clearInterval(id)
      }, 'poller')
    },
    stopPolling: () => {
      cache.disposables.dispose('poller')
    },
  })),
])
```

No `beforeUnmount` needed: unmounting `pollingLogic` clears the interval.

### Or declare them on the logic

For a resource whose whole life is the logic's life, the `disposables` logic builder saves you
writing an `afterMount` just to call `add`:

```typescript
import { kea, path } from 'kea'
import { disposables } from 'kea-disposables'

const myLogic = kea([
  path(['scenes', 'myLogic']),
  disposables(({ actions }) => ({
    poller: () => {
      const id = setInterval(() => actions.poll(), 5000)
      return () => clearInterval(id)
    },
    crossTabSync: {
      setup: () => {
        const handler = () => actions.sync()
        window.addEventListener('storage', handler)
        return () => window.removeEventListener('storage', handler)
      },
      options: { pauseOnPageHidden: false },
    },
  })),
])
```

The keys are ordinary disposable keys, so `dispose('poller')` still stops it early and re-adding
`'poller'` still replaces it. Anything conditional, or re-armed later, still wants
`cache.disposables.add(...)` from a listener.

## API

### The manager — `logic.cache.disposables`

Every mounted logic has one. These are its methods.

#### `add(setup, key?, options?)`

| Argument  | Type                              | Notes                                                                                |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `setup`   | `() => () => void`                | Runs immediately. **Must** return a cleanup function.                                |
| `key`     | `string` (optional)               | Re-adding the same key disposes the previous entry first. Auto-generated if omitted. |
| `options` | `{ pauseOnPageHidden?: boolean }` | Defaults to `{ pauseOnPageHidden: true }`.                                           |

Returns nothing.

#### `dispose(key)`

Tears down one resource without unmounting the logic. Returns `true` if something was disposed,
`false` if the key was unknown (or the logic has already unmounted).

#### `isDisposed`

`true` once the logic has begun its final unmount, or once the kea context it belonged to was
closed. See [After unmount](#after-unmount).

### Module exports

#### `disposablesPlugin`

The plugin object. Pass it to `resetContext({ plugins: [...] })`; that is the only setup step.

#### `disposables(input)`

Logic builder. `input` is a record of key → setup function, or key → `{ setup, options }`; it may
also be a function of the logic, so setups can reach `actions`. Registers each entry when the
logic mounts.

#### `getDisposables(logic)`

Reads the manager off a logic with a real type rather than `any`, for code outside the logic's
own builders. See [TypeScript](#typescript).

## Choosing a key

- **No key** — fire-and-forget, cleaned up only on unmount. Fine for a one-shot listener registered
  in `afterMount`.
- **Named key** — needed when you'll `dispose(key)` later to stop it early, or when the same setup
  may be re-added and each call should replace the previous one (spam-replacement, e.g. a
  debounce-ish `setTimeout` re-armed on every keystroke).

```typescript
// Each call with the same key replaces the previous timer.
showSeekIndicator: () => {
  cache.disposables.add(() => {
    const id = setTimeout(() => actions.hideSeekIndicator(), 600)
    return () => clearTimeout(id)
  }, 'seekIndicatorTimer')
}
```

## Pause on hidden tabs

By default every disposable is torn down when the page becomes hidden and set up again when it
becomes visible. For polling, animation tickers and hover timers this is what you want — a
background tab stops burning CPU and network.

The setup function is re-run on resume, so it must be safe to call more than once. A disposable
added _while_ the page is hidden is registered but **not** started; its setup is deferred to the
next visibility change. That is deliberate: without it, async work that re-arms its own timer in a
`finally` would quietly defeat the pause.

Opt out only when the resource must keep firing while hidden:

```typescript
cache.disposables.add(
  () => {
    const handler = () => actions.syncFromOtherTab()
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  },
  'crossTabSync',
  { pauseOnPageHidden: false },
)
```

Good candidates for opting out:

- Events that genuinely fire on a hidden tab — `storage`, `online`/`offline`, `message` from
  workers or other windows
- A `visibilitychange` listener of your own — observing hide/show is the whole point
- Anything the user expects to keep running in the background

`popstate` is _not_ one of them: it only fires on user-initiated navigation, so it can't fire on a
hidden tab and the default pause is fine.

## After unmount

`add` and `dispose` become no-ops once the logic unmounts, so an async continuation that resumes
after teardown can call them plainly — no `?.`, no null check. The manager is never null after
mount.

Usually such a continuation has to skip more than the disposable, though; dispatching an action or
reading `values` on a torn-down logic is its own bug. Branch on `isDisposed` for that:

```typescript
// The teardown aborted this request, so the catch can resume after the unmount.
if (cache.disposables.isDisposed) {
  return
}
actions.connectionErrored(reason)
```

This matters most in a `finally`.

Two caveats:

- **A logic that mounts again gets a fresh manager.** A continuation left over from the previous
  life can reach `cache.disposables` and find a live one, where `isDisposed` reads `false` — and
  disposing a shared key from there tears down the _new_ life's resource. Capture what the
  continuation needs while the logic is alive when that matters.
- **Replacing the kea context is handled, but it disposes rather than unmounts.** `resetContext()`
  drops every logic from the store without unmounting it, so `beforeUnmount` never fires. The
  plugin hooks `beforeCloseContext` and tears every live manager down there, so cleanups do run
  and `isDisposed` does flip. What does _not_ happen is the logic's own `beforeUnmount`, so a
  timer callback that reads `values` should still compare `getContext()` against the context the
  resource was set up in.

## Errors

A `setup` that throws is logged with the logic path and leaves no entry behind — the call site does
not see the exception. A cleanup that throws is logged too, and the remaining cleanups still run.
If a setup throws while resuming from a hidden tab, its cleanup is replaced with a no-op so the
stale one can't run against a resource that was never re-created.

## No DOM?

Importing and mounting works without a `document` (SSR prerender, a node-environment test runner).
Visibility handling degrades to "always visible, never paused" — nothing is deferred and no
listener is attached.

## TypeScript

Kea types `cache` as `Record<string, any>`, so `cache.disposables.add(...)` already compiles; it
just isn't checked. Annotate the destructured `cache` to get real completions:

```typescript
import type { DisposablesCache } from 'kea-disposables'

listeners(({ cache }: { cache: DisposablesCache }) => ({
  // cache.disposables is fully typed here
}))
```

From outside the logic, `getDisposables(logic)` returns a typed `DisposablesManager`:

```typescript
import { getDisposables } from 'kea-disposables'

getDisposables(myLogic).dispose('poller')
```

There is no module augmentation that would type `cache.disposables` globally: kea declares
`cache` as `Record<string, any>`, and an interface augmentation cannot narrow an already-declared
property. No first-party kea plugin does it either.

`DisposablesManager`, `DisposableOptions`, `DisposablesInput`, `DisposableDefinition`,
`SetupFunction` and `DisposableFunction` are exported too.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
