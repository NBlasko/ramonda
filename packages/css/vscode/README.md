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

**Diagnostics, completions and formatting** come from
[`@ramonda/css`](https://www.npmjs.com/package/@ramonda/css) in the project, which is where the
compiler lives. Install it and turn the language plugin on in `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

A plugin only loads when the editor is running the workspace's own TypeScript: **TypeScript: Select
TypeScript Version → Use Workspace Version**.

## The setting the editor needs

VS Code runs two TypeScript servers, and only one of them loads language plugins. The other reads
your file as plain TypeScript, which a style block is not, so turn it off:

```json
{ "typescript.tsserver.useSyntaxServer": "never" }
```

## Format on save

**Using Prettier, keep Prettier.** `@ramonda/css` ships a Prettier plugin, so your editor's usual
formatter handles these files with nothing else to configure:

```json
{ "plugins": ["@ramonda/css/prettier"] }
```

Leave `editor.defaultFormatter` alone. Prettier formats the whole file, blocks and all.

**Using biome, this extension is the formatter.** biome has no plugin surface for a syntax it cannot
parse, so the formatting goes through `ramonda-css`, which runs your biome with your configuration.
Put this in the project's own `.vscode/settings.json` rather than in your global settings — it is a
choice about this project, and a workspace setting is what other people on the project get too:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.css" },
  "editor.formatOnSave": true
}
```

Safe to set for a whole language rather than a folder: a file with no block is passed straight to
biome, and a project without `@ramonda/css` is left untouched.

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

**[Style blocks](https://ramonda.dev/style-blocks)** — the syntax in full, what a block compiles to,
and how to set up a build. Start there if you have not written one yet.
