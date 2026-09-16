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
npm install @ramonda/css
```

The checking is TypeScript's own, so the package needs yours — it writes a virtual file your compiler
reads, and a fault in a block arrives as an ordinary `tsc` diagnostic rather than as a report from a
tool you have to run separately. Any TypeScript 5 will do.

## One plugin in the build

The CSS a block compiles to is a module the bundler already knows about, and it follows the
JavaScript chunk it belongs to — so there is nothing to import for it. (A project that declares
[variables](/style-blocks/variables) imports one stylesheet, once, for those.)

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

### If you declare variables

Nothing above changes, and one thing is added: the plugin writes a `css-system/` folder beside
`ramonda.css.ts` holding `$` and the values, and your app imports the stylesheet once.

```ts
import "./css-system/variables.css";
```

Commit that folder. It is generated, and it is also what your editor reads, so a fresh clone that
has not built anything yet is still checked. `npx ramonda-css codegen` writes it without a build,
and `--check` fails in CI when what is committed no longer matches the config beside it.

A route that is already code-split gets its own stylesheet, without being asked. A block belongs to
the module it was written in and each module imports its own CSS, so splitting is a decision the
bundler was making anyway: a lazily-loaded module gets its own `.css` asset, carrying that module's
rules and not the entry's.

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
for everything else. The syntax one never opens your `tsconfig.json`, which is where this plugin is
named, so it reads your file as plain TypeScript. Your file is not plain TypeScript, and it walks
into an assertion of its own. From a real editor's log:

```
[error] [vscode.typescript-language-features] provider FAILED
[error] Error: <syntax> TypeScript Server Error (5.9.3)
Debug Failure. False expression: Token end is child end
```

The setting is what stops the editor asking it, and nothing is lost by turning it off: one server
answers everything the two did. What the syntax one was buying is speed on a cold project — code
folding, the outline, *Format Document* and expand-selection answer before the program has loaded
rather than after it. That is one wait, once per project.

Recent VS Code spells the same setting `js/ts.tsserver.useSyntaxServer`, and reads either.

### The colours, and format-on-save

These come from an editor extension rather than from the plugin — colours are a grammar and cost
nothing, and a project that has not asked for the compiler should not be given one.

```sh
code --install-extension ramonda.css
```

Or search **Ramonda CSS** in the Extensions panel.

Formatting then depends on what your project already uses, and the two answers are opposite.

**Using Prettier? Keep Prettier, and do not touch `editor.defaultFormatter`.** `@ramonda/css` ships a
Prettier plugin, so your usual formatter handles these files with nothing else to configure:

```json
{ "plugins": ["@ramonda/css/prettier"] }
```

**Using biome?** biome has no plugin surface for a syntax it cannot parse, so the formatting goes
through this extension, which runs *your* biome with *your* config:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.css" },
  "editor.formatOnSave": true
}
```

**What that setting does, so you can decide where to put it.** `editor.defaultFormatter` names the
one extension VS Code asks for that language, and it does not fall through to another — so it reaches
every project it is in scope for:

| where the setting is | in a biome project | in a Prettier project | in a project without `@ramonda/css` |
|---|---|---|---|
| the project's `.vscode/settings.json` | what you want | — | — |
| your user settings | what you want | runs **biome**, not Prettier | format-on-save does **nothing**: this extension has no command to run and returns no edits, and Prettier and biome are never asked |

In a workspace it is also what everyone else on the project gets.

## Check that it worked

Write a block with a property that does not exist:

```tsx expect-report:unknown-property
const wrong = <div css={@@( dsiplay: flex; )}>x</div>;
```

Your editor should underline `dsiplay` and offer `display`. If it does, the plugin is loaded and the
workspace TypeScript is the one running. If the whole line is red instead, the syntax server is still
being asked — that is the setting above.

## Where to go next

- **[Writing a block](/style-blocks/writing)** — where a block goes, holes for values that change,
  nesting and conditions.
- **[What is checked](/style-blocks/checking)** — every rule, what it catches, and how to silence one
  that is wrong.
- **[Names the stylesheet sees](/style-blocks/variables)** — declaring variables and reading them
  with `$`, keyframes and font faces, and what a theme is.
- **[Which declaration wins](/style-blocks/order)** — two declarations of one property, and the rule
  that decides between them.
- **[Composing](/style-blocks/composing)** — reusing a block, conditions, and your own stylesheet.
- **[The config file](/style-blocks/config)** — `ramonda.css.ts` end to end, and what a project can
  decide not to allow.
- **[Project settings](/style-blocks/settings)** — the names a block emits, and who reads them.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, other JSX libraries, and what this
  does not do.
