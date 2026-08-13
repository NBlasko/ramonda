# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).
It is how versions and changelogs for the `@ramonda/*` packages are decided.

## The flow

1. **In a PR that changes a package**, add a changeset:

   ```sh
   pnpm changeset
   ```

   Pick the affected packages, choose `patch` / `minor` / `major` for each, and
   write a short line describing the change for the changelog. This writes a
   markdown file here — commit it with your PR.

2. **On merge to `main`**, the release workflow opens (or updates) a
   **"Version Packages"** PR that consumes the pending changesets: it bumps every
   affected package's version and rewrites its `CHANGELOG.md`.

3. **Merging that PR** publishes the bumped packages to npm (versions already on
   npm are skipped).

A change with no user-facing effect (a test, CI, docs) needs no changeset — run
`pnpm changeset --empty` if you want the check to pass explicitly.

Private packages (`apps/*`, `@ramonda/theme`) are ignored automatically.
