---
title: Style blocks
description: Real CSS beside your markup, compiled before the build into one class per declaration and type-checked throughout. Install it, wire one plugin, write a block.
section: Style blocks
order: 106
---

# Style blocks

Write CSS where the element is, in CSS:

```tsx
<div css={@@(
  display: flex;
  gap: 8px;
  border-left: 4px solid #10b981;
  &:hover { border-left-color: #00b37e; }
)}>
  Online
</div>
```

Nothing about that is a string, an object, or a template literal. It is CSS, and it is checked as
CSS — a misspelled property, a value the property does not take, and a unit your project does not use
are all reported where you wrote them, before the build runs.

It compiles away. Each declaration becomes one class in a stylesheet, so the element above ships as
`class="r-disp-flex r-gap-8px …"` and the CSS is a file the browser caches. There is no runtime, and
nothing is computed while your page renders.

`@ramonda/css` is a **separate package**. The framework's own position on styling — a `className`, a
`style`, stylesheets the way they have always arrived — is on [Styling](/styling), and it does not
change if you never install this.

## Install

```sh
npm install @ramonda/css typescript
```

TypeScript is a peer dependency because the checking is TypeScript's own: the package writes a
virtual file your compiler reads, so a fault in a block arrives as a normal `tsc` diagnostic rather
than as a report from a tool you have to run separately.

## One plugin in the build

There is no stylesheet to import. The CSS is a module the bundler already knows about, and it
follows the JavaScript chunk it belongs to.

```ts
import { ramondaCss } from "@ramonda/css/vite";

export const plugins = [ramondaCss()];
```

esbuild builds the same thing:

```ts
import { ramondaCss } from "@ramonda/css/esbuild";

export const plugins = [ramondaCss({ filter: /src\/.*\.tsx$/ })];
```

**Set `filter` on esbuild.** esbuild hands a plugin a *path* rather than the code, so a file has to
be read before it can be asked whether it holds a block — measured at 17 µs a file. Pointing the
plugin at the tree that holds them means nothing else is opened at all.

A route that is already code-split gets its own stylesheet, without being asked. A block belongs to
the module it was written in and each module imports its own CSS, so splitting is a decision the
bundler was making anyway. Measured on a real build: a lazily-loaded module produced its own `.css`
asset, carrying that module's rules and not the entry's.

## Three things in your editor

They are separate on purpose, and you can stop after the first.

### The compiler, for completion, hover and the red squiggles

A TypeScript language-service plugin, turned on in your own `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

Your editor has to be running the **workspace's** TypeScript for any plugin to load. In VS Code:
*TypeScript: Select TypeScript Version → Use Workspace Version*.

### One setting, and it is not optional

```json
{ "typescript.tsserver.useSyntaxServer": "never" }
```

An editor runs **two** TypeScript servers — a syntax one for what needs no types, and a semantic one
for everything else — and only the semantic one loads plugins. So the syntax server reads your file,
which is not TypeScript, and walks into an assertion of its own. From a real editor's log:

```
[error] [vscode.typescript-language-features] provider FAILED
[error] Error: <syntax> TypeScript Server Error (5.9.3)
Debug Failure. False expression: Token end is child end
```

Nothing in a plugin can reach that server. The setting is what stops the editor asking it.

### The colours, and format-on-save

These come from an editor extension rather than from the plugin — colours are a grammar and cost
nothing, and a project that has not asked for the compiler should not be given one.

```sh
code --install-extension ramonda.css
```

Or search **Ramonda CSS** in the Extensions panel. Then, if your project formats with **biome**, the
extension is the formatter for the languages you write blocks in:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.css" },
  "editor.formatOnSave": true
}
```

If your project formats with **Prettier, keep Prettier** and leave `editor.defaultFormatter` alone —
`@ramonda/css` ships a Prettier plugin, so your usual formatter handles these files with nothing else
to configure:

```json
{ "plugins": ["@ramonda/css/prettier"] }
```

Either way a file with no block passes straight through, so this is safe to set for a whole language
rather than for a folder.

## Check that it worked

Write a block with a property that does not exist:

```tsx expect-report:unknown-property
const wrong = <div css={@@( dsiplay: flex; )}>x</div>;
```

Your editor should underline `dsiplay` and offer `display`. If it does, the plugin is loaded and the
workspace TypeScript is the one running. If the whole line is red instead, the syntax server is still
being asked — that is the setting above.

## Where to go next

- **[Writing a block](/style-blocks/writing)** — the two spellings, holes for values that change,
  nesting and conditions.
- **[What is checked](/style-blocks/checking)** — every rule, what it catches, and how to silence one
  that is wrong.
- **[Names the whole stylesheet sees](/style-blocks/variables)** — custom properties, `@@property`,
  and what a theme is.
- **[Composing](/style-blocks/composing)** — reusing a block, and which declaration wins.
- **[Project settings](/style-blocks/settings)** — `ramonda.css.ts`, and making the rules stricter.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, other JSX libraries, and what this
  does not do.
