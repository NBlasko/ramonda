# Ramonda CSS

## 0.1.1

- Rewrote the readme. It now says up front what works without anything else installed, and what
  needs `@ramonda/css` in the project.

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
