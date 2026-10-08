---
title: Setting up
description: Install @ramonda/css, add its plugin to a Vite or esbuild build, turn on the editor plugin and extension, and check that it worked.
section: Style blocks
order: 106.5
---

# Setting up style blocks

Four steps: install the package, add its plugin to your build, turn on the editor plugin, and check
that a block is read. You need a project that builds with Vite or esbuild and type-checks with
TypeScript.

## Install

```install
@ramonda/css
```

The checking is TypeScript's own, so the package needs yours — it writes a virtual file your compiler
reads, and a fault in a block arrives as an ordinary `tsc` diagnostic rather than as a report from a
tool you have to run separately. TypeScript 5.4 or later.

## One plugin in the build

The CSS a block compiles to is a module the bundler already knows about, and it follows the
JavaScript chunk it belongs to — so there is nothing to import for it. (A project that declares
[tokens](/style-blocks/tokens) imports one stylesheet, once, for those.)

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
be read before it can be asked whether it holds a block. Pointing the plugin at the tree that holds
them means nothing else is opened at all.

**Link the stylesheet esbuild writes.** It puts every rule in a `.css` file beside the bundle —
`client.js` gets `client.css` — and nothing loads that file until your HTML links it. Vite does
the linking itself.

### A server-rendered app

A server-rendered app from [`create-ramonda`](/guide/installation) runs Vite in development and
esbuild for the production build, so the plugin goes in two files:

- `vite.config.ts`: add `ramondaCss()` to the `plugins` array beside `ramonda()`.
- `scripts/build.mjs`: put `ramondaCss({ filter: /src\/.*\.tsx$/ })` in the empty `plugins` array.
  Both bundles need it. The server bundle writes the class names into the HTML, and the client
  bundle carries the rules.

You don't add a `<link>`. The build writes the page the server sends, and it links the stylesheet
when there is one. In development the rules come with the script, so a page can show unstyled for a
moment before it loads.

### A code-split app

**Under Vite**, a route that is already code-split gets its own stylesheet, without being asked. A
block belongs to the module it was written in and each module imports its own CSS, so splitting is a
decision the bundler was making anyway: a lazily-loaded module gets its own `.css` asset, carrying
that module's rules and not the entry's, and Vite loads it when the module loads.

**esbuild does not split CSS that way.** It writes a lazily-loaded module's rules into the entry's
stylesheet as well, so a build there links one sheet holding every rule. Nothing goes missing — every
class a page names is in it — but nothing is held back for later either. One sheet grows with the
number of *different* declarations, not with the number of components: every `display: flex` in the
app is one rule.

### If you declare tokens

Nothing above changes, and one thing is added: the plugin writes a `css-system/` folder beside
`ramonda.css.ts` holding the token groups — `$color`, `$space` — and their values, and your app imports the stylesheet once.

```ts
import "./css-system/tokens.css";
```

Commit that folder. It is generated, and it is also what your editor reads, so a fresh clone that
has not built anything yet is still checked. `npx ramonda-css codegen` writes it without a build,
and `--check` fails in CI when what is committed no longer matches the config beside it.

## Two things in your editor

They are separate on purpose, and they answer different halves: the plugin decides what is an error,
the extension decides what you see while typing.

### The compiler, for completion, hover and the red squiggles

A TypeScript language-service plugin, turned on in your own `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

Your editor has to be running the **workspace's** TypeScript for any plugin to load. In VS Code:
*TypeScript: Select TypeScript Version → Use Workspace Version*.

What it gives you, drawn from the plugin's own answers over a real project:

![Inside a block: "$color." offers the project's token groups accent, surface and text; hovering
display shows its grammar, initial value and whether it inherits; and z-index: 5 is underlined
because this project allows only 0, 1, 10, 100 and 1000.](/media/style-blocks-editor.gif)

### The extension, for colours, formatting, and the second TypeScript server

The colours are a TextMate grammar, which is why they are an extension and not part of the plugin:
a grammar needs no program and costs nothing. The extension does two more things — it runs your own
formatter over a block, and it carries the plugin to the editor's second TypeScript server.

```sh
code --install-extension ramonda.css
```

Or search **Ramonda CSS** in the Extensions panel.

**Update it when you update `@ramonda/css`.** The colours follow the syntax of the version the
extension was made for, so after a new spelling an older extension colours it wrong — the checks
are still your project's own, and still right.

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

**TypeScript's own formatter steps aside for a file that holds a block**, which is why one of the
two above is not optional. The syntax is not TypeScript, and an edit the language service computed
for it would land on the wrong characters and corrupt the file rather than merely look wrong — so it
is refused for the whole file. In a file with a block, *Format Document* and *Format Selection* do
nothing by themselves, even on lines nowhere near the block.

#### Why the extension is not only colours

An editor runs **two** TypeScript servers — a syntax one for what needs no types, and a semantic one
for everything else. The syntax one owns formatting, code folding, the outline and expand-selection
for as long as the editor is open, and it never opens your `tsconfig.json`, so a plugin named there
never reaches it.

**The extension is what reaches it.** It carries the same plugin a second way, which VS Code hands
to both servers — so formatting a block leaves it alone, and the outline matches. There is nothing
to configure for any of it.

## Check that it worked

Write a block with a property that does not exist:

```tsx expect-report:unknown-property
const wrong = <div className={@@( dsiplay: flex; )}>x</div>;
```

Your editor should underline `dsiplay` and offer `display`. If it does, the plugin is loaded and the
workspace TypeScript is the one running. If the whole line is red instead, the syntax server is still
being asked — that is the setting above.

## Next

- **[Writing a block](/style-blocks/writing)** — where a block goes, nesting, and where a value that
  changes goes instead.
- **[What is checked](/style-blocks/checking)** — every rule, what it catches, and how to silence one
  that is wrong.
- **[The config file](/style-blocks/config)** — `ramonda.css.ts` end to end, and what a project can
  decide not to allow.
