# CLAUDE.md

`kea-disposables` — a [Kea](https://keajs.org) plugin that gives every mounted logic a
`cache.disposables` manager for `useEffect`-style resource cleanup, plus automatic pause/resume of
that work while the browser tab is hidden.

Extracted from `frontend/src/kea-disposables.ts` in
[PostHog/posthog](https://github.com/PostHog/posthog), which remains its largest consumer.

## Layout

```
src/index.ts        the entire plugin — one file, no internal modules
tests/              vitest suite (jsdom by default)
  helpers.ts        context reset, document.hidden override, counters
  disposables.test.ts   unit behaviour
  integration.test.ts   a real polling logic driven with fake timers
  builder.test.ts       the disposables() builder + context-teardown behaviour
  no-dom.test.ts        `@vitest-environment node` — pins SSR safety
scripts/smoke.mjs   loads dist/ (ESM + CJS) in plain node after a build
```

## Mental model

- One `DisposablesManager` per logic, stored on `logic.cache.disposables` in the plugin's
  `afterMount`, torn down in `beforeUnmount` — but only when `logic.isMounted()` has gone false,
  because kea reference-counts mounts.
- Every manager is also registered in a module-level `globalVisibilityState.allManagers` set. A
  single `visibilitychange` listener on `document` drives pause/resume across all of them, attached
  on the first manager and detached when the set empties.
- Pausing runs each entry's cleanup; resuming re-runs its `setup`. **Setup functions must be safe
  to run more than once** — that is the core contract this plugin imposes on callers.
- `disposables()` is a thin logic builder over `add`, composed onto kea's core `afterMount`
  builder. That ordering is load-bearing and verified by test: the plugin's `afterMount` _event_
  runs before the core `afterMount` _builder_ callbacks, so the manager is already on the cache.

## Invariants worth not breaking

Each of these has a test; if you change the behaviour, change the test deliberately rather than
adjusting it to match.

- **`add` while hidden defers setup.** It registers the entry with a no-op cleanup and lets the
  next resume run setup. Without this, async work that re-arms its own timer in a `finally` starts
  a live timer on a background tab and defeats the whole pause. (`tests/integration.test.ts`)
- **`add` and `dispose` are no-ops after unmount, and the manager is never nulled off the cache.**
  Continuations that outlive the logic call them unconditionally; a null there would throw a
  `TypeError` out of a `finally` instead of doing nothing.
- **`isDisposed` is set _before_ the cleanups run**, so anything a cleanup wakes up sees an inert
  manager.
- **A remount replaces a disposed manager.** A logic whose built instance is retained keeps its
  cache, so leaving the disposed manager in place would make every subsequent `add` a silent no-op.
- **`pauseOnPageHidden: false` entries are skipped by both pause and resume.** Resuming one would
  leave two live listeners.
- **Setup/cleanup errors are caught and logged, never rethrown**, and a setup that fails on resume
  gets a no-op cleanup so the stale one can't run.
- **`beforeCloseContext` disposes everything.** `resetContext()` drops logics from the store
  without unmounting them, so `beforeUnmount` never fires; without this hook every timer and
  listener alive at reset time leaks for the rest of the page's life.

## Conventions

- oxlint + oxfmt (`pnpm lint` / `pnpm format`). Single quotes, no semicolons, 2-space indent —
  oxfmt is opinionated about the indent and does not take a width option.
- The peer range is `kea >= 3`, matching every first-party kea plugin; CI runs the suite against
  kea 3.0 (the floor), 3 stable, and the v4 `next` prerelease. Don't use kea 4-only APIs.
- Plugin `name` must be unique across activated plugins — kea throws on a duplicate. We claim
  `disposables`.
- There is no supported way to type `logic.cache.disposables` globally: kea declares `cache` as
  `Record<string, any>`, which an interface augmentation cannot narrow. `DisposablesCache` and
  `getDisposables()` are the workarounds; no first-party kea plugin does better.
- The package is dual ESM + CJS with types for both. `pnpm exec publint` and
  `pnpm exec attw --pack .` must stay clean; CI enforces both.
- No runtime dependencies, and it should stay that way.
- Nothing may touch `document` unguarded — use `hasDocument()` / `isPageHidden()`.

## Releasing

Changesets. `pnpm changeset` with every user-facing change; merging the generated "version
packages" PR publishes to npm via OIDC. See [CONTRIBUTING.md](./CONTRIBUTING.md).
