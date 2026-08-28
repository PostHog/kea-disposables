# Contributing

## Setup

```bash
pnpm install
```

Node 22+ and pnpm 10 for development (see `.nvmrc` and the `packageManager` field). The
published package itself supports Node 20+.

## Working on it

```bash
pnpm test          # vitest, against src/
pnpm test:watch
pnpm typecheck
pnpm lint          # oxlint + oxfmt --check
pnpm format        # oxfmt --write
pnpm build         # tsdown -> dist/ (ESM + CJS + types)
pnpm test:dist     # smoke-test the built artifacts (run after build)
```

The test suite runs under jsdom because the plugin listens for `visibilitychange`.
`tests/no-dom.test.ts` opts back out with a `@vitest-environment node` pragma to pin the
SSR-safe behaviour; keep it that way.

## Making a change

1. Branch off `main`.
2. Make the change, with a test that fails without it.
3. Run `pnpm changeset` and pick a bump type. Commit the generated file — the release pipeline
   reads it, and a change that lands without one never gets released. Nothing enforces this, so
   it is on the author and the reviewer to notice. A PR that genuinely needs no release (docs,
   CI, a dev-dependency bump) needs no changeset at all.
4. Open a PR.

Bump types:

- **patch** — bug fix, no API change
- **minor** — new option, new export, backwards-compatible behaviour change
- **major** — anything that could break a consumer, including a behaviour change subtle enough
  that a logic relying on the old semantics would silently misbehave

## Compatibility

The peer range is `kea >= 3.1.0`. CI runs the suite against both the kea 3 stable line and the
`next` (v4 prerelease) tag; both have to pass. Don't reach for kea 4-only APIs without widening
the peer range and saying so in a changeset.

## Releasing

Maintainers only, and mostly automatic:

1. Changesets on `main` cause the Release workflow to open a **"chore: version packages"** PR
   with the version bump and the `CHANGELOG.md` entry.
2. Review it — the changelog in that PR is what ships.
3. Merge it. The workflow publishes to npm via trusted publishing (OIDC, no token in the repo)
   and creates the GitHub release and tag.

Repo settings this depends on:

- **Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and
  approve pull requests"** must be ticked. Without it the version PR fails with
  `GitHub Actions is not permitted to create or approve pull requests`, no matter what the
  workflow's `permissions:` block says. This can also be disabled org-wide, which overrides the
  repo setting.
- The "Read and write permissions" radio above that checkbox is _not_ required — the release
  workflow declares its own job-level `permissions:` block, which takes precedence over the
  repository default. Leaving the default read-only is fine.
- npm trusted publishing configured for `kea-disposables` (see below).
- If `main` is protected with required status checks, don't require any of this repo's own CI
  jobs. GitHub does not run workflows for pull requests opened by `GITHUB_TOKEN`, so none of
  them run on the "chore: version packages" PR, and a job that never runs never reports success
  — requiring one would permanently block every release. The version PR only ever contains a
  version bump and a `CHANGELOG.md` entry, both generated from code that already passed CI on
  `main`.

### npm trusted publishing (OIDC)

On npmjs.com, on the `kea-disposables` package: **Settings → Trusted Publishing → GitHub Actions**.

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| Organization or user | `PostHog`                                                              |
| Repository           | `kea-disposables`                                                      |
| Workflow filename    | `release.yml` — **filename only**, not `.github/workflows/release.yml` |
| Environment name     | leave blank — this workflow doesn't use a GitHub environment           |
| Allowed actions      | `npm publish` (that's what `changeset publish` shells out to)          |

Then **Settings → Publishing access → "Require two-factor authentication and disallow tokens"**.
Trusted publishing is exempt from that, so CI keeps working while long-lived automation tokens
stop being accepted. Note this also stops manual `npm publish` from a laptop using a token, which
is the point — after the 1.0.0 bootstrap, every release goes through the workflow.

No secret is added to the repository. `id-token: write` on the release job plus the npm-side
config is the whole mechanism.

Trusted publishing needs npm >= 11.5.1 on Node >= 22.14.0. The workflow runs Node 24 and does
`npm install -g npm@latest` before publishing, so both are satisfied — that step is load-bearing,
don't drop it.

### The 1.0.0 release

A trusted publisher is configured from a package's settings page on npmjs.com, which only exists
once the package does — so a placeholder `0.0.0` was published by hand to claim the name, and the
trusted publisher configured against it. That is a one-time bootstrap and is already done.

`package.json` therefore sits at `0.0.0`, matching the registry, and `.changeset/initial-release.md`
carries a `major` bump. So 1.0.0 ships through the ordinary flow rather than around it: the Release
workflow opens the version PR, merging it applies the bump and writes the `CHANGELOG.md` entry, and
the publish that follows uploads `1.0.0`.

## Relationship to the PostHog monorepo

This package was extracted from `frontend/src/kea-disposables.ts` in
[PostHog/posthog](https://github.com/PostHog/posthog). The monorepo is the largest consumer, so
changes here should stay compatible with how it uses the plugin; land breaking changes as a major
and update the monorepo alongside.
