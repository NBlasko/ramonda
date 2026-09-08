# Ramonda CSS blocks

## 0.1.1

- The readme said *not published yet* on the page of a published extension, and pointed at a package
  that is not on npm without saying so. What works on its own — the colours — is now said plainly,
  and so is what waits for `@ramonda/css`.

## 0.1.0

The first published version. Everything below has been in the repository and installed by hand.

- **Syntax colouring** for `@@( … )` blocks, in every position one can be written: a bare JSX
  attribute, `css={@@( … )}`, and a plain value. CSS is coloured as CSS, a `{ … }` hole as
  TypeScript, and `@@if ({ … })` and `...{ … }` as this language's own.
- **Diagnostics** from `@ramonda/css`'s own rules, under the character rather than at the block —
  the same rules the build runs, so the editor and the build never disagree.
- **Formatting** of the CSS inside a block, through the package's formatter.
- **Completions** for property names and values inside a block, and TypeScript's own inside a hole.
