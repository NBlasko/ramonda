# Ramonda CSS blocks — editor colours

> **The whole story is one page**: [Style blocks](https://ramonda.dev/style-blocks) — what the syntax
> is, what it compiles to, and every tool that has to be taught about it. This README is the part that
> is about this extension.

Syntax colours for `css=@@( … )` style blocks, in `.ts`, `.tsx`, `.js` and `.jsx`.

```tsx
<div css=@@( display: flex; color: {{accent}}; )>…</div>
```

Without it, an editor colours a block with whatever its TypeScript grammar makes of `@@( … )`, which
is an error — and the mistake runs to the end of the file, so code far below a block looks broken too.

## Where it works

A block is coloured when it is the **first attribute, on the tag name's own line**:

```tsx
<div css=@@(
  display: flex;
)>…</div>
```

Written any other way — after another attribute, or on the line below the tag name — it is left as the
editor's TypeScript grammar makes of it, which is an error. That is not this grammar's choice: an
editor stops consulting injections the moment it enters a tag's attribute list. Measured with a
grammar that does nothing but match one word, it colours a first attribute and is never asked about a
second. The block itself still compiles and is still checked either way; only the colours are lost.

**The way round it is to write the block as a value**, which is ordinary expression position and has
no such limit — any attribute, any line:

```tsx
<div
  id="x"
  onclick={f}
  css={@@(
    display: flex;
  )}
>…</div>
```

and outside JSX entirely:

```tsx
const panel = @@( display: flex; );
```

## Formatting on save

The extension also formats these files, which no formatter can do on its own. Measured: the Biome
extension does nothing with one, because a file holding a block is excluded from `biome.json` — and
with the exclusion lifted, biome answers *"Code formatting aborted due to parsing errors"*. Prettier
refuses the same way.

What runs is the **project's own** `ramonda-css`, found by walking up to `node_modules/.bin`, with the
project's own biome and its own config — so a file formatted on save is what `pnpm format` would have
produced. Nothing is bundled here that could drift from it.

Set it as the formatter for the languages you write blocks in:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.ramonda-css-vscode" },
  "editor.formatOnSave": true
}
```

A file with no block goes straight through the same tool, so this is safe to set for the language
rather than for a folder.

## One setting the editor needs

```json
{ "typescript.tsserver.useSyntaxServer": "never" }
```

Measured from a real editor's own log, on a file holding a block:

```
[error] [vscode.typescript-language-features] provider FAILED
[error] Error: <syntax> TypeScript Server Error (5.9.3)
Debug Failure. False expression: Token end is child end
```

An editor runs **two** TypeScript servers — a `<syntax>` one for the things that need no types, and a
`<semantic>` one for everything else — and **only the semantic one loads plugins**. So the syntax
server reads the author's file, which is not TypeScript, and its classifier walks itself into an
internal assertion. Nothing in a plugin can reach it; the setting is what stops the editor asking it.

## What it does NOT do

Completion, hover, and the red squiggles are not here. They come from the language service plugin in
`@ramonda/css`, which a project turns on in its own `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

VS Code has to be running the workspace's TypeScript for a plugin to load at all: **TypeScript:
Select TypeScript Version → Use Workspace Version**.

The two halves are deliberately separate. Colours are a grammar and cost nothing; everything else
needs the compiler, and a project that has not asked for the plugin should not get it.

## Installing it

Not published yet. From the repository:

```bash
node packages/css/vscode/install.mjs
```

That links this folder into every editor on the machine that reads VS Code extensions — VS Code,
Insiders, Cursor, Windsurf, VSCodium. Reload the window (**Developer: Reload Window**) afterwards.

A link rather than a copy, so a change to a grammar reaches the editor on the next reload and there
is only ever one file to be wrong. `pnpm dlx @vscode/vsce package` makes a `.vsix` for anyone else.

## Other editors

The grammars are plain TextMate JSON, and nothing in them is VS Code's. Any editor that takes a
TextMate injection can load them from `grammar/`, keyed on the scopes they inject into
(`source.tsx`, and `source.css` for the hole).
