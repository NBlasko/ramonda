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

`scripts/check-css-contract.mjs` used to keep the two halves' SHAPES in step across a package
boundary neither may import. **It is gone, with the shape it compared**: a block is a string on both
sides, there are no fields to drift, and the one rule a consumer had to implement is now this
package's own — see §2. Nothing checks this prose, so it is worth reading against the code whenever
the code moves, and this paragraph is here so the next reader knows it is not automatic.

Read this and you can write the transform, a renderer's own handling of the value, the property types, the
stylesheet assembler or a wrapper for another JSX library **without reading the other side**.

---

## 1. What a block compiles to

One hoisted constant at module scope, or a merge at the site when the render decides something.

```
                                       source
<div className=@@(
  display: flex;
  border-left: match $(this.tone) { loud => 4px solid #10b981; _ => 4px solid #64748b; };
)>

                                       emitted
import { mergeClassNames as _merge, pick as _pick, shorthands as _clears } from "@ramonda/css";
_clears({"bl":["blc","bls","blw"]});

<div className={_merge("r-disp-flex", _pick(this.tone, {"loud":"r-bl-4px_solid_#10b981"}, "r-bl-4px_solid_#64748b"))}>
```

and the stylesheet gains one rule per declaration

```css
.r-disp-flex { display: flex; }
.r-bl-4px_solid_\#10b981 { border-left: 4px solid #10b981; }
.r-bl-4px_solid_\#64748b { border-left: 4px solid #64748b; }
```

`_clears` is the shorthand's clear-list, registered once per module — see §2. And two classes differ
because their declarations do: **a class is a function of the declaration alone**, so no two distinct
declarations can share one.

**A block that decides nothing at render time is HOISTED, and this was measured rather than
assumed.** It becomes `const _s0 = _merge("…");` at module scope and the site reads `className={_s0}` —
one allocation for the life of the program, however many elements carry it. Merging at the site
would have cost 0.86 µs per element against 0.001 µs for reading a hoisted value.

A block holding a condition, a spread or a `match` is merged where it is written, because what it
composes is the render's.

Three properties of this shape are load-bearing:

- **The expression is an argument.** The compiler concatenates nothing and builds no string, so
  nothing has to be escaped at compile time — and nothing an expression evaluates to ever reaches
  the CSS, because a runtime value in a declaration is refused.
- **The expression's own bytes never move.** The transform rewrites the CSS *between* the
  expressions and leaves each expression where the author wrote it, which is what keeps the source
  map landing on the author's line.
- **The expression is not part of the block's identity.** Two blocks with identical CSS and
  different subjects are the same classes and the same rules.

## 1b. What a block compiles to under COMPOSITION — frozen 2026-09-05, built as AC0–AC8

An earlier shape gave one class to a whole block, and it cannot express composition: measured, the
order of classes in a `class` attribute decides nothing, so two whole-block classes cannot say which
one wins. The build is atomic — one rule per DECLARATION — and this is the part both halves have to
agree on.

**A merge produces exactly the `StyleValue` in §2**, which is now the class string itself. The
framework adds it to `className` and does nothing else, asserted end to end in `CssBlock.test.tsx`.

### The classes

A block compiles to its **classes**, and each one carries what its declaration sets — see `keyToken`
in `compiler/names.ts`. There is no map: the key used to be a map key and is in the class name now,
which is what lets a block travel to another component as a string and still be merged.

```
                                       source
const panel = @@(
  display: flex;
  color: $color.accent;
  &:hover { color: #0e9f6e; }
);

                                       emitted
const panel = _merge("r-disp-flex r-c-var(--color-accent) r-:hover.c-#0e9f6e");
```

and the stylesheet gains one rule per class:

```css
.r-disp-flex { display: flex }
.r-c-var\(--color-accent\) { color: var(--color-accent) }
.r-\:hover\.c-\#0e9f6e:hover { color: #0e9f6e }
```

The characters a class name may not hold are escaped in the STYLESHEET and left alone in the string,
because a class attribute holds the name and a selector holds its escaping.

**`mergeClassNames` is still the call, and a static block still makes it once**, at module scope: a shorthand
inside one block clears its own longhands there too, and that is what the call is doing. A block
holding a condition, a spread or a `match` merges where it is written, because what it composes is
decided in the render.

### The key, and it is canonical rather than as-written

**What a declaration SETS**: its at-rules, its selector and its property. It is written into the
class name — `r-<key>-<value>`, the first `-` ending the key — and `keyIn` reads it back out. Two
rules for how it is composed, each for a reason:

- **At-rules are SORTED**, because they commute — measured in Chromium,
  `@media X { @supports Y { … } }` and `@supports Y { @media X { … } }` are the same rule. Without
  sorting, two authors writing the same CSS in a different nesting order would get different keys, so
  a modifier would silently fail to override a base.
- **Selector parts are COMPOSED IN ORDER**, because they do not commute: `&:hover` inside `& .title`
  is `& .title:hover`, and the reverse is a different selector.

### The merge, which is where composition happens

