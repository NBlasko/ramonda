---
"@ramonda/css": patch
---

The VS Code extension moved out of this package, from `packages/css/vscode` to `tools/vscode-css`.
Nothing this package ships changes — `files` is `["bin.mjs", "plugin", "dist", "README.md"]` and the
extension was never in it. The marketplace identifier, the grammars and the formatter are all
unchanged.

It moved because of where it sat rather than what it is. Changesets attributes a changed path to the
package that owns it, so every extension-only edit — a readme line, a version bump — demanded a
changeset for `@ramonda/css` and a release of a tarball that had not changed. The extension is not a
workspace package, does not go to npm, and carries its own version and changelog; it was under
`packages/` only because that is where it was written.

If you referenced the folder directly, it is `tools/vscode-css`. `pnpm extension:package` from the
repository root is unchanged.
