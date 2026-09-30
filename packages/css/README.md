# @ramonda/css

A style block written in real CSS beside the markup. At build time every declaration becomes a class
in a stylesheet, and the block becomes the classes it came to — a string, so `className` takes it.

```
<div className={@@(
  display: flex;
  border-left: match({this.tone}) {
    loud => 4px solid #10b981;
    _    => 4px solid #64748b;
  };
)}>
```

[readme:start]: #

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fcss)](https://www.npmjs.com/package/@ramonda/css)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fcss)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. A breaking change ships as a
> **minor** until then — see [Upgrading](https://ramonda.dev/reference/upgrading)
> for what that means for a version range, and the
> [root README](https://github.com/NBlasko/ramonda#readme).

```sh
npm install @ramonda/css
```

Documentation: **[ramonda.dev/style-blocks](https://ramonda.dev/style-blocks)**

[readme:end]: #

## A block is a value

So it goes wherever a value goes — in the attribute, or in a binding you name and use later:

```tsx
<div className={@@( display: flex; )}>…</div>    inline
const panel = @@( display: flex; );              named, and reusable
```

A block compiles to its **classes**, so `className` is where it goes. Beside a class of your own it
goes through `mergeClassNames` — `className={mergeClassNames("lead", @@( display: flex; ))}` — and
not through a template literal, which is text to the compiler and is reported rather than compiled
to silence.

Nothing about a block requires JSX: **this extends TypeScript, not JSX**, and a block in a `.ts`
file with no markup works the same way.

`className=@@( … )` — a bare JSX attribute, with no braces — was a third spelling and is refused now,
with a message naming the one to write. It could only be coloured as the first attribute on the tag's own
line, because an editor stops consulting syntax injections the moment it enters an attribute list;
and Prettier rewrote it to the braced form anyway, so the file you saved was not the file you
wrote.

## Variables a project declares

Declare them once, in a `ramonda.css.ts` beside your `tsconfig.json`, and read them by path:

```ts
import { kind } from "@ramonda/css/config";

export default {
  variables: {
    color: kind("color", { accent: "#10b981" }),
    space: kind("length", { gutter: "16px" }),
  },
};
```

```tsx
const card = @@(
  color: $.color.accent;
  padding: $.space.gutter;
);
```

`$.color.accent` compiles to `var(--color-accent)` — the path is the name, so there is no string to
misspell, and a typo is a TypeScript error with the suggestion it already knows how to make.

The **kind** is checked in both directions. `padding-left: $.color.accent` is refused before
anything runs; and `codegen` writes an `@property` registration for every variable, so a value the
browser cannot use falls back to the declared one instead of collapsing the element that reads it.

`npx ramonda-css codegen` writes `css-system/` beside the config — the `$` object, this project's
narrowed types, and a `variables.css` your app imports once. Both bundler plugins run it for you.
Commit the folder: your editor reads it, so a fresh clone is checked before anything is built.

The same file is where a project narrows what a block may say at all — which units, which values,
whether a colour may be written out rather than named. See
[the config file](https://ramonda.dev/style-blocks/config).

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
esbuild gives a plugin a path rather than the code, at about 17 µs a file. `filter` narrows which
files it reads.

## Formatters

The syntax is not TypeScript, so no formatter can parse a file holding a block until it is taught.
biome answers *"Code formatting aborted due to parsing errors"* and Prettier answers
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

  Prettier prints an attribute value itself and never offers a plugin the chance to print one, which
  is one of the two reasons the bare `className=@@( … )` spelling is no longer compiled: the formatter had
  to hand back the braced form regardless.

The syntax is not TypeScript, which is why this owns a parser and a virtual-file layer — the same way
JSX is usable because somebody wrote the parser for it. Everything a block can say is type-checked:
a property-name typo gets TypeScript's own *did you mean*, a value the property cannot take is
reported with the ones it can, and a runtime value in a declaration is refused outright.

## What ships to the browser

`@ramonda/css` is the compiled value and nothing else — no parser, no hash, no stylesheet. It imports
nothing at all, not even the framework, which is what lets another JSX library take a block on its own
`className` without dragging one in.

```ts
import { mergeClassNames } from "@ramonda/css";

// What a block compiles to: the classes, space separated. It keeps one class per thing set.
// A shorthand arrives as the longhands it sets, so `padding: 8px` is four of them, after `r-p-`,
// which has no rule and tells the merge a whole `padding` was written: everything it covers,
// written earlier, is cleared. The `padding-left` beneath it goes.
mergeClassNames("r-pl-40px r-cur-pointer", "r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px");
// "r-cur-pointer r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px"
```

**A block IS that string**, so `className={panel}` applies one and there is no adapter to import. No
rule is ever created at runtime, and nothing is concatenated into one.

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
<div className={@@( display: flex; border-left: 4px solid red; )}>
```

into one class per declaration, plus one rule per declaration for the sheet:

```tsx
import { mergeClassNames as _merge, shorthands as _clears } from "@ramonda/css";
_clears({"bl":["blc","bls","blw"]});
const _s0 = _merge("r-disp-flex r-bl-4px_solid_red");

<div className={_s0}>
``` **Only the CSS between the expressions is replaced** — every expression's own
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
*did you mean* for a CSS property name. Every expression the block still holds — a condition, a
spread, a `match` subject — stays where it was written, so `this`, the imports and the generics are
all the ones the author sees.

```
dsiplay: flex;      TS2561 … 'dsiplay' does not exist. Did you mean to write 'display'?
position: statik;   TS2820 … Did you mean '"static"'?
padding: {n};       hole-not-allowed … a style block takes no runtime value
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

Two identical blocks agree on one CLASS, so the markup is identical and the browser applies one rule.
Each file still serves that rule in its own stylesheet — a chunk has to stand on its own wherever the
bundler puts it, and a route whose class lives only in another route's sheet renders unstyled. Where
the duplicate is identical, Vite dedupes the asset by content and it costs nothing; where it cannot,
a sheet holding every rule three times is 3.5x the bytes and **1.1x gzipped**.

## In an editor

```json
{ "compilerOptions": { "plugins": [{ "name": "@ramonda/css/plugin" }] } }
```

Completion inside a block **is** object-literal completion: the property names while a name is being
typed, and the values a property accepts while a value is. Hover over an expression gives its own
type. And a correct block gets no red squiggle, even though the file does not parse as TypeScript
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

Beside them are rules for the faults a type cannot reach, each bounded so that no fault is reported
twice:

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
ramonda-css codegen           # --check to report a stale css-system/
ramonda-css explain padding   # what the config does to one property, and which line decided it
```

Neither reimplements anything — the project's own biome and oxlint do the work, with their own
configuration, because both read it from the working directory rather than from the file's path. The
linter is given the same virtual file `tsc` gets and its diagnostics are mapped home; the formatter
is given a copy with the blocks replaced by something that parses, and they go back at whatever
indentation it chose.

## License

[MIT](./LICENSE) © Nikola Blagojević