Later wins per key, and **a later shorthand clears its own longhands** — CSS's own cascade, from a
table the module REGISTERS for the shorthands it writes; see §2. That second half is not a nicety: a shorthand and its longhand are
different properties, so without it both classes land and the SHEET breaks the tie, possibly against
the call site. Measured, it agrees with CSS in both directions for `padding`, `border-left` and `gap`.

**The merge is associative** — 50,309 random groupings, zero disagreements — which is what lets a
nested `when` be COMPILED as a nested merge:

```
when $(a) { color: red; when $(b) { color: blue; } }
->  _merge(a && _merge("r-c-red", b && "r-c-blue"))
```

**Associativity is what makes that shape correct; it was never a guarantee that the transform emitted
it.** Measured on 2026-09-07, it did not: the outer guard was dropped, so the inner group applied on
its own. A guard can be written into the output exactly once — an expression stays where the author
put it, which is what keeps the map exact — so a nested segment needs a merge of its own rather than
a repeated guard. It opens one only when more than one thing sits under it, and a group with a single
member is still the shorter `a && b && "…"`.

### The sheet's emission order, which is a rule rather than an accident

Shorthands before their longhands, and unconditional rules before conditional ones. Measured: a
`@media` rule beats a base rule for the same property **only if it is emitted after it**, and a
longhand emitted before a shorthand loses to it.

---

## 2. What a compiled value IS, and where it goes

```ts
declare const COMPILED: unique symbol;

/** The classes a block compiled to, space separated. */
type StyleValue = string & { readonly [COMPILED]: true };

type CssBlock<A extends CssBlockShape = CssBlockShape> = StyleValue & { readonly [ALLOWS]: A };
```

- **`className` accepts a `StyleValue`, or nothing.** `className={cond ? _s0 : undefined}` removes
  the classes — measured through a real hydration, both directions, and the DOM ends up right either
  way. That is the whole adapter surface a wrapper on another JSX library needs: a block is a string,
  so there is nothing to turn it into.
- **There is no `css` prop.** It was one while a block was an object carrying custom property names
  and this render's values for them, which `className` could not have held.
- **The BRAND is a phantom.** It emits nothing and exists at no runtime — the value is the string.
  What it buys is that a plain `string` cannot stand where a block is wanted, and that
  **concatenation loses it**, so `` `${a} ${b}` `` cannot be handed to a block position and the merge
  cannot be bypassed with `+`.
- **A block that differs across hydration is reported on `class`**, like any other class, and
  repaired. That is a change and a gain: the values a hole carried were applied after the attribute
  pass, so nothing compared them and a divergence was silent.
- **Nothing at run time tells a block from something else.** `RMD064` did, by asking whether the
  value was the shape a compiler produced — and there is nothing left to ask: a block is a string,
  `className` takes a string, and a hand-written one that looks like a block IS one. That is what
  makes `className={panel}` work at all.

### What a class string cannot carry, and who carries it

Two things, and each is REGISTERED by the module whose blocks need it rather than shipped to every
page. A table of all 98 shorthand families is 23 KB, 3.7 KB gzipped — larger than the whole runtime.

- **`shorthands({ p: ["pl", "pr", "pt", "pb"] })`** — what a shorthand clears, keyed by the property
  as a KEY writes it. The context composes itself: a key is `<context><property>`, so
  `@media_print.p` clears `@media_print.pl` by putting the same context back in front, and that
  works for a hashed context too because the hash is a function of the context alone.
- **`conditionsOf` and `namesOf`** — the conditions a key sits under and the CSS name behind a
  property form, read only by the development order-warning. Emitted inside a
  `process.env.NODE_ENV !== "production"` guard, which a bundler drops.

### The one rule a consumer of a value must implement

**There is none any more, and that is the change worth writing down.** A block sets nothing on an
element: it is classes, and a class name is a name.

The rule there used to be belonged to the values a `$(expr)` hole carried, which went into a `style`
attribute. A value is whatever the author's expression evaluated to, and an expression can read a
record — so a value holding a `;` became a SECOND declaration when a server-rendered attribute was
parsed back out of HTML. Measured through `renderToString` and back through `innerHTML`:
`red; position: fixed; width: 100vw` came out as real, applied declarations.

A runtime value in a declaration is refused now — `hole-not-allowed` — so the hazard moved to the one
place a value still reaches an element, which is `toStyle` in this package. It refuses a value
holding a `;`, a non-finite number, and anything that is not a string or a number, and leaves the
property UNSET rather than writing something else: an unset custom property makes the declaration
reading it invalid at computed-value time, so that declaration drops and whatever the stylesheet said
stands. A missing border beats an overlay.

## 3. The names

A class name says what its rule DOES, and falls back to a hash only when it cannot.

`r-<key>-<value>`. The **key** is what the declaration sets — its context and its property — and the
first `-` ends it, so nothing inside it may be one: a property's own dashes are written `_`, and the
context joins the property with a `.`.

