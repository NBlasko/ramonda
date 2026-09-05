# The contract

`DESIGN.md` says why this feature exists and `PLAN.md` says in what order it gets built. **This file
is the part both halves have to agree on before either can be written**, and it is deliberately
short: four decisions, each one implemented and tested in `src/`, so nothing here is a description of
code that might drift from it.

Read this and you can write the transform, the framework's `css` prop, the property types, the
stylesheet assembler or a wrapper for another JSX library **without reading the other side**.

---

## 1. What a block compiles to

One hoisted descriptor at module scope, one call at the site.

```
                                       source
<div css=@@(
  display: flex;
  border-left: {{isOnline ? "4px solid #10b981" : "4px solid #64748b"}};
)>

                                       emitted
import { block } from "@ramonda/css";
const _s0 = block("r-8e271c6c1f3a4b02", ["--r-8e271c6c1f3a4b02-0"]);

<div css={_s0(isOnline ? "4px solid #10b981" : "4px solid #64748b")}>
```

and the stylesheet gains

```css
.r-8e271c6c1f3a4b02 {
  display: flex;
  border-left: var(--r-8e271c6c1f3a4b02-0);
}
```

**A block with no holes is not called.** The descriptor is itself the value, so the site reads
`css={_s0}` and the whole program allocates once, however many elements carry the class.

Three properties of this shape are load-bearing:

- **The expression is an argument.** The compiler concatenates nothing and builds no string, so
  nothing has to be escaped at compile time — a value carrying a quote or a closing brace is carried
  as a value and applied with `setProperty`, which takes text verbatim. What a value may not carry
  is a semicolon; see *the one rule a consumer must implement* below.
- **The expression's own bytes never move.** The transform rewrites the CSS *between* the
  expressions and leaves each expression where the author wrote it, which is what keeps the source
  map landing on the author's line.
- **The expression is not part of the block's identity.** Two blocks with identical CSS and
  different expressions are one class and one rule; each element carries its own value.

## 2. What `block()` returns, and what the `css` prop accepts

```ts
type StyleVarValue = string | number;

interface StyleValue {
  readonly className: string;
  readonly properties: readonly string[]; // custom property names, in hole order
  readonly values: readonly StyleVarValue[]; // parallel to properties
}

type StyleBlock<P extends readonly string[]> = StyleValue & ((...values: HoleValues<P>) => StyleValue);
```

- **`css` accepts a `StyleValue`, or nothing.** `css={cond ? _s0 : undefined}` removes the class
  along with the variables — measured through a real hydration, both directions, and the DOM ends up
  right either way.
- **A hole may never be `undefined`**, and the type is what enforces it. This was a preference until
  the four hydration directions were measured; both failing directions are the `undefined`
  directions, and one of them leaves a stale value in the DOM with a diagnostic that does not repair
  it. See `DESIGN.md`.
- **A hole whose value differs between server and client is silent, and the client's wins.** Measured
  once the framework side existed, and it supersedes the earlier reading: written as an object style
  the same divergence was reported as `RMD007`, because the value was then part of an attribute the
  comparator reads. A compiled block is not — the class is compared like any other class, and the
  values are applied after the attribute pass. Silent and repaired is the better half of the two
  directions the design measured; the one that was reported was the one that was NOT repaired.
- **A hole may be a number** because plenty of properties take one. It is the per-property types
  (track C) that refuse `padding: 24`, not this.
- **The arity is checked.** `block()` takes the property names as a tuple, so a call with the wrong
  number of arguments is a type error. The compiler writes both halves, so this is the compiler
  checking itself.
- **One function turns a value into `{ className, style }`** — `toStyleObject`. That is the entire
  adapter surface a wrapper on another JSX library needs; Ramonda applies it natively instead.
- **There is no brand.** A runtime diagnostic (track L) can tell a compiled value from a hand-written
  object by its shape, and a hand-written object that matches the shape exactly is a working value.
- **A value containing a `;` is refused, and the declaration is dropped.** See below — this is a
  requirement on every consumer of a value, not an implementation detail of one.

Applying it, on the framework side, is: add `className`, then `setProperty(name, value)` per hole.

### The one rule a consumer of a value must implement

**A hole's value is whatever the author's expression evaluated to, and an expression can read a
record.** "The author wrote it" is not a defence, so a hostile value has to be assumed.

`setProperty` closes it on the client: it writes ONE declaration whatever it is handed. Measured,
the same value both ways —

```
style.cssText = `--r-0: ${value}`   ->  position: fixed, width: 100vw — real, applied
style.setProperty("--r-0", value)   ->  position: "", width: "" — nothing else exists
```

**It does not close it on the server, and that took a measurement to find.** A server render is
serialized to HTML and the browser PARSES the style attribute back, and a parse applies the CSS
grammar to whatever text the serializer produced. Run through `renderToString` and back through
`innerHTML`, the same value came out as `position: fixed; width: 100vw; z-index: 9999` — real,
applied declarations, on a page the client guarantee never touched.

