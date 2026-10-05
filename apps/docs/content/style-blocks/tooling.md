---
title: Tooling, and what it does not do
description: Why your formatter and linter cannot read a file holding a block, what to run instead, and using a block in another JSX library.
section: Style blocks
order: 119
---

# Tooling, and what it does not do

## Formatters and linters

No tool that parses TypeScript can read a file holding a block until it is taught, and each of them
refuses rather than mangles — which is the safe half, and useless on its own:

| tool | what it says |
|---|---|
| biome | *Code formatting aborted due to parsing errors* |
| Prettier | *SyntaxError: ')' expected* |
| oxlint | refuses at the parse step |
| esbuild, `tsc` | refuse at the parse step |

A suppression comment cannot help either: `biome-ignore` is read **by** the parser that already
failed.

**Prettier gets a plugin.** Add it to your Prettier config and formatting works everywhere, including
the format-on-save your editor does for you:

```json
{ "plugins": ["@ramonda/css/prettier"] }
```

It lays out the CSS inside a block exactly as `ramonda-css format` does — one declaration to a line,
`} else {`, the arms of a `match` lined up — so the two formatters never disagree about a block.

**biome and oxlint get wrappers**, because they have no plugin surface for a syntax they cannot
parse:

```bash
ramonda-css format src        # your biome, your config
ramonda-css lint src          # your oxlint, your rules
```

Each replaces every block with something that parses, runs your own tool, and puts the block back at
the indentation the tool chose. **Exclude the files that hold a block from those tools' own runs**,
or they refuse the file before a wrapper can help.

And the editor formats the buffer, not the file. `ramonda-css format --stdin-file-path <path>` is
what the extension runs: an editor asks a formatter about the text on screen, and a formatter pointed
at a path would format what was last saved and hand back edits computed against text you have since
changed.

## In another JSX library

The compiled value is a **string** — the classes, space separated — so it goes on `className`, here
and anywhere else:

```tsx
const panel = @@(
  display: flex;
  gap: 8px;
);

const row = <div className={panel}>a row</div>;
```

There is no adapter to import, no wrapper component to write and nothing to copy: a block carries no
value of its own for a `style` attribute, only classes.

**A block beside a class of your own goes through `mergeClassNames`:**

```tsx
import { mergeClassNames } from "@ramonda/css";

const row = <div className={mergeClassNames("lead", @@( display: flex; ))}>a row</div>;
```

Not a template literal. `` `lead ${@@( … )}` `` is text to the compiler — a block in one is found by
nothing at all — so it is **reported** rather than compiled to silence.

**A value you set yourself still goes through `toStyle`**, and that is where the one rule lives: a
value holding a `;` is refused rather than written, because a `style` attribute is parsed back out of
HTML on a server-rendered page, and such a value would come out of that round trip as real, applied
declarations.

## What it does not do

**It is not CSS-in-JS.** Nothing about a block is JavaScript: it is compiled away before the bundle,
the class exists in a file the browser can cache, and no style is rebuilt on a render.

**It does not scope your other CSS.** A `className` is still the string you wrote, and the class in
your source is the class in the served HTML — see [styling](/styling).

**It is not a theme system.** A theme is custom properties, and switching one is an attribute on
`<html>` — no render, no JavaScript per element, and nothing here to configure. The compiler can
declare the tokens for you and check that you read them by the right name, which is a different job
from owning them — see [names the stylesheet sees](/style-blocks/variables#theming).

**It does not decide anything from the order of your classes.** Nothing can — the order of names in a
`class` attribute has no meaning in CSS, which is exactly why composition keeps ONE class per thing
set rather than concatenating class names. What decides is where you wrote something, and that is the
whole point.

## Read next

- [Styling](/styling) — `className`, `style`, and where stylesheets come from.
- [Performance](/performance) — why a value built in the markup costs more than it looks.
- [JSX](/concepts/jsx) — the rest of the attribute surface.
- [Diagnostics](/reference/diagnostics)
  — what the runtime says when a value reaches it that no transform produced.
