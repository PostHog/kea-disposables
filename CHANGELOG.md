# kea-disposables

## 1.0.0

### Major Changes

- 7402a76: Initial standalone release. Extracted from the [PostHog](https://github.com/PostHog/posthog)
  monorepo, where it has been running in production since October 2025, with no API changes.

  - `disposablesPlugin` gives every mounted logic a `cache.disposables` manager.
  - `add(setup, key?, options?)` runs `setup` immediately and keeps the cleanup function it
    returns. Re-adding the same key disposes the previous entry first; omitting the key
    auto-generates one.
  - `dispose(key)` tears down a single resource without unmounting the logic.
  - All registered cleanups run on the logic's final unmount — reference-counted, so a logic
    shared by two mounts is only torn down when the last one goes away.
  - Disposables pause while the tab is hidden and resume when it becomes visible again. A
    disposable added _while_ hidden is registered but not started, so async work that re-arms
    itself in the background can't defeat the pause. Opt out per disposable with
    `{ pauseOnPageHidden: false }`.
  - `add` and `dispose` are no-ops after unmount, so continuations that outlive the logic can
    call them without a null check. `isDisposed` is exposed for continuations that must also
    skip work of their own.
  - Errors thrown by a `setup` or a cleanup are caught and logged with the logic path rather
    than propagating to the caller.
  - `disposables(input)` is a logic builder for the common case of a resource whose life is the
    logic's life, so no `afterMount` is needed just to call `add`. `getDisposables(logic)` reads
    the manager back with a real type instead of `any`.
  - Closing a kea context (`resetContext()`) disposes every live manager. kea drops logics from
    the store without unmounting them there, so `beforeUnmount` never fires and every timer and
    listener would otherwise stay live — Storybook resets the context on every story mount, and
    most test setups reset between tests.
  - Ships dual ESM + CJS with types for both, and degrades to "always visible, never paused"
    where there is no DOM (SSR, node-environment test runners).

## 0.0.0

Placeholder release, published by hand to claim the name on npm so that a trusted publisher
(OIDC) could be configured against it. Not a functional release — do not install it.
