---
title: Tooling, and what it does not do
description: Why your formatter and linter cannot read a file holding a block, what to run instead, and using a block in another JSX library.
section: Style blocks
order: 112
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

The compiled value is a value, and this framework's `css` prop is only one way to apply it. One
exported function turns it into what any library already understands:

```tsx
import { toStyleObject } from "@ramonda/css";

const panel = @@(
  display: flex;
  gap: 8px;
);

const row = <div {...toStyleObject(panel)}>a row</div>;
```

`toStyleObject` returns `{ className, style }` — the generated class, and one entry per hole. There
is no wrapper component to write and nothing to copy.

**It does two things a spread cannot do for itself**, and both are why it exists rather than
`{ className: value.className, style: … }` written by hand. A hole whose value is missing is left
out, rather than written as the text `undefined`, which is a value CSS keeps. And a value holding a
`;` is refused, because a spread ends up in a `style` attribute and a server-rendered page is parsed
back from HTML — measured, such a value came out of that round trip as real, applied declarations.

**What you give up by spreading**, and it is why this framework has a prop instead: `className` and
`style` become ordinary props, so the block's class merges with whatever else writes `className` by
whoever wrote it last, and its custom properties collide with an author's own `style`. The `css` prop
is one writer of one attribute, which is a race nobody has to think about.

## What it does not do

**It is not CSS-in-JS.** Nothing about a block is JavaScript: it is compiled away before the bundle,
the class exists in a file the browser can cache, and no style is rebuilt on a render.

**It does not scope your other CSS.** A `className` is still the string you wrote, and the class in
your source is the class in the served HTML — see [styling](/styling).

**It is not a theme system.** A theme is custom properties, which needs nothing from the compiler —
see [names the stylesheet sees](/style-blocks/variables#theming).

**It does not decide anything from the order of your classes.** Nothing can — the order of names in a
`class` attribute has no meaning in CSS, which is exactly why composition merges maps rather than
concatenating class names. What decides is where you wrote something, and that is the whole point.

## Read next

- [Styling](/styling) — `className`, `style`, and where stylesheets come from.
- [Performance](/performance) — why a value built in the markup costs more than it looks.
- [JSX](/concepts/jsx) — the rest of the attribute surface.
- [Diagnostics](/reference/diagnostics#rmd062-a-style-block-was-applied-with-no-values-for-its-holes)
  — what the runtime says when a value reaches it that no transform produced.
