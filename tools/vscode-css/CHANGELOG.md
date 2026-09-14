# Ramonda CSS

## 0.1.4

- **Corrected the formatter advice, which said the wrong thing about a global setting.** It read
  *"safe to set for a whole language"*; `editor.defaultFormatter` decides which extension VS Code
  asks and does not fall through, so set in user settings it makes format-on-save silently do nothing
  in every project without `@ramonda/css`, and runs biome in a project that formats with Prettier.
  The setting belongs in the project's own `.vscode/settings.json`, and the page now says why.

## 0.1.3

- Rewrote *Where the colours apply*. `@ramonda/css@0.2.0` refuses a block written as a bare
  `css=@@( … )` attribute — a block is a TypeScript value, and a bare attribute is the one shape only
  JSX has. Nothing in this extension changes: it still colours that spelling, because a grammar
  colours and does not decide what compiles, and taking it out would spread the error to the end of
  the file. The red line comes from the language-service plugin, under the attribute name.

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
