# Ramonda CSS blocks — editor colours

Syntax colours for `css=@( … )` style blocks, in `.ts`, `.tsx`, `.js` and `.jsx`.

```tsx
<div css=@( display: flex; color: {{accent}}; )>…</div>
```

Without it, an editor colours a block with whatever its TypeScript grammar makes of `@( … )`, which
is an error — and the mistake runs to the end of the file, so code far below a block looks broken too.

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
