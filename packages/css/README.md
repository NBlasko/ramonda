# @ramonda/css

A style block written in real CSS beside the markup. At build time the static declarations become a
class in a stylesheet and each carried expression becomes a CSS custom property on the element.

```
<div css=@(
  display: flex;
  border-left: {{isOnline ? "4px solid #10b981" : "4px solid #64748b"}};
)>
```

> **Partly built.** This package is private and its version is `0.0.0`. The parser, the transform,
> the compiled value and the virtual file exist; the property types, the stylesheet and the editor do
> not. Read
> `DESIGN.md` for why, `CONTRACT.md` for the shape both halves are written against, and `PLAN.md`
> for what is done and what is next.

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

```ts
import { classNameFor, normalise, substitute } from "@ramonda/css/compiler";

const canonical = normalise({
  items: [{ kind: "declaration", property: "display", value: [{ kind: "text", text: "flex" }] }],
});

const className = classNameFor(canonical);
substitute(canonical, className); // "display:flex;"
```

## Licence

MIT
