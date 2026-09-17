---
"@ramonda/css": minor
---

The editor says when nothing in the project can compile a style block.

The plugin is contributed by the VS Code extension as well as by a `tsconfig.json`, so it answers in
projects that have no `@ramonda/css` at all. Those projects cannot compile a block — a build stops
at `Expected identifier but found "@"` — and an editor that only reported the CSS was promising a
page the build would refuse.

One diagnostic now says so, on the block, beside the CSS reports rather than instead of them:

> `[no-compiler]` nothing in this project compiles a style block, so a build will refuse this file.

That shape is TypeScript's own, measured rather than recalled. JSX in a project with no `jsx` option
is not met with silence and not with a broken parse — it is parsed, it is checked, and one more
diagnostic names what is missing:

```
TS17004: Cannot use JSX unless the '--jsx' flag is provided.
TS7026:  JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements' exists.
```

A project that names the plugin in its own `tsconfig.json` has the package by definition and never
sees the line.
