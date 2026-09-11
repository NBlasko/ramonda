# The contract

`DESIGN.md` says why this feature exists and `PLAN.md` says in what order it gets built. **This file
is the part both halves have to agree on before either can be written**, and it is deliberately
short: five decisions, each one implemented and tested in `src/`.

**It can drift, and it had — read on 2026-09-07 against the code it describes, five claims were
wrong.** §1's own example gave two different declarations the same class, which is impossible; §1b
showed a block compiling to a bare object rather than a merge, and a key carrying an `&` that is
dropped; the normalisation table said a pseudo-class folds when nothing folds a prelude; §3 described
sixteen hex characters after nine base62 had shipped; and four things listed as undecided were
decided.

`scripts/check-css-contract.mjs` is what keeps the two halves' SHAPES in step across a package
boundary neither may import — the fields of a compiled block, and both copies of the one rule a
consumer must implement. It cannot check prose. So the prose is worth reading against the code
whenever the code moves, and this paragraph is here so the next reader knows it is not automatic.

Read this and you can write the transform, the framework's `css` prop, the property types, the
stylesheet assembler or a wrapper for another JSX library **without reading the other side**.

---

## 1. What a block compiles to

One hoisted descriptor at module scope, one call at the site.

```
                                       source
<div css=@@(
  display: flex;
  border-left: {isOnline ? "4px solid #10b981" : "4px solid #64748b"};
)>

                                       emitted
import { merge as _merge } from "@ramonda/css";

<div css={_merge({
  "display": "r-disp-flex",
  "border-left": ["r-wRCRfm4OS", isOnline ? "4px solid #10b981" : "4px solid #64748b"],
  "~border-left": ["border-left-color", "border-left-style", "border-left-width"],
})}>
```

and the stylesheet gains one rule per declaration

```css
.r-disp-flex { display: flex; }
.r-wRCRfm4OS { border-left: var(--r-wRCRfm4OS-0); }
```

The `~border-left` entry is the shorthand's clear-list — see *the merge* in §1b. And the two classes
differ because the two declarations do: **a class is a function of the declaration alone**, so no two
distinct declarations can share one. The example above said `r-p-12px` for both, which is a name for
`padding: 12px` and could not have been either.

**A block with NO holes is hoisted, and this was measured rather than assumed.** Its merged value
cannot change, so it becomes `const _s0 = _merge({ … });` at module scope and the site reads
`css={_s0}` — one allocation for the life of the program, however many elements carry it. 71% of the
blocks written to be read in this repository carry no hole, and merging at the site would have cost
0.86 µs per element against 0.001 µs for reading a hoisted value.

A block WITH holes is built where it is written, because its values are the render's — one
allocation, which is what a per-element value costs.

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

## 1b. What a block compiles to under COMPOSITION — frozen 2026-09-05, built as AC0–AC8

An earlier shape gave one class to a whole block, and it cannot express composition: measured, the
order of classes in a `class` attribute decides nothing, so two whole-block classes cannot say which
one wins. The build is atomic — one rule per DECLARATION — and this is the part both halves have to
agree on.

**The cross-package contract does not change, and that was measured rather than hoped.** A merge
produces exactly the `StyleValue` in §2: a class string, property names, values. The only difference
is that the string holds several classes separated by spaces, which is what a class attribute is for
— and the framework already handles that, asserted end to end in `CssBlock.test.tsx`. **Nothing in
`@ramonda/core` changes.** Everything below lives inside `@ramonda/css`.

### The map

A block compiles to a map from **what a declaration sets** to **the class that sets it**:

```ts
/** A declaration with no holes is its class; one with holes is its class and its values in order. */
type StyleEntry = string | readonly [className: string, ...values: StyleVarValue[]];

/** What one `@@( … )` becomes. Keys are canonical — see below. */
type StyleMap = { readonly [key: string]: StyleEntry };
```

```
                                       source
const panel = @@(
  display: flex;
  color: {accent};
  &:hover { color: #0e9f6e; }
);

                                       emitted
const panel = _merge({
  "display": "r-disp-flex",
  "color": ["r-OsXzXT1Qd", accent],
  ":hover|color": "r-:hover-c-#0e9f6e",
});
```

and the stylesheet gains one rule per entry:

```css
.r-disp-flex { display: flex }
.r-OsXzXT1Qd { color: var(--r-OsXzXT1Qd-0) }
.r-\:hover-c-\#0e9f6e:hover { color: #0e9f6e }
```

**The map is an ARGUMENT to `merge`, not the value itself.** Written as a bare object it would have
none of the things a `css` prop needs — see §2 — and a merge is what turns one map, or several, into
a value. The characters a class name may not hold are escaped in the STYLESHEET and left alone in the
map, because a class attribute holds the name and a selector holds its escaping.

Note the key: `:hover|color`, with no `&`. The `&` is CSS nesting's way of saying "this element", and
the key is what a selector composes to — so it is dropped rather than carried.

