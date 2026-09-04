# @ramonda/css

A style block written in real CSS beside the markup. At build time the static declarations become a
class in a stylesheet and each carried expression becomes a CSS custom property on the element.

```
<div css=@(
  display: flex;
  border-left: {{isOnline ? "4px solid #10b981" : "4px solid #64748b"}};
)>
```

> **Not built yet.** This package is private and its version is `0.0.0`. What exists today is the
> design, the plan, seven runnable prototypes, and the contract below — the shape the compiler and
> the framework are both being written against. Read `DESIGN.md` for why, `PLAN.md` for the order of
> work, and `CONTRACT.md` before writing either half.

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
import { classNameFor, normalise, substitute } from "@ramonda/css/compiler";

const canonical = normalise({
  items: [{ kind: "declaration", property: "display", value: [{ kind: "text", text: "flex" }] }],
});

const className = classNameFor(canonical);
substitute(canonical, className); // "display:flex;"
```

## Licence

MIT
