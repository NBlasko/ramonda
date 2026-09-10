# Ramonda CSS

## 0.1.2

- A conditional group is written `if ({ … })`. It was `@@if`, and `@@` now opens a style block and
  nothing else — inside one, the language is the block's own and spells itself without a sigil, as
  `{ … }` and `...{ … }` already did.

## 0.1.1

- Rewrote the readme. It says up front what works with nothing else installed, and what needs
  `@ramonda/css` in the project.
- Documented the two formatter routes separately. A project on Prettier adds
  `@ramonda/css/prettier` to its Prettier config and leaves `editor.defaultFormatter` alone; only a
  project on biome points the setting at this extension, and in the project's own
  `.vscode/settings.json`.

## 0.1.0

First release.

- **Syntax colouring** for `@@( … )` style blocks, in each position one can be written: a bare JSX
  attribute, `css={@@( … )}`, and a plain value. CSS is coloured as CSS, a `{ … }` hole as
  TypeScript, and `@@if ({ … })` and `...{ … }` as the block language's own.
- **Formatting** of the CSS inside a block, through the project's own `ramonda-css`.
- **Diagnostics** from the same rules the build runs, reported under the character rather than on
  the whole block.
- **Completions** for property names and values inside a block, and TypeScript's own inside a hole.

Formatting, diagnostics and completions need `@ramonda/css` in the project.