### The key, and it is canonical rather than as-written

`[at-rules, sorted] [selector, composed in order] property`, joined by `|`. Two rules, each for a
reason:

- **At-rules are SORTED**, because they commute — measured in Chromium,
  `@media X { @supports Y { … } }` and `@supports Y { @media X { … } }` are the same rule. Without
  sorting, two authors writing the same CSS in a different nesting order would get different keys, so
  a modifier would silently fail to override a base.
- **Selector parts are COMPOSED IN ORDER**, because they do not commute: `&:hover` inside `& .title`
  is `& .title:hover`, and the reverse is a different selector.

### The variable name for a hole

`--<the declaration's own class>-<n>`, `n` counting holes within that declaration. The same rule as
§3 one level down: scoped to what it belongs to, never positional across a block.

### The merge, which is where composition happens

Later wins per key, and **a later shorthand clears its own longhands** — CSS's own cascade, from a
table generated out of mdn-data. That second half is not a nicety: a shorthand and its longhand are
different properties, so without it both classes land and the SHEET breaks the tie, possibly against
the call site. Measured, it agrees with CSS in both directions for `padding`, `border-left` and `gap`.

**The merge is associative** — 50,309 random groupings, zero disagreements — which is what lets a
nested `if` be COMPILED as a nested merge:

```
if ({a}) { color: red; if ({b}) { color: blue; } }
->  _merge(a && _merge({ "color": "r-c-red" }, b && { "color": "r-c-blue" }))
```

**Associativity is what makes that shape correct; it was never a guarantee that the transform emitted
it.** Measured on 2026-09-07, it did not: the outer guard was dropped, so the inner group applied on
its own. A guard can be written into the output exactly once — an expression stays where the author
put it, which is what keeps the map exact — so a nested segment needs a merge of its own rather than
a repeated guard. It opens one only when more than one thing sits under it, and a group with a single
member is still the shorter `a && b && { … }`.

### The sheet's emission order, which is a rule rather than an accident

Shorthands before their longhands, and unconditional rules before conditional ones. Measured: a
`@media` rule beats a base rule for the same property **only if it is emitted after it**, and a
longhand emitted before a shorthand loses to it.

---

## 2. What a compiled value IS, and what the `css` prop accepts

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
- **A hole may be a number** because plenty of properties take one. It is the per-property types that
  refuse `padding: 24`, not this.
- **The arity is checked.** `block()` takes the property names as a tuple, so a call with the wrong
  number of arguments is a type error.
- **`block()` is not what the compiler emits.** It emits `_merge({ … })`, one class per declaration,
  which is what makes composition possible at all — see §1. `block` stays public for an adapter
  building a value by hand. **This document, the README, `DESIGN.md` and `PLAN.md` all showed
  `block(…)` as the compiler's output long after it stopped being one**, which is how a reader
  learned to write `merge(block(…))`.
- **A value carrying no map composes with nothing.** A map says what each class SETS; `block()`
  throws that away, so such a value lands — its class and its holes — and takes part in no override.
  Merging one used to read its own fields as declarations and put the word `undefined` into a class
  attribute.
- **One function turns a value into `{ className, style }`** — `toStyleObject`. That is the entire
  adapter surface a wrapper on another JSX library needs; Ramonda applies it natively instead.
- **There is no brand.** A runtime diagnostic — `RMD064` — tells a compiled value from a hand-written
  object by its shape, and a hand-written object that matches the shape exactly is a working value.
- **A value that is not a string or a finite number is not written, and neither is one containing a
  `;`.** See below — this is a requirement on every consumer of a value, not an implementation detail
  of one.

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

**The rule is about TEXT, so it is asked of the text, and the kind is asked first.** A custom
property holds text, so `String(value)` produces something for anything — which means a consumer that
asks `typeof value === "string"` before the value becomes text has not asked the question at all.
Measured: `{ toString: () => "red; position: fixed; …" }` went past exactly that check and came back
off a server render as applied declarations. And the kinds a hole is given by mistake — `true`, `{}`,
a function, `NaN` — all produce text no property can parse, so writing them leaves the declaration to
fall back with nothing said. A hole's value is **a string, or a number `Number.isFinite` accepts**,
and nothing else is written.

Implemented in both consumers that exist: `toStyleObject` here, and `applyCssBlock` in the framework.
Both are named `textFor` and `scripts/check-css-contract.mjs` compares the two bodies as text.
Saying it out loud to the author is the runtime diagnostic — `RMD063`, which names which of the two
reasons it was.

## 3. The names

A class name says what its rule DOES, and falls back to a hash only when it cannot.

| | |
|---|---|
| class, written | `r-`, a short spelling of the property, `-`, and the value as written — spaces as `_`, the context in front |
| class, hashed | `r-` + **9** base62 characters of `sha256(normalised)` |
| custom property | `--<class>-<n>`, `n` being the hole's 0-based index in source order |

