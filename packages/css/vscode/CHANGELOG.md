# Ramonda CSS blocks

## Unreleased

The first published version. Everything below has been in the repository and installed by hand.

- **Syntax colouring** for `@@( … )` blocks, in every position one can be written: a bare JSX
  attribute, `css={@@( … )}`, and a plain value. CSS is coloured as CSS, a `{ … }` hole as
  TypeScript, and `@@if ({ … })` and `...{ … }` as this language's own.
- **Diagnostics** from `@ramonda/css`'s own rules, under the character rather than at the block —
  the same rules the build runs, so the editor and the build never disagree.
- **Formatting** of the CSS inside a block, through the package's formatter.
- **Completions** for property names and values inside a block, and TypeScript's own inside a hole.
