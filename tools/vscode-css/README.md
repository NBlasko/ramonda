# Ramonda CSS

Real CSS beside your markup, coloured as CSS.

A **style block** is `@@( … )`, and what goes inside it is CSS — properties, values, nested rules,
at-rules — with `{ … }` holes for TypeScript expressions. This extension colours them, and formats
them on save.

![A style block coloured by this extension: properties, values, a nested rule, a `$` variable and a
TypeScript hole, each its own colour](https://raw.githubusercontent.com/NBlasko/ramonda/main/tools/vscode-css/preview.png)

*The picture is here because the code below cannot be: this page is rendered by the marketplace's own
highlighter, which has no way to load the grammars this extension is made of. It is generated from
those grammars, so it cannot drift from what you get.*

```tsx
<div css={@@(
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

## Both TypeScript servers see your blocks

VS Code runs two TypeScript servers. One of them never opens your `tsconfig.json`, where the
`@ramonda/css` plugin is named — and that is the server that formats, folds and outlines your file
for as long as the editor is open. It used to read a style block as plain TypeScript.

This extension contributes the plugin a second way, which VS Code hands to both servers. Nothing to
configure, and `js/ts.tsserver.useSyntaxServer` can come out of your settings.

A project that installs `@ramonda/css` is still checked by its own copy: the plugin in here steps
aside wherever the project has one, so the version you pinned is the version that decides what is an
error.

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

`editor.defaultFormatter` names the one extension VS Code asks for that language, and it does not
fall through to another — so it reaches every project it is in scope for. In a project that formats
with Prettier it runs biome; in a project without `@ramonda/css` it has no command to run and returns
no edits, so format-on-save does nothing and neither Prettier nor biome is asked.

Inside a project that uses biome it covers a whole language rather than a folder: a file with no
block is passed straight to biome, with that project's own configuration.

## Where the colours apply

**Everywhere a block is a value**, which since `@ramonda/css@0.2.0` is everywhere a block can be
written — any attribute, any line, and outside JSX entirely:

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

Both are the same value and compile to the same class.

**A bare `css=@@( … )`, with no braces, is still coloured here** — this extension is a grammar and a
grammar does not decide what compiles. `@ramonda/css` refuses that spelling from `0.2.0`: a block is
a TypeScript value and a bare attribute is the one shape only JSX has. The red line comes from the
language-service plugin, under the attribute name, and names the spelling to write.

## Other editors

The grammars in `grammar/` are plain TextMate JSON. Any editor that accepts a TextMate injection can
load them, keyed on `source.ts`, `source.tsx`, `source.js` and `source.js.jsx` — and `source.css`
for the holes.

## Read next

**[Style blocks](https://ramonda.dev/style-blocks)** — the syntax in full, what a block compiles to,
and how to set up a build. Start there if you have not written one yet.
