---
title: In the browser
description: On the Vite dev server, a rule points at the line that wrote it and an element names the blocks that gave it its classes. Nothing to install.
section: Style blocks
order: 118
---

# In the browser

A class like `r-pl-8px` says what it sets, and not where you wrote it. On the **Vite dev server**
the page carries both answers, and your browser's own developer tools read them — there is no
extension to install.

- **From a rule to the line** — every rule has a source map.
- **From an element to its blocks** — every element names the blocks its classes came from.

Neither exists in a production build.

## From a rule to the line that wrote it

Select an element and look at its styles. Beside each rule the panel shows your file and line —
`Card.tsx:14` — rather than the generated stylesheet, and clicking it opens the file at the
declaration. A longhand split out of a shorthand points at the shorthand you wrote: `.r-pl-8px`
opens on `padding: 8px`.

This is a CSS source map, the same mechanism that takes you from compiled JavaScript to your
TypeScript. The plugin turns on Vite's `css.devSourcemap` for it; set that to `false` in your Vite
config to turn the maps off.

**A class written in more than one place points at each of them.** A rule is shared by every element
that carries its class, so `.r-disp-flex` written in two files is one rule with two origins. Each
file's stylesheet holds its own copy, pointing at its own line, and the panel lists every copy that
applies — your element's own file is among them, though not always on top. Written twice in one file,
the class points at the first.

## From an element to its blocks

Every block adds one class that names where it was written, `r:src:` and then the file and line:

```html
<div class="r:src:src/Card.tsx:10 r-c-blue r:src:src/Page.tsx:22">
```

That element merged a block from `Card.tsx` with one its parent sent from `Page.tsx`, so it names
both — two blocks used side by side are equal, and each is named.

**A spread leaves no mark.** A block that spreads `...$(base)` names its own line, not `base`'s:
what you look for is where a block was used, and `base` is part of that block.

These classes have no rule and are not keys, so they style nothing and the merge treats them like a
class of your own. The path is from your project's root.

## Where they exist

| | source maps | `r:src:` classes |
|---|---|---|
| `vite`, in any mode | yes | yes |
| `vite build` | no | no |
| a test run (Vitest) | — | no |
| the esbuild plugin | no | no |

A test run has no marks so that a test comparing a whole `className` sees the classes a build ships.

## Next

- **[Project settings](/style-blocks/settings)** — what each part of a class name means.
- **[Shorthands](/style-blocks/shorthands)** — why one declaration can be several classes.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, and other JSX libraries.