| | |
|---|---|
| key, written | the context, a `.`, then the property abbreviated or written with `_` for its dashes |
| key, hashed | `0` + 5 base62 characters for the context alone, or `0` + 6 for the whole key |
| value, written | as written, spaces as `_` |
| value, hashed | **9** base62 characters of `sha256(normalised)` |

```
padding-top: 12px                        r-pt-12px
display: flex                            r-disp-flex
&:hover { color: red }                   r-:hover.c-red
outline-offset: 4px                      r-outline_offset-4px
content: "a b"                           r-content-5dEHlFqj2   an unspellable value
@media (min-width: 40rem) { gap: 8px }   r-03noXL.gap-8px      a context holding a `-`
```

**Each half falls back on its own, and the KEY is never given up**: a merge reads it, and a block
that travels to another component has only its classes to say what it sets with. A written key never
begins with `0`, because no CSS property may begin with a digit and every context begins with `:`,
`.`, `_`, `@` or `[`.

**The hash is the FLOOR, not the norm.** A value hashes when it would exceed the budget or holds a
character a class name may not; a context hashes when it is a selector list, holds a quote, or holds
a `-`. Measured on this repository's own blocks: 23 of 91 names had nothing readable in them before
the key was written into them, and none do now.

**Written names are SMALLER gzipped** — 1469 B → 1430 B on the measured corpus — because they share
substrings with each other and hashes share none. Readability was not bought with bytes.

**The prefix is fixed, not configurable.** A configurable prefix means two packages emitting
different names for the same block, and identical blocks deduplicating to one rule with no registry
and no coordination is the property the whole design rests on.

**The length guarantees nothing.** Two different blocks landing on the same name is a birthday
problem and probability is not a promise. The guarantee is the assertion made where the sheet is
assembled, which sees every block at once; the hash's length only makes that assertion a tripwire
that never trips. Nine base62 characters is about 53.6 bits, and a written name collides only if two
different declarations spell the same — which they cannot, because the encodings above are injective.
**A KEY collision is asserted the same way**, and it has to be: two rules setting different things
under one key would look to a merge like one thing set twice, and the earlier would be dropped from a
page that renders.

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
| the whitespace the author put around a declaration's colon | the space before a `match`, which is a token separator |
| a trailing semicolon, present or not | the order of two declarations |
| | the case of anything in a prelude — `&:HOVER` stays, measured, because nothing here can tell a pseudo-class from a class name without a selector parser |
| | number forms, colour forms, keyword case — see below |

**The asymmetry that decides every one of those.** A missed merge costs one duplicate rule in a
stylesheet. A wrong merge changes a page nobody edited, in a way no test of either block alone can
find. So normalisation folds only what provably cannot change meaning, and where there is any doubt
it keeps the difference — `.5px` and `0.5px`, `#FFF` and `#ffffff`, `FLEX` and `flex` are all safe to
fold in principle and are deliberately not folded, because each needs a value parser to do safely and
each buys back a rule that was going to be duplicated anyway.

**Hashing happens before any post-processing, and post-processing may not rename.** The server build
and the client build never speak; each hashes its own copy and both write the result into markup that
has to match.

---

## Where `{ }` may appear

A runtime value in a declaration is **refused**, everywhere — see `hole-not-allowed`. What is left is
the braces that CHOOSE rather than inject, and none of them puts a value on an element. Refused at
build time, with the source position, and reported by the checker first:

```
border-left: {width};            ✗   a runtime value — `match` or `@@property` instead
{cond ? "display:flex" : ""}     ✗   a declaration — nothing to choose between
&:{state} { … }                  ✗   a selector
when $(cond) { … }                ✓   a condition, and the parentheses are the at-rule's head
...$(base);                       ✓   a spread, in a declaration's position
color: match $(v) { … }          ✓   a subject, choosing between whole classes
{name}: 24px;                    ✓   a property name, when it RESOLVES — see below
```

**A name in a property position is the one that resolves rather than choosing, and it is how a
registered property is set.** `$(accent): #f05` where `accent` is a `@@property( … )` declared in this
file — or imported from a module, one relative hop — resolves to that site's generated name before
any rule sees it, so it is TEXT by the time the CSS is written. Unresolved, it is refused as above.

The same resolution is why `var($(accent))` works and `var($(anythingElse))` cannot: `var()` takes a
literal name, so a brace that stays a brace compiles to `var(var(--…))`, which computes to nothing —
measured in Chromium, dropping that declaration and leaving the one beside it applied. Reported as
`hole-as-a-custom-property-name`.

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
- **splitting one sheet into several** is done, and `scripts/css/check-css-splitting.mjs` is what keeps
  the classes in the JavaScript and the classes in the CSS the same set.

## Why the package is private

`@ramonda/css` is `"private": true` and version `0.0.0` until the feature works end to end. It is in
the workspace so every gate sees it — it lints, type-checks, tests and builds with everything else —
and it is not on npm, because a published package whose only export is a value nothing produces yet
would be a promise this cannot keep. Publishing it means adding it to `scripts/check-side-effects.mjs`
and to the docs' API coverage, both of which are how a new public surface gets acknowledged here.
