# Changesets

Every user-facing change needs a changeset. Run `pnpm changeset`, pick a bump type, and commit the
generated markdown file alongside your change.

The release pipeline consumes these: once a changeset lands on `main`, a "Version Packages" PR is
opened (or updated) with the version bump and the `CHANGELOG.md` entry. Merging that PR publishes
to npm.

See [the changesets docs](https://github.com/changesets/changesets) for the full format.
