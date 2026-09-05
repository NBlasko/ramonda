---
title: Style blocks
description: Real CSS written beside the markup and compiled before the build into one class and one custom property per hole, with every property and value type-checked.
section: Across the app
order: 119
---

# Style blocks

[Styling](/styling) is the framework's position: a `className`, a `style`, and stylesheets the way
they have always arrived. This page is about the one thing built on top of it, and it is a separate,
opt-in package rather than part of the framework.

```tsx
<div css=@(
  display: flex;
  gap: 8px;
  border-left: 4px solid #10b981;
)>
  Online
</div>
```

That is real CSS, written where the element is, and **compiled before the build**. What ships is a
class in a stylesheet and a `className` on the element. Nothing is parsed at runtime, nothing is
built per render, and the browser caches the stylesheet as a file like any other.

> **Not released yet.** `@ramonda/css` lives in this repository at `0.0.0` and is not published. The
> page is here because the syntax and its guarantees are settled; the version number is what is not.

## What a block becomes

**The static declarations become one class**, named after the hash of the block — so however many
elements carry it, and however many pages, there is one rule. Two files writing the same CSS get the
same class and the stylesheet holds it once.

**Each `{{ … }}` becomes one CSS custom property on the element.** A value that differs per instance
costs a property rather than a rule:

```tsx
class Row extends Component {
  @state weight = 4;

  render() {
    return (
      <div css={@(
        border-left: {{`${this.weight}px`}} solid #ff0055;
        &:hover { border-left-color: #00b37e; }
      )}>
        a row
      </div>
    );
  }
}
```

The nested `&:hover` is CSS's own nesting, resolved by the browser rather than by the compiler. Every
rule is emitted inside `@layer ramonda`, which sits beneath all unlayered CSS — so your own
`.row { border: none }` wins whatever order the files load in, and nobody has to reason about
specificity against generated output.

## Three ways to write one

```tsx
const one = <div css=@( display: flex; )>bare</div>;
const two = <div css={@( display: flex; )}>braced</div>;
const panel = @( display: flex; );
const three = <div css={panel}>a value</div>;
```