```
padding: 12px                            r-p-12px
display: flex                            r-disp-flex
&:hover { color: red }                   r-:hover-c-red
color: {accent}                          r-OsXzXT1Qd     a hole
grid-template-columns: repeat(auto-…)    r-cb29PN6m0     over budget
@media (min-width: 40rem) { gap: 8px }   r-e1HIiLE0b     an unspellable context
```

**The hash is the FLOOR, not the norm**, and there are four ways to reach it: the declaration holds a
hole, the name would exceed its budget, the value holds a character a class name may not, or the
context cannot be spelled. Measured on this repository's own blocks, 82% are written rather than
hashed, at a median of 14 characters.

**Written names are SMALLER gzipped** — 1469 B → 1430 B on the measured corpus — because they share
substrings with each other and hashes share none. Readability was not bought with bytes.

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
assembled, which sees every block at once; the hash's length only makes that assertion a tripwire
that never trips. Nine base62 characters is about 53.6 bits, and a written name collides only if two
different declarations spell the same — which they cannot, because the first `-` after the
abbreviation is the boundary and no abbreviation holds one, so the spelling is injective.

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

**Every node also carries where it was**, left out above because normalisation never reads it: `at`
on a declaration and its `valueAt`, `at` and `preludeEnd` on a rule, `at` and `length` on a hole, and
`at` on a run of text. They exist for the checker's squiggles and the editor's mapping, which answer
in the author's coordinates. A text part may also carry `resolved`, which says the text is this
compiler's own — a reference to a named site — and so holds nothing anybody can act on.

The canonical form is `property:value;` per declaration and `prelude{…}` per nested rule, joined in
source order. **Written down as a rule, and tested as a table in
`src/__tests__/normalise.test.ts`:**

| thrown away | kept |
|---|---|
| runs of whitespace, and whitespace at the ends of a value or a prelude | whitespace inside a string — `content: "a  b"` |
| the case of a property name (`COLOR`) | the case of a **custom** property (`--Accent`), which CSS reads as significant |
| the whitespace the author put around a declaration's colon | the space before a hole, which is a token separator |
| a trailing semicolon, present or not | the order of two declarations |
| | the case of anything in a prelude — `&:HOVER` stays, measured, because nothing here can tell a pseudo-class from a class name without a selector parser |
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
border-left: {…};                ✓   becomes  border-left: var(--r-…-0)
{cond ? "display:flex" : ""}     ✗   a declaration — nothing to put a variable in
{name}: 24px;                    ✗   a property name — unless it RESOLVES, see below
&:{state} { … }                  ✗   a selector
if ({cond}) { … }              ✓   a condition, and the parentheses are the at-rule's head
...{base};                       ✓   a spread, in a declaration's position
```

**A hole in a property NAME is the one exception, and it is the only way to set a registered
property.** `{accent}: #f05` where `accent` is a `@@property( … )` declared in this file — or
imported from a module, one relative hop — resolves to that site's generated name before any rule
sees it. Unresolved, it is refused as above.

The same resolution is why `var({accent})` works and `var({runtimeValue})` cannot: `var()` takes a
literal name, so a hole that stays a hole compiles to `var(var(--…))`, which computes to nothing —
measured in Chromium, dropping that declaration and leaving the one beside it applied. Reported as
`hole-as-a-variable-name`.

## What this contract does not decide

One thing is left, and the four that used to be listed here have been settled — recorded because a
contract that still calls a decided thing open is a contract nobody trusts on the parts that matter:

- **where the sheet is linked** is still the sheet assembly's, and no syntax, type or compiled value
  depends on it.

Settled since this was written:

- **the `@layer` name is `ramonda`, and it is not configurable.** `config.ts` refuses `layer` beside
  `prefix` and `hash`, for the same reason: two packages emitting a block into different layers give
  it a different precedence, which is a page changing because of who imported it. The divergence
  from plain CSS this creates is documented under its own heading on `style-blocks.md` rather than
  presented as a convenience.
- **123 properties get a real union**, `UNION_TYPED` in the generated table, and the rest take
  `string | number` with the CSS rules judging the value instead.
- **a nested rule's prelude composes in order and drops the `&`** — see §1b's key.
- **splitting one sheet into several** is done, and `scripts/check-css-splitting.mjs` is what keeps
  the classes in the JavaScript and the classes in the CSS the same set.

## Why the package is private

`@ramonda/css` is `"private": true` and version `0.0.0` until the feature works end to end. It is in
the workspace so every gate sees it — it lints, type-checks, tests and builds with everything else —
and it is not on npm, because a published package whose only export is a value nothing produces yet
would be a promise this cannot keep. Publishing it means adding it to `scripts/check-side-effects.mjs`
and to the docs' API coverage, both of which are how a new public surface gets acknowledged here.
