# Ramonda CSS

Real CSS beside your markup, coloured as CSS.

A **style block** is `@@( … )`, and what goes inside it is CSS — properties, values, nested rules,
at-rules — with `{ … }` holes for TypeScript expressions. This extension colours them, and formats
them on save.

```tsx
<div css=@@(
  display: flex;
  gap: 8px;
  border-left: 4px solid {this.accent};
  &:hover {
    border-left-color: #00b37e;
  }
)>
  <span>Panel</span>
</div>
```

The CSS is coloured as CSS, `{this.accent}` as TypeScript, and `&:hover` as a selector.

## Install

```bash
code --install-extension ramonda.css
```

Or search **Ramonda CSS** in the Extensions panel. Reload the window and the colours are there —
nothing to configure, and nothing to add to a project.

## What you get

**Colours** work on their own, in `.ts`, `.tsx`, `.js` and `.jsx`.

**Formatting, diagnostics and completions** need [`@ramonda/css`](https://ramonda.dev/style-blocks)
in the project. That package is not on npm yet, so today this extension is the colours.

## Two settings

**One the editor needs.** VS Code runs two TypeScript servers, and only one of them loads language
plugins; the other reads your file as plain TypeScript, which a style block is not. Turn it off:

```json
{ "typescript.tsserver.useSyntaxServer": "never" }
```

**One for formatting**, once the project has `@ramonda/css`:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.css" },
  "editor.formatOnSave": true
}
```

Safe to set for a whole language: a file with no block goes straight through your own formatter, and
a project without `@ramonda/css` is left alone.

Formatting runs the project's own `ramonda-css`, with the project's own biome or prettier
configuration — so saving a file produces what `pnpm format` produces.

## Where the colours apply

A bare `css=@@( … )` attribute is coloured when it is the **first attribute, on the tag name's own
line**:

```tsx
<div css=@@(
  display: flex;
)>…</div>
```

VS Code stops consulting grammar injections once it is inside a tag's attribute list, so a bare
block written after another attribute is not coloured. Write the block as a value and the limit is
gone — any attribute, any line:

```tsx
<div
  id="panel"
  onclick={this.open}
  css={@@(
    display: flex;
  )}
>…</div>
```

Blocks outside JSX are coloured wherever they are:

```tsx
const panel = @@( display: flex; );
```

Colour is the only difference between the two spellings. A block compiles and is checked the same
way whichever one you write.

## Other editors

The grammars in `grammar/` are plain TextMate JSON. Any editor that accepts a TextMate injection can
load them, keyed on `source.ts`, `source.tsx`, `source.js` and `source.js.jsx` — and `source.css`
for the holes.

## Read next

**[Style blocks](https://ramonda.dev/style-blocks)** is the one page to read: the syntax, what a
block compiles to, and how to set up a build. Start there if you have not written one yet.