They compile to the same class and differ only in where the value is written. **Reach for a braced one
whenever the tag has other props** — the reason is an editor limit rather than taste, and it is
[below](#which-spelling-gets-colours).

## Everything in it is checked

The syntax is not TypeScript, so the package owns a parser and a virtual-file layer — the same way
JSX is usable because somebody wrote the parser for it. What that buys is the checking:

- **A property that does not exist** is TypeScript's own *did you mean*, on the property.
- **A value the property does not take** is reported the same way, with the values it does take.
- **A hole is checked against the type the property accepts**, in the scope where it was written —
  `this.weight` resolves to the field beside it, because the expression stays where you put it.

## Where a hole may go

A custom property holds a **value**. That is the whole rule, and the three things it rules out are
worth writing down:

```
border-left: {{width}};             ✓  a value
{{name}}: 24px;                     ✗  a property name
&:{{state}} { … }                   ✗  a selector
{{on ? "display:flex" : ""}}        ✗  a whole declaration
```

The last one is refused rather than mangled: there is nothing to put a variable in, and a value
carrying a `;` is refused outright — on the server as well, where it would otherwise become real
declarations in the markup.

## Setting up the build

One plugin, and there is no stylesheet to import: the CSS is a module the bundler already knows
about, and it follows the JavaScript chunk it belongs to.

```ts
import { ramondaCss } from "@ramonda/css/vite";

export const plugins = [ramondaCss()];
```

esbuild builds the same thing:

```ts
import { ramondaCss } from "@ramonda/css/esbuild";

export const plugins = [ramondaCss({ filter: /src\/.*\.tsx$/ })];
```

`filter` is worth setting. esbuild hands a plugin a **path** rather than the code, so a file has to be
read to be asked whether it holds a block — measured at 17 µs a file, and pointing the plugin at the
tree that holds them means nothing else is read at all.

**A route that is already code-split gets its own stylesheet.** A block belongs to the module it was
written in and each module imports its own CSS, so splitting is a decision the bundler was making
anyway — measured on a real build: a lazily-loaded module produced its own `.css` asset, carrying
that module's rule and not the entry's.

## Setting up your editor

Three things, and they are separate on purpose.

**The compiler, for completion, hover and the red squiggles.** A TypeScript language-service plugin,
turned on in your own `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

Your editor has to be running the **workspace's** TypeScript for a plugin to load at all — in VS
Code, *TypeScript: Select TypeScript Version → Use Workspace Version*.

**One setting, and it is not optional:**

```json
{ "typescript.tsserver.useSyntaxServer": "never" }
```

An editor runs **two** TypeScript servers — a syntax one for what needs no types, and a semantic one
for everything else — and **only the semantic one loads plugins**. So the syntax server reads your
file, which is not TypeScript, and walks into an internal assertion. Taken from a real editor's own
log:

```
[error] [vscode.typescript-language-features] provider FAILED
[error] Error: <syntax> TypeScript Server Error (5.9.3)
Debug Failure. False expression: Token end is child end
```

Nothing in a plugin can reach it. The setting is what stops the editor asking it.

**The colours, and format-on-save**, come from an editor extension rather than from the plugin —
colours are a grammar and cost nothing, and a project that has not asked for the compiler should not
get one. The extension is not published yet; from a checkout it is
`node packages/css/vscode/install.mjs`, and then:

```json
{
  "[typescriptreact]": { "editor.defaultFormatter": "ramonda.ramonda-css-vscode" },
  "editor.formatOnSave": true
}
```

## Which spelling gets colours

An editor stops consulting syntax injections the moment it enters a tag's attribute list. Measured
with a grammar that does nothing but match one word: it colours a **first** attribute and is never
asked about a second. So a bare block is coloured only as the first attribute on the tag name's own
line, and everywhere else the file reads exactly as it would with nothing installed.

That is what the braced spelling is for. Inside the braces JSX already has for an expression there is
no such limit — any attribute, any line — and the plugin says so where it matters: a bare block an
editor cannot colour is marked as a **suggestion**, on the attribute name. A suggestion rather than a
warning, because nothing is wrong: the block compiles and is checked either way, and a build has no
business failing over colours.

## Formatters and linters

No tool that parses TypeScript can read a file holding a block until it is taught, and each of them
refuses rather than mangles — which is the safe half, and useless on its own:

| tool | what it says |
|---|---|
| biome | *Code formatting aborted due to parsing errors* |
| Prettier | *SyntaxError: ')' expected* |
| oxlint | refuses at the parse step |
| esbuild, `tsc` | refuse at the parse step |

A suppression comment cannot help either: `biome-ignore` is read **by** the parser that already
failed.

**Prettier gets a plugin.** Add it to your Prettier config and formatting works everywhere, including
the format-on-save your editor does for you:

```json
{ "plugins": ["@ramonda/css/prettier"] }
```

One thing it changes: a bare `css=@( … )` comes back as `css={@( … )}`. Prettier prints a quoted
attribute value itself and never offers a plugin the chance to print one, so the placeholder has to
be braced — and the two compile to the same class anyway.

**biome and oxlint get wrappers**, because they have no plugin surface for a syntax they cannot
parse:

```bash
ramonda-css format src        # your biome, your config
ramonda-css lint src          # your oxlint, your rules
```

Each replaces every block with something that parses, runs your own tool, and puts the block back at
the indentation the tool chose. Exclude the files that hold a block from those tools' own runs, or
they will refuse the file before a wrapper can help.

**And the editor formats the buffer, not the file.** `ramonda-css format --stdin-file-path <path>` is
what the extension runs — an editor asks a formatter about the text on screen, and a formatter
pointed at a path would format what was last saved and hand back edits computed against text you have
since changed.

## What it does not do

**It is not CSS-in-JS.** Nothing about a block is JavaScript: it is compiled away before the bundle,
the class exists in a file the browser can cache, and no style is rebuilt on a render.

**It does not scope your other CSS.** A `className` is still the string you wrote, and the class in
your source is the class in the served HTML — see [styling](/styling).

**It is not a theme system.** A theme is a context and some custom properties, which needs nothing
from the compiler.

## Next

- [Styling](/styling) — `className`, `style`, and where stylesheets come from.
- [Performance](/performance) — why a value built in the markup costs more than it looks.
- [JSX](/concepts/jsx) — the rest of the attribute surface.
- [Diagnostics](/reference/diagnostics#rmd062-a-style-block-was-applied-with-no-values-for-its-holes)
  — what the runtime says when a value reaches it that no transform produced.