So **the value is checked rather than left to the DOM**, which only refuses it on one of the two
paths. A semicolon is what separates declarations, and CSS says a custom property's value may not
contain one at the top level; refusing every semicolon rather than only the top-level ones costs a
value like `content: "a;b"` and buys a rule that needs no CSS parser to apply. The declaration is
dropped rather than sanitised — a missing border beats an overlay somebody's record asked for.

Implemented in both consumers that exist: `toStyleObject` here, and `applyCssBlock` in the framework.
Saying it out loud to the author is the runtime diagnostic, which is deliberately last.

## 3. The names

| | |
|---|---|
| class | `r-` + **16** lowercase hex characters of `sha256(normalised)` |
| custom property | `--<class>-<n>`, `n` being the hole's 0-based index in source order |

**The prefix is fixed, not configurable.** A configurable prefix means two packages emitting
different names for the same block, and identical blocks deduplicating to one rule with no registry
and no coordination is the property the whole design rests on.

**The variable name is scoped to the block and never positional.** With `--r0` for every block's
first hole, a card that styles its own title through a nested rule and a title that has a block of
its own both name the same variable; the card's rule applies *to* the title, `var(--r0)` resolves on
the element the declaration applies to, and the card's colour silently disappears. Neither component
is wrong — only the pairing is, and no test of either alone would find it.

**The length guarantees nothing.** Two different blocks landing on the same name is a birthday
problem and probability is not a promise. The guarantee is the assertion made where the sheet is
assembled, which sees every block at once; 16 hex only makes that assertion a tripwire that never
trips, and measured, the extra characters gzip to nothing.

## 4. Normalisation, which is the definition of identity

Normalisation runs on the **parsed** block, not on the author's text. That is why `color : red` and
`color:red` share a class: nothing that reads characters can tell the meaningless space before a
declaration's colon from the combinator in `& :first-child`, and once the block is parsed the
question does not arise.

```ts
interface Block {
  items: readonly BlockItem[];
} // order is meaning; never sorted
type BlockItem = Declaration | NestedRule;
interface Declaration {
  kind: "declaration";
  property: string;
  value: readonly ValuePart[];
}
interface NestedRule {
  kind: "rule";
  prelude: string;
  items: readonly BlockItem[];
}
type ValuePart = { kind: "text"; text: string } | { kind: "hole"; index: number };
```

The canonical form is `property:value;` per declaration and `prelude{…}` per nested rule, joined in
source order. **Written down as a rule, and tested as a table in
`src/__tests__/normalise.test.ts`:**

| thrown away | kept |
|---|---|
| runs of whitespace, and whitespace at the ends of a value or a prelude | whitespace inside a string — `content: "a  b"` |
| the case of a property name (`COLOR`) | the case of a **custom** property (`--Accent`), which CSS reads as significant |
| the whitespace the author put around a declaration's colon | the space before a hole, which is a token separator |
| a trailing semicolon, present or not | the order of two declarations |
| | the case of anything in a prelude — a pseudo-class folds, a class name does not |
| | number forms, colour forms, keyword case — see below |

**The asymmetry that decides every one of those.** A missed merge costs one duplicate rule in a
stylesheet. A wrong merge changes a page nobody edited, in a way no test of either block alone can
find. So normalisation folds only what provably cannot change meaning, and where there is any doubt
it keeps the difference — `.5px` and `0.5px`, `#FFF` and `#ffffff`, `FLEX` and `flex` are all safe to
fold in principle and are deliberately not folded, because each needs a value parser to do safely and
each buys back a rule that was going to be duplicated anyway.

**Holes are placeholders while the text is hashed.** The names are circular — the variable name comes
from the class, the class from the hash, the hash from this text — so a hole normalises to its index
delimited by `U+0000`, and `substitute()` puts the real names in afterwards. `U+0000` becomes
`U+FFFD` during CSS preprocessing, so no author can write one into a block and forge a placeholder.

**Hashing happens before any post-processing, and post-processing may not rename.** The server build
and the client build never speak; each hashes its own copy and both write the result into markup that
has to match.

---

## Where a hole may appear

A custom property holds a *value*. Refused at build time, with the source position, and reported by
the checker first:

```
border-left: {{…}};                ✓   becomes  border-left: var(--r-…-0)
{{cond ? "display:flex" : ""}}     ✗   a declaration — nothing to put a variable in
{{name}}: 24px;                    ✗   a property name
&:{{state}} { … }                  ✗   a selector
```

## What this contract does not decide

Deliberately, because each belongs to a track that can settle it without changing anything above:

- **the `@layer` name and where the sheet is linked** — track E, sheet assembly;
- **which properties get a real union and which get `string | number`** — track C;
- **how a nested rule's prelude expands against the class** — track E;
- **splitting one sheet into several** — track J. No syntax, type or compiled value changes when it
  lands.

## Why the package is private

`@ramonda/css` is `"private": true` and version `0.0.0` until the feature works end to end. It is in
the workspace so every gate sees it — it lints, type-checks, tests and builds with everything else —
and it is not on npm, because a published package whose only export is a value nothing produces yet
would be a promise this cannot keep. Publishing it means adding it to `scripts/check-side-effects.mjs`
and to the docs' API coverage, both of which are how a new public surface gets acknowledged here.
