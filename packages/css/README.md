# @ramonda/css

A style block written in real CSS beside the markup. At build time the static declarations become a
class in a stylesheet and each carried expression becomes a CSS custom property on the element.

```
<div css=@(
  display: flex;
  border-left: {{isOnline ? "4px solid #10b981" : "4px solid #64748b"}};
)>
```

> **Partly built.** This package is private and its version is `0.0.0`. **A block renders, is
> writable, and nothing in this repository goes quiet on it**: the parser, the transform, the compiled
> value, the virtual file, the property types, the check command, the Vite plugin, the stylesheet and
> the editor plugin and the CSS checker all exist, and both tools that read source — `ramonda-check`
> and the docs example gate — read it through the virtual file, and the formatter and the linter go
> through wrappers over the project's own tools. Per-route splitting is not built yet. Read
> `DESIGN.md` for why, `CONTRACT.md` for the shape both halves are written against, and `PLAN.md`
> for what is done and what is next.

> **Setting up an editor, a formatter or a linter**: the whole of it is on one page —
> [Style blocks](https://ramonda.dev/style-blocks). What is below is the package.

## Three ways to write one

```tsx
<div css=@( display: flex; )>…</div>            a bare JSX attribute
<div css={@( display: flex; )}>…</div>          a value, in the braces JSX already has
const panel = @( display: flex; );              a value, outside JSX
```

Same class, same hash, same holes — only what is replaced differs. **Prefer one of the braced forms
when the tag has other props**, and the reason is an editor limit rather than taste: an editor stops
consulting syntax injections the moment it enters a tag's attribute list, so a bare attribute is only
coloured when it is the first one, on the tag name's own line. In expression position there is no
such limit.

## Builds

Vite is where dev and HMR live:

```ts
import { ramondaCss } from "@ramonda/css/vite";

export const plugins = [ramondaCss()];
```

esbuild builds the same thing:

```ts
import { ramondaCss } from "@ramonda/css/esbuild";

export const plugins = [ramondaCss({ filter: /src\/.*\.tsx$/ })];
```

Both compile the same blocks to the same classes, and both check what post-processing handed back
against what the sheet promised. The esbuild one reads every source file it is asked about, because
esbuild gives a plugin a path rather than the code — measured at 17 µs a file, which is what
`filter` narrows.

## Formatters

The syntax is not TypeScript, so no formatter can parse a file holding a block until it is taught.
Measured: biome answers *"Code formatting aborted due to parsing errors"*, Prettier answers
*"SyntaxError: ')' expected."* Both refuse rather than mangle, which is the safe half — and both are
handled:

- **This repository's own tools** go through `ramonda-css format` and `ramonda-css lint`, which
  replace each block with something that parses, run biome or oxlint, and put the block back at the
  indentation the tool chose.
- **Prettier** gets a plugin. Add it to your Prettier config and formatting works everywhere,
  including the format-on-save an editor does for you:

  ```json
  { "plugins": ["@ramonda/css/prettier"] }
  ```

  One thing it changes: a bare `css=@( … )` comes back as `css={@( … )}`. Prettier prints a quoted
  attribute value itself and never offers a plugin the chance to print one, so the placeholder has to
  be braced — and the two compile to the same class anyway.

The syntax is not TypeScript, which is why this owns a parser and a virtual-file layer — the same way
JSX is usable because somebody wrote the parser for it. Everything a block can say is type-checked:
a property-name typo gets TypeScript's own *did you mean*, and a hole is checked against the type the
property accepts.

## What ships to the browser

`@ramonda/css` is the compiled value and nothing else — no parser, no hash, no stylesheet. It imports
nothing at all, not even the framework, which is what lets a wrapper put a `css` prop on another JSX
library without dragging one in.

```ts
import { block, toStyleObject } from "@ramonda/css";

// What the compiler emits at module scope. There is no reason to write this by hand.
const bordered = block("r-8e271c6c1f3a4b02", ["--r-8e271c6c1f3a4b02-0"]);

toStyleObject(bordered("4px solid #10b981"));
// { className: "r-8e271c6c1f3a4b02", style: { "--r-8e271c6c1f3a4b02-0": "4px solid #10b981" } }
```

The expression is an **argument**, never concatenated into a string — so nothing has to be escaped,
and no rule is ever created at runtime.

## What the build loads

`@ramonda/css/compiler` decides names, and a browser never loads it. Two blocks that normalise the
same get one class and therefore one rule, wherever and by whomever they were written — no registry
and nothing to coordinate, because agreeing on the same answer is what a hash is for.

```ts
import { readFileSync } from "node:fs";
import { transform } from "@ramonda/css/compiler";

const result = transform(readFileSync("Card.tsx", "utf8"), { filename: "Card.tsx" });
// result.code   the same file as valid TSX, with the descriptors hoisted
// result.map    author's line AND column, through the bundler underneath
// result.blocks the rules the stylesheet now owes
```

The transform is what turns

```
<div css=@( display: flex; border-left: {{accent}}; )>
```

into a hoisted `const _s0 = block("r-…", ["--r-…-0"])` and a site reading `css={_s0(accent)}`, plus
one rule for the sheet. **Only the CSS between the expressions is replaced** — every expression's own
bytes stay where they were written, which is what makes the source map exact.

A file that uses none of this pays one substring search: 1,290 files and 10.73 MB of this repository
in 0.84 ms.

## How it is type-checked

The syntax is not TypeScript, so it is turned into TypeScript — a **virtual file** that `tsc` reads,
with every diagnostic mapped back to the character the author typed. The same three moves the
established file-format tools make.

```ts
import { readFileSync } from "node:fs";
import { virtualFile } from "@ramonda/css/compiler";

const file = virtualFile(readFileSync("Card.tsx", "utf8"));
// file.code       valid TSX, each block an object literal
// file.homeOf(n)  the author's offset, or undefined when it is scaffolding
```

Each block becomes an **object literal**, and that is the load-bearing choice: an object literal is
what gets excess-property checking, and excess-property checking is what produces TypeScript's own
*did you mean* for a CSS property name. Each hole's expression stays where it was written, so `this`,
the imports and the generics are all the ones the author sees.

```
dsiplay: flex;      TS2561 … 'dsiplay' does not exist. Did you mean to write 'display'?
position: statik;   TS2820 … Did you mean '"static"'?
padding: {{f()}};   TS2322 … 'boolean' is not assignable
```

The property map is generated from MDN's own data — 551 properties, **123 of them a closed keyword
set**, which are the ones whose values are checked as a union. The rest take `string | number`,
because a union that grows combinatorially says nothing a reader can act on: those typos belong to a
CSS checker, where the message is one we write. `display` is one of them — its grammar allows
`inline flow-root`, and **rejecting valid CSS is the one failure a type map may not have**.

```ts
import { classNameFor, normalise, substitute } from "@ramonda/css/compiler";

const canonical = normalise({
  items: [{ kind: "declaration", property: "display", value: [{ kind: "text", text: "flex" }] }],
});

const className = classNameFor(canonical);
substitute(canonical, className); // "display:flex;"
```

## Making it render

```ts
import { defineConfig } from "vite";
import { ramondaCss } from "@ramonda/css/vite";

export default defineConfig({ plugins: [ramondaCss()] });
```

That is all of it. **There is no stylesheet to import**, and that is a measurement rather than a
convenience: one shared stylesheet shipped no CSS at all, because Rollup loaded it before the styled
file had been transformed. So each file serves its own, appended by the plugin — which means the CSS
follows the JavaScript chunk, and a route that is already code-split gets its own stylesheet for
free.

Two identical blocks are still one rule: the first file to claim a class owns it, and the second just
names the class.

## In an editor

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

Completion inside a block **is** object-literal completion: the property names while a name is being
typed, and the values a property accepts while a value is. Hover over a hole gives the expression's
own type. And a correct block gets no red squiggle, even though the file does not parse as TypeScript
— both kinds of diagnostic are read from the virtual file, because the real one would report the
block itself as a syntax error.

The parser has a second, forgiving mode for this. `disp` is not a valid declaration and the build
refuses it — but `disp` is the state you are in while typing `display`, so an editor gets a reading
rather than a refusal. All nine caret positions a person passes through are tests, including an empty
block.

## Checking a project

```
ramonda-css [tsconfig.json]
```

Every block becomes a virtual file, the project is handed to `tsc` once, and every diagnostic comes
back to the character the author typed:

```
[ramonda-css] 4 problem(s) in 2 file(s):

  src/Card.tsx:6:9
    TS2561: Object literal may only specify known properties, but 'dsiplay' does not exist
            in type 'CssBlockShape'. Did you mean to write 'display'?
```

**It reports ordinary type errors too, and that is deliberate**: a project using this syntax cannot
run plain `tsc`, so this is its `tsc`. Meant to sit in a `build` script — until it runs somewhere
that fails, the type safety is a claim about editors rather than about CI.

Beside them are four rules for the faults a type cannot reach, each with its boundary measured
against the compiler first so no fault is reported twice:

```
src/Card.tsx:6:18   unknown-value: `display` does not accept `flexx`. Did you mean `flex`?
src/Card.tsx:7:9    unknown-property: `flex-dirction` is not a CSS property. Did you mean `flex-direction`?
src/Card.tsx:8:26   unknown-value: `border-left` does not accept `sollid`. Did you mean `solid`?
src/Card.tsx:10:9   repeated-declaration: `color` is already set to `red` in this block.
```

`display: flexx` is the one to notice. `display` takes combinations — `inline flow-root` — so no
union could type it without rejecting valid CSS; a checker reads one word and says something about
that word alone.

## Formatting and linting

The formatter and the linter cannot read the syntax either, and a suppression comment cannot help:
`biome-ignore` is read BY the parser, which has already failed. So they get wrappers.

```
ramonda-css format src        # --check to report instead of writing
ramonda-css lint src
```

Neither reimplements anything — the project's own biome and oxlint do the work, with their own
configuration, because both read it from the working directory rather than from the file's path. The
linter is given the same virtual file `tsc` gets and its diagnostics are mapped home; the formatter
is given a copy with the blocks replaced by something that parses, and they go back at whatever
indentation it chose.

## Licence

MIT
