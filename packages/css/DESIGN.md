# A style block that becomes a class before the browser sees it

**Status: BUILT.** This header said *a design, not a package — no `package.json` on purpose*, and
that stopped being true when the package landed: `@ramonda/css` is a real workspace package at
`0.0.0`, private and unpublished, with a compiler, a check command, an editor plugin, two bundler
adapters and a formatter wrapper.

This file is the *why*, and it is the oldest of the three. `PLAN.md` is the *when*; `CONTRACT.md` is
what both halves must agree on.

**It can drift, and it had — read on 2026-09-07 against the code it describes, six claims were
wrong.** The header above was one. Decision 1 forbade a hole in a property name, which is now the one
thing that makes a generated custom property settable; decision 2 promised an `initial` floor that is
not emitted; decision 4 recommended one class per BLOCK where one class per DECLARATION ships;
decision 6 named a shape that moved; and a whole section listed as *verified but not yet built* is
built. Each is corrected in place, with what replaced it and why, rather than deleted — the
reasoning is what stops the next version arriving by drift instead of by decision.

---

## What is being built

The style is written beside the markup, in CSS:

```
<div css=@@(
  display: flex;
  flex-direction: column;
  padding: 24px;
  background-color: #0f172a;
  border-left: {isOnline ? "4px solid #10b981" : "4px solid #64748b"};
)>
  <h3 css=@@( margin: 0; color: #ffffff; )>Nikola</h3>
</div>
```

The build emits a class for everything that cannot change, and a custom property for everything that
can. Nothing about the style is in the bundle, nothing is rebuilt per render, and the browser caches
the sheet as a file:

```css
.r-8e271c6c1f3a4b02 { display: flex; flex-direction: column; padding: 24px;
              background-color: #0f172a; border-left: var(--r-8e271c6c1f3a4b02-0); }
```

```tsx
<div className="r-8e271c6c1f3a4b02" style={{ "--r-8e271c6c1f3a4b02-0": isOnline ? "4px solid #10b981" : "4px solid #64748b" }}>
```

**Static structure, dynamic values, never dynamic rules.** That invariant is what buys the whole
list: zero runtime, a cacheable sheet, server rendering with no injection, and styles a checker can
read. Everything below follows from it.

---

## The three constraints, and they are not negotiable

**1. It works the way JSX works.** `<div>` is not valid JavaScript either. JSX is usable because
somebody wrote the parser, the type support and the tooling for it. This is the same undertaking, at
a much smaller scale, and it is the reason the feature can look like CSS instead of like a string.

**2. It is opt-in, and the fallback is ordinary JSX.** This is the difference from the frameworks
that solved it with their own file format: there, the format is the price of admission. Here a file
that does not use it is untouched, valid TSX, checked by the ordinary compiler. **Consequence for the
implementation:** the transform must be a cheap no-op — a substring scan for the sigil, before any
parsing — so a codebase that never uses it pays nothing and cannot be broken by it.

**3. It does not know Ramonda exists — technically, not organisationally.** No import from the
framework, no dependency, nothing in the emitted value that names it. It still lives under the
`@ramonda` org, and there is a precedent for exactly that: **`@ramonda/lens` has no dependencies at
all** — not even a peer on core — and its source never imports the framework. Somebody on another
JSX framework needs a small wrapper for the prop and nothing else.

---

## Why the syntax cannot be a string, and what that forces

There is no syntax that is **both** valid TypeScript **and** raw CSS. Inside TypeScript, CSS text is
either a string literal or a parse error. That is not a limitation of any particular delimiter — it
is what "valid TypeScript" means.

So the choice is real and it only has two sides:

| | |
|---|---|
| **objects** (`{ display: "flex" }`) | typed by `tsc` for free, and it is not CSS |
| **CSS text** (`display: flex;`) | reads like the language it is, and nothing standard checks it |

Choosing CSS text means **we build the checking**. That is the cost, and it is also where the
feature stops being a nicer spelling of something that exists.

---

## How type safety actually arrives

Two checkers, each doing the half it is good at.

### The interpolated expressions — `tsc`, through a virtual file

`{isOnline ? … }` is TypeScript and has to be checked as TypeScript, in its real lexical scope,
with the surrounding file's imports and generics intact. The way to get that from a compiler that
cannot parse the file is the same three moves the file-format frameworks make:

1. transform the author's file into a **virtual file** that is valid TSX, recording where every
   carried-over expression landed;
2. hand the virtual file to `tsc`;
3. map each diagnostic back through that record.

**`prototype-typecheck.mjs` does exactly this, and it works.** Run against `example.tsx`, which puts
a genuine type error inside a hole:

```
packages/css/example.tsx(13,27): error TS2339: Property 'toUpperCase' does not exist on type 'number'.
      border-left: {accent.toUpperCase()};
```

Line 13, column 27, in the file the author wrote — not in a generated file, not "somewhere in this
block". The error is `tsc`'s own, with `tsc`'s own message.

**The load-bearing observation:** the transform that produces the virtual file and the transform the
build needs are **the same transform**. This is not two implementations of one idea; it is one
implementation used twice. That is what makes the whole thing affordable.

### The CSS text — typed through the same virtual file

**Measured, and the answer is better than expected: the block itself type-checks.** The trick is what
the declarations become in the virtual file — an **object literal**, not a string:

```ts
declare function __block(declarations: Partial<CssProperties>): string;

__block({ position: "statik" });             // value typo
__block({ dsiplay: "flex" });                // key typo
__block({ padding: nekaFunc() });            // a hole returning the wrong type
__block({ padding: "10px 20px" });           // correct — silent
```

`tsc --strict`, verbatim:

```
TS2820: Type '"statik"' is not assignable to type
        'Keyword<"fixed" | "absolute" | "static" | "relative" | "sticky"> | undefined'. Did you mean '"static"'?
TS2561: Object literal may only specify known properties, but 'dsiplay' does not exist
        in type 'CssBlockShape'. Did you mean to write 'display'?
TS2322: Type 'boolean' is not assignable to type 'CssValue | undefined'
```

**Two conditions on that, both found by measurement and neither obvious.**

**The key has to be UNQUOTED.** `{ "dsiplay": … }` gets `TS2353` and no suggestion at all. So the
virtual file writes a property bare whenever it is a valid identifier — and a dashed name,
`flex-direction` or `border-left`, cannot be, so those get the plain message and their near miss
belongs to the CSS checker.

**The value typo only works where the grammar is a closed keyword set**, which is why the example
above is `position` and not `display`. See the table below.

Three things fall out of that one encoding, and they were three separate questions:

- **a typo in the property name**, with TypeScript's own *did you mean* — because an object literal
  gets excess-property checking, which an argument list does not;
- **a typo in a value**, likewise, for the 123 properties whose grammar is a closed keyword set;
- **a hole checked against the property it belongs to.** `padding: {nekaFunc()}` is checked against
  `CssProperties["padding"]`, so the function's return type has to be something padding accepts. That
  was the hardest-sounding request and it costs nothing extra: the hole simply lands in the value
  position of the object literal, and the mapping back to the author's line is already proved.

**And IntelliSense is the same mechanism, not a second one.** Completion inside the block is ordinary
TypeScript completion on an object literal, served by the language-service plugin from the virtual
file. Property names, then the value union for the property just typed.

#### The honest limit, and it is a dial rather than a switch

A template literal type does catch `padding: 10pxx` — measured. But look at what it says when it
does:

```
TS2322: Type '"10pxx"' is not assignable to type 'Length | "0 0" | `0 ${number}px` |
  `0 ${number}rem` | `0 ${number}%` | `${number}px 0` | `${number}px ${number}px` |
  `${number}px ${number}rem` | … 4 more … | undefined'
```

Unreadable, and it grows combinatorially with every shorthand position. So the split is:

| kind of property | typed as | who catches a typo |
|---|---|---|
| a closed keyword set (`position`, `flex-direction`, `text-align`, …) | a real union | **the types** — with *did you mean* |
| everything else | `string \| number` | **our CSS checker**, where we write the message |

The type system takes the half it is good at and stays readable; the checker takes the half where a
grammar is needed and a human-written message is worth more than an expanded union.

**Measured when the map was generated, and it moves `display` across the line.** Of 551 non-prefixed
properties in MDN's data, **123 have a grammar that is a closed `|` list of keywords** and 428 do
not. `display` is one of the 428: its grammar allows `inline flow-root`, so a union of its single
keywords would reject valid CSS. It was the example in this table and it should not have been —
**rejecting valid CSS is the one failure a type map may not have**, so the line is drawn at whether
the grammar is genuinely closed, not at whether the property feels enumerable.

Three things every union also has to allow, each a false error before it was added: the CSS-wide
keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`), `var(…)`, and `!important`. They
are folded into one named alias, `Keyword<…>` — and the NAME earns its place, because TypeScript
prints the alias in a diagnostic instead of expanding the union:

```
TS2820: Type '"statik"' is not assignable to type
  'Keyword<"fixed" | "absolute" | "static" | "relative" | "sticky"> | undefined'. Did you mean '"static"'?
```

### That the emitted CSS survives the pipeline

If the sheet is handed to a post-processor, whatever it does must not break the HTML that already
names the classes — and a minifier is allowed to merge and rename rules.

*Recommended:* a **round-trip assertion** at the end of the build. Every class the transform emitted
must still be present in the final stylesheet, and every `var(--rN)` it promised must still be
referenced. A rule that vanished or was renamed fails the build, instead of shipping markup pointing
at a class that is not there.

---

## The syntax

`@@( … )` with `{ … }` holes.

**It began as `@( … )`, and the second `@` was bought with two measurements.** `@(expr)` is *already*
valid TypeScript in two places, and both compile:

```ts
class C { @(dec) m() {} }
class C { constructor(@(inject()) private x: number) {} }
```

In a decorator-heavy framework that is not a footnote. It forced the opening to be recognised only
after `name =` — which is what kept a block out of every ordinary expression position: an argument,
an object value, an array item, a branch of a ternary. **`@@(` is a syntax error everywhere**,
measured in all five positions, so the rule disappeared and a block goes where any other value goes.

The other half is the cheap pass, which runs on every file of every build — and it is the smaller
half. Measured on this repository at the commit before this parser landed, the substring `@(`
matched **2 of 1,093** tracked source files, and both were regular expressions, not decorators: an
ordinary decorator reads `@name(`, which does not contain `@(`. Only the parenthesised form `@(dec)`
does, and there were none. The second `@` buys a grammar that cannot collide with the language; it
does not buy a build that skips meaningfully more files.

**What one `@` cost, and it is the honest half:** the walk now has to know a regular expression when
it sees one. `/=@(x)/` used to be ruled out for free, because the `=` inside it is preceded by `/`
rather than by a name; with no rule about what stands in front of a block, a regex body is just text
that can contain anything. That is the classic lexer question and it is answered the classic way — a
`/` divides when something that can end an expression is behind it, and opens a regex otherwise.

---

## The four pieces of work

None of them is optional, and the order matters because each one is useless without the one before.

1. **The parser and the transform.** Source in, virtual TSX plus the extracted CSS plus a source map
   out. Pure, no bundler, no framework. Both prototypes here are the sketch of it.
2. **A check command**, so a build can fail. This is what `vue-tsc` and `svelte-check` are, and
   without it type safety is a claim about editors rather than about CI.
3. **The editor.** A TypeScript language-service plugin over the same virtual file, so completion,
   go-to-definition, rename and the red squiggle all agree with the check command. Without this the
   feature is technically safe and practically unusable.
   **And `ramonda-check` belongs in this piece, not in a fifth one** — it reads the author's source
   through the same virtual file, for the reason measured below.
4. **Bundler adapters.** Vite first — that is where dev and HMR live — then esbuild. Both exist.

---

## Speed, on a project that uses it everywhere

The number that matters is not what a codebase pays when it uses none of this — it is what an app
built *with* it pays, in every file. Measured on generated files shaped like components that carry
blocks throughout, against esbuild transforming the same files, because that is the cost a dev
server already pays and the only honest thing to compare with:

| | 1,000 files · 4,000 blocks · 1.53 MB | 3,000 files · 18,000 blocks · 6.4 MB |
|---|---|---|
| scan only, lexically aware | 3.4 ms | 14.8 ms |
| **scan + parse + hash + emit** | **15.5 ms** | **66.6 ms** |
| esbuild, the same files | 588.9 ms | 1,838.5 ms |
| **on top of esbuild** | **+2.6%** | **+3.6%** |

**15–22 µs per file**, and it scales linearly. In dev the figure that actually governs the experience
is smaller still: an edit re-transforms **one** file, so a keystroke-to-update costs tens of
microseconds of transform, and a style-only edit replaces that file's chunk of the stylesheet without
touching JavaScript at all.

Four properties keep it there, and each is a design constraint rather than an optimisation:

1. **The scan is one lexically-aware pass**, tracking strings, templates and comments — because
   finding `=@@(` is not the same as knowing it is an attribute rather than text. Measured at ~450 MB/s,
   it is a fifth of the total.
2. **No cross-file analysis, ever.** A class name is the hash of its own normalised text, so a block
   compiles knowing nothing about the rest of the app. That is what makes files independently
   cacheable, transformable in parallel, and re-transformable one at a time.
3. **The dev path does not type-check**, exactly as esbuild strips types without checking them and
   `tsc` runs beside it. Type checking lives in the check command and the editor, never on the hot
   path.
4. **Cached on content hash**, across restarts, because the transform is a pure function of the text.

For a codebase that uses none of it, the bail-out is what applies instead: over this repository —
1,268 files, 10.61 MB — the scan finds every block in **1.33 ms**, about 1.0 µs per file.

---

## What a block compiles TO, and why it is not a rewrite

The first draft of this section had the transform rewrite the call site into `className` and `style`,
splicing the expression into a template string. Three things are wrong with that, and they are worth
keeping written down.

**The compiler would be building strings.** `style={\`--r-8e271c6c1f3a4b02-0:${expr}\`}` means the transform
concatenates author code into attribute text, which drags in escaping — a `"` or a `;` out of a hole
must not be able to end the declaration or the attribute — for a problem that need not exist.

**It assumes the block is a JSX attribute.** It is not, necessarily. `@@( … )` is an expression, and
where it is written is not the transform's business: it may be assigned to a variable, returned from
a method, held in a field, or passed to something. A transform that only knows how to rewrite a
`<div>` has decided the feature is narrower than the syntax.

**It solved the double-render report in the wrong place.** See below.

### The shape instead: a value, and the compiler never builds a string

A block compiles to a **value**, and the expressions are transplanted verbatim into value positions.
Nothing is concatenated, so nothing has to be escaped.

```tsx
// static only — one class per declaration, hoisted to module scope and built once
const _s1 = _merge({ "font-size": "r-fs-18px" });
…
<h3 css={_s1}>

// with holes — the expression is an argument, in a value position, per render
<div css={_merge({
  "border-left": ["r-8e271c6c1f3a4b02", this.open ? "4px solid " + this.accent : "4px solid #64748b"],
  "~border-left": ["border-left-color", "border-left-style", "border-left-width"],
})}>
```

**`block()` is not what this emits, and has not been since the merge was written.** It is still a
public export — an adapter for another JSX library builds a value with it — and four documents
including this one showed it as the compiler's output long after it stopped being one. That is how a
reader learned to call `merge(block(…))`, which is a value carrying no map and composes with
nothing.

The expression is an argument, copied across untouched. The custom property reaches the DOM through
`setProperty("--r-8e271c6c1f3a4b02-0", value)`, which takes a raw string — so **the escaping problem the string form
created simply does not arise**.

And a block with no holes is a module constant: it costs one allocation for the life of the program,
not one per render. That is the common case.

### The prop is Ramonda's, and so is the exemption

The value needs somewhere to land, and that is a real `css` prop maintained in the framework — which
is also what makes the double-render question somebody's to answer rather than something to design
around.

**Measured: the object form is reported.** Rendering `style={{ "--r-8e271c6c1f3a4b02-0": this.accent }}` in a
development build prints, on every render:

```
[RMD020] render() produced a different value the second time
<Panel /> builds a new object or array for `[0] > div.style` on every render, with the same contents.
```

The static checker is silent on it — proved by planting two known faults first, so the silence meant
something, and `fresh-object-in-props` says so in its own advice: a host element hands nothing to a
component. The runtime is not silent, and the runtime is what a developer sees all day.

**The exemption is one line, in a place that already does this.** `compareAttributes` in
`core/src/debug/renderStability.ts` already skips keys at depth 0:

```ts
if (depth === 0 && key === "children") continue;
if (depth === 0 && declared !== undefined && declared.includes(key)) continue;
```

`css` joins that list. It is the same shape as the two exemptions beside it, in code that is already
tested, rather than a new mechanism — and it is correct rather than convenient: the value is
generated, its contents are decided at build time, and a fresh identity for it means nothing.

**What that costs, and it is the honest half:** the framework now owns a prop whose meaning comes
from a compiler. If the two disagree — a `css` value reaching the runtime that no transform
produced — the runtime has to say so rather than silently doing nothing.

**That diagnostic is deliberately LAST.** Diagnostics are this framework's signature and the reason
to expect a good one here, which is exactly why it should be written against a feature that has
stopped moving. Everything above can change what the right message is; nothing above depends on the
message existing.

### Elsewhere, and in another framework

Because the compiled form is a value, `@@( … )` outside JSX is the same feature with no special case:

```tsx
const panel = @@(
  display: flex;
  gap: 8px;
);

<div css={panel}>…</div>
```

**And the same reasoning gives a second spelling inside JSX**, `css={@@( … )}`, which is a value in the
braces JSX already has for one. It is not sugar: it exists because of a limit nothing in this package
can lift. **An editor stops consulting syntax injections the moment it enters a tag's attribute
list**, so a bare `css=@@( … )` is only coloured when it is the first attribute on the tag name's own
line — which is not how anyone writes a tag with several props. Inside braces there is no such limit,
at any position and on any line.

What the three spellings share is everything that matters: the same class, the same hash, the same
holes. Only what is replaced differs — a bare attribute needs the braces the author did not write,
and the other two must not have them, or a value becomes an object literal.

The package exports one function that turns a compiled value into `{ className, style }`, which is
what a wrapper on another JSX framework spreads. Ramonda applies it natively through the prop; nobody
else has to.

---

## Open decisions

**0. What a project's config generates, and what it looks like.** OPEN, and the shape is the whole
question. Three designs below, the same project written in each.

The constraint is not "what CSS allows" — that comes from the grammars and is already measured. It
is **what THIS project allows**, which is narrower and therefore more expressible. `<integer>` cannot
be a type: measured, neither `number` nor `` `${number}` `` refuses `1.5`. But `1 | 2 | 5 | 10` — a
scale a team chose for `z-index` — is a closed union and is exact.

Two constraints, deliberately separate, because `padding` is itself a shorthand and "no shorthands"
means two different things:

- **shorthand PROPERTIES** — `padding` does not exist; you write `padding-left`. The package already
  knows which 120 those are, read out of the engines.
- **ARITY** — `padding` exists and takes one value, so `padding: 8px 12px` is gone.

And the cost is settled: `prototype-strict-types.mjs` measures **+4 instantiations, flat** across 1,
12, 40 and 80 properties set in a block. The shape must be a WRITTEN-OUT interface — deriving one
with `Omit<Base, …>` is 2,531 against 30 — which is why the project generates its own file rather
than narrowing ours.

The three criteria are the user's, and they pull against each other: **quick to configure**
sometimes, **fine enough to argue about details**, and **shareable** — people publish a config and
others run codegen against it.

### A. A key per constraint, beside the ones that exist

```ts
export default {
  units: ["px", "rem"],
  shorthands: false,
  arity: 1,
  values: { "z-index": [1, 2, 5, 10] },
};
```

Exceptions change each key's shape:

```ts
  shorthands: { allow: ["margin"] },
  arity: { default: 1, padding: 4 },
```

Quick, and it matches `units` and `rules` exactly, so nothing new has to be learned. **Its weakness
is sharing:** a key that is `false | { allow: [] }` merges badly — two shared configs setting
`shorthands` differently have no obvious answer, and `{...base, ...mine}` silently takes one whole.

### B. Presets and `extends`

```ts
import { strict } from "@ramonda/css/presets";

export default {
  extends: [strict],
  shorthands: { allow: ["margin"] },
  values: { "z-index": [1, 2, 5, 10] },
};
```

The quickest of the three — one word buys a posture — and sharing is the mechanism rather than a
side effect: a team publishes `@acme/ramonda-strict` and everyone extends it.

**Its weakness is that merge rules become a feature.** What wins, how arrays combine, what a later
`extends` does to an earlier one: this is the part of eslint people complain about, and it has to be
answered before the first preset ships, not after.

### C. One map, keyed by property, with a wildcard

```ts
export default {
  properties: {
    "*": { shorthand: false, arity: 1 },
    margin: { shorthand: true },
    "z-index": { values: [1, 2, 5, 10] },
  },
};
```

Every per-property constraint in one place, and **the merge is the well-defined one** — two shared
configs merge key by key, and a project overrides one property without touching the rest.

**Its weakness is the quick path:** `"*"` is the one-line sweep, and it is a convention somebody has
to know exists. Nothing about the shape suggests it.

### D. A function, and the config author owns the merge

The user's own idea: stop inventing merge rules and let JavaScript do it. The config already supports
a function form — it is given `{ production }` — so a preset is a value you spread.

```ts
import { strict } from "@acme/ramonda-strict";

export default ({ production }) => ({
  ...strict,
  properties: {
    ...strict.properties,              // this line carries everything
    margin: { shorthand: true },
    "z-index": production ? strict.properties["z-index"] : { values: [1, 2, 5, 10, 9999] },
  },
});
```

Nothing to specify, arbitrary composition, and a preset needs no blessing from this package.

**And the user saw the cost immediately: "ako ga lose napisu, onda je config besmislen."** Worse than
meaningless — a config that lies. Drop the inner spread and every inherited constraint is gone, the
codegen writes types, `tsc` passes, and the team believes it has `z-index: 1 | 2 | 5 | 10`:

```ts
export default () => ({
  ...strict,
  properties: {
    margin: { shorthand: true },       // `...strict.properties` missing — one line
  },
});
```

**This is not hypothetical here. The function form has already produced exactly this failure, twice**
— both recorded in `config.ts`:

- `export default async () => ({ units: ["px"] })` enforced nothing and said nothing. A Promise is an
  object, so it passed every check and `Object.keys` of it was empty.
- `env.production` was wired nowhere, so every environment-dependent config silently took its
  development branch, production builds included.

Both have the same shape as the missing spread: **a wrong result indistinguishable from a deliberate
one.** With a declarative merge, not mentioning `properties` means "inherit". With a function, not
spreading it means "delete", and the two look identical from outside.

**The mitigation is to take away the silence, not the function** — the move
`ramonda-css-ignore` already makes, printed on every run whether or not anything failed:

```
[ramonda-css] ramonda.css.ts → src/css.generated.d.ts

  766 properties
    120 shorthand properties removed        padding, margin, border, …
    646 limited to one value
      1 given a value set                   z-index: 1 | 2 | 5 | 10
```

**Be honest about which half of that is possible.** The counts are arithmetic over what the function
returned, and they are real. The DIAGNOSIS — "you imported a preset and did not spread its
properties" — is not: the function has already run, and the preset does not exist as a separate thing
in its result. So the report can say *this config constrains 1 property out of 766* and let a person
stop; it cannot say why.

Whether that is enough is the decision. It is the difference between a config that can be wrong
loudly and one that can be wrong quietly.

### DECIDED: C, with the function as delivery and no `extends`

**C is the shape** — one map keyed by property, `"*"` for the default. Three reasons, the first
being the only one that is really about the long term:

1. **CSS grows, so the default has to be the strict one.** A deny-list — "forbid `padding`,
   `margin`" — lets every property CSS adds afterwards escape, silently, and in five years nobody
   knows how stale the list is. `"*"` says *everything, except these*, and covers a new property the
   day it lands. Strictness that does not renew itself is a moment, not a posture.
2. **C is what makes the function form survivable.** The danger of a function config is proportional
   to how many nested keys must be spread: design A would need `shorthands`, `arity`, `values`,
   `units` and `rules` — five chances to forget one. C has exactly ONE nested key, `properties`, so
   there is exactly one spread to get right.
3. **Presets then need no mechanism.** A preset is `export const strict = { properties: { … } }`, and
   you import and spread it.

**`extends` is refused**, and not because it is bad: merge rules become permanent public surface that
cannot be changed afterwards. eslint is the evidence — that part of it is its largest source of
complaint, and it grew from the same good intention.

**The report is a condition, not a decoration.** Silent loss survives this design: one missing
`...strict.properties` and the constraints are gone with everything green. The counts are arithmetic
over what the function returned and are real; the DIAGNOSIS is not, because the function has already
run and the preset no longer exists as a thing in its result. So the codegen can say *this config
constrains 1 property out of 766* and let a person stop. It cannot say why.

### The config's own type, and what it has to catch

The type is what guides somebody writing the config, so it is worth being exact. Measured against a
draft, all three are refused:

```ts
properties: {
  "z-indx": { values: [1] },     // TS2353 — not a property CSS has
  color: { shorthand: false },   // TS2353 — `color` is not a shorthand, so the key cannot exist
  padding: { arity: 7 },         // TS2322 — CSS gives padding at most four
}
```

The shape that does it: `arity` as `1 | 2 | 3 | 4` rather than `number`; `shorthand` only on the 120
names the engines say ARE shorthands, so the key is absent everywhere else; and the map keyed by the
generated property union rather than by `string`.

One trap while checking this: **TypeScript reports one excess-property error per object literal**, so
a literal with several faults appears to miss the first one. It does not — isolate the case before
concluding the type is loose.

### NO CONFIG IS A SENTENCE, NOT A DEFAULT

The obvious design is a permissive fallback: no `ramonda.css.ts`, no project constraints. **The user
refused it, and the reason is the one this package is built on:** *"brinem ako imam po defaultu konfig
koji sve dozvoljava jer ako ga ne setuju kako treba, moci ce da rade sta hoce, umesto da odmah budu
svesni da nisu setovali config i codegen."*

A permissive default is silent, and silence is what every other mechanism here exists to remove —
`ramonda-css-ignore` prints on every run, `check-first-publish` stops a release, `check-test-jobs`
refuses a partition nobody verified.

**And this is the only moment the decision is free: no project uses this package yet.** Requiring a
config costs nothing today and can never be made to cost nothing again.

So the absence is said out loud, with the command that fixes it, and `create-ramonda` scaffolds one
so the ordinary path never meets the message. What is still open is only its severity — a refusal, or
a line printed on every run.

**What the scaffolded config should contain is a separate question**, and the trap in it is real: the
obvious opinionated default, `"*": { arity: 1 }`, forbids `margin: 0 auto`. A default people delete
first is not a default.

### The completion table has to move with the types

`plugin.ts` deliberately offers nothing where a property already has a real union, and lets
TypeScript answer:

```ts
if (UNION_TYPED.includes(property)) return undefined;
```

**`UNION_TYPED` is a constant generated from OUR map and shipped in the package.** It knows nothing
about a project's config — so the moment codegen narrows `z-index` to `1 | 2 | 5 | 10`, the type
accepts four values while the editor still suggests everything CSS allows. **The editor would offer a
value the type refuses**, on day one.

It is a small repair and it belongs in the design rather than after it: `UNION_TYPED` stops being a
constant and becomes a question put to the config — *does this property have a union in THIS
project*. The plugin already reads the config for `units`, so the path exists.

This is the repository's recurring fault in its purest form: one question — *what may this property
hold* — with two consumers, the type and the completion, and a design that lets only one of them read
the answer.

### A `$.color.primary.main` syntax for variables — OPEN, and better than I first judged

The user's proposal: a third spelling for a custom property, `$.color.primary.main` instead of
`var(--color-primary-main)`, with three reasons. Two of them turn out to stand differently than
posed.

**"It does not create a hole" is already true of `var()`.** Measured through the real transform:

    var(--accent)   ->  "border-left": "r-bl-4px_solid_var(--accent)"     a class, no value
    {accent}        ->  ["r-J7FSVc8dZ", accent]                          a class AND a value

So a `var()` costs nothing per element and nothing on a change; the new syntax adds no capability
there. **The argument survives in a stronger form**, though: a hole costs 41 bytes an element and a
render, people reach for one anyway, and making the free path the SHORT path is a real lever. That is
a different claim from "it avoids a hole", and it is the one worth arguing.

**"It is shorter" barely is.** `$.color.primary.main` is 20 characters against 25 for
`var(--color-primary-main)`. Five characters do not carry a design decision.

**"Types from the config" is real, and has a cheaper route.** Generating the token names into the
VALUE type needs no new syntax and was measured to work, did-you-mean included:

```
background: "var(--colr-primary-main)"

TS2820: Did you mean '"var(--color-primary-main)"'?
```

~~Because that is a template-literal union, an editor completes inside the string and filters by
prefix — typing `var(--color-` narrows to the colours, which recovers most of what the nested
spelling is attractive for.~~ **Measured against the language service, and it does not.** On a scale
of 88 tokens in 6 groups, asked at the position an editor asks:

    a value typed as the flat union, empty string       88 offered
    the same union, after `var(--color-`                88 offered
    $.                                                   6 offered   color, font, motion, …
    $.color.                                             5 offered   border, primary, state, …
    $.color.primary.                                     4 offered   contrast, dark, light, …

The service returns the whole list at both string positions; the editor narrows what it DISPLAYS by
what has been typed. That is filtering, and filtering requires already knowing the name. The nested
object answers the other question — *what exists here at all* — and it is the question somebody
reaching for a token usually has. At two hundred tokens the gap widens rather than closes.

**The objection is the user's own principle.** This would be the THIRD spelling of one thing:

    var(--color-primary-main)   plain CSS, checked by our rule against every name the build sets
    var({accent})               a `@@property` binding, checked by TypeScript, compiles to a name
    $.color.primary.main        proposed

`Why the condition is inside { }` in the docs makes exactly this argument for `if ({ … })`: *the
moment there are two, every reader has to learn which one a given line is.* Three is worse.

**What only `$` can give, and the user did not raise it:** it is a real object, so rename-refactor
and go-to-definition work. A string in a union has no definition site, so renaming a token cannot be
an editor operation. With two hundred tokens that is not nothing.

**That recommendation was wrong, and the user overturned it with one question: how dare a type
report a variable that came from an outer scope?**

A custom property is an OPEN world — that is what inheritance is. A name may be set by an ancestor
block, by a stylesheet this does not compile, or from JavaScript as `style={{ "--x": … }}`. Measured,
a type cannot be open and catch a typo at the same time:

    closed  `var(--${Token})`                       typo REPORTED   `var(--row-height)` also reported
    open    `var(--${Token})` | `var(${string})`    typo silent     `var(--row-height)` fine

The did-you-mean only existed because the union was closed, and closing it refuses correct CSS —
which is the one failure this package may not have. That is exactly why the current design checks
variables with a RULE: it sees every name the whole BUILD sets, so a parent setting what a child
reads needs no ceremony; `variables` in the config covers names from outside; `var(--x, fallback)` is
CSS's own way of saying the name may be absent; and it can be silenced on one line. A type does none
of those.

**And this dissolves the objection above rather than the proposal.** `$` and `var()` are not two
spellings of one thing. They are spellings of two different things:

| | the world | what checks it |
|---|---|---|
| `$.color.primary.main` | **closed** — the tokens this project declared | the type: complete, with completion and rename |
| `var(--anything)` | **open** — including what an ancestor, a foreign stylesheet or JS sets | the rule: knows the whole build, and has an escape |

**The closed case has no spelling today.** `@@property` is the nearest thing and is not it: a
declaration per token, in a flat namespace, which is far too heavy for a scale of two hundred.

So the question is no longer "is a third spelling worth five characters" — it is whether the project's
own token scale deserves a closed, navigable namespace of its own, separate from the open world of
every other custom property. Put that way it is a much better proposal than the one I argued against,
and the arguments for it are the two that survive, both measured and both impossible through a
string: **rename-refactor**, because a member has a definition site and a string has none, and
**progressive completion**, because a union is one flat list however it is filtered.

#### Decided

**`$` is a superset spelling, and it compiles to `var(--name, fallback)`.** Nothing new reaches the
browser and there is no runtime: the stylesheet is what a hand-written `var()` produces. The fallback
is not decoration — it is what makes the value's type true, because a `var()` with no fallback can
resolve to nothing and a type that promised a colour would have lied.

**A group is an error; always write a leaf.** `$.color.primary` names three variables and no value.
Left alone TypeScript would say `Type '{ main: … }' is not assignable`, which names the shape instead
of the mistake, so groups carry a marker and the message says a group was named.

**A leaf has a kind, and it is WRITTEN — once per group.** Reading the kind off the fallback was
tried and refused: a value cannot say whether `"0"` is a length or a number, and guessing is worse
than asking. But writing it beside every variable is ceremony nobody keeps up. So `kind(…)` wraps a
GROUP and holds all the way down, and a subgroup may override it.

It earns its place twice. At the use site it is the type; in the config it **narrows the fallback
while it is being typed**, so the defaults are written against a real type rather than from memory:

```
kind("color",  { primary: { main: "30px"   } })   TS2322  not assignable to `#${string}` | rgb(…) | …
kind("length", { control: { md: "#3b82f6" } })    TS2322  not assignable to "0" | `${number}px` | …

$.size.control.sm   in a padding narrowed to 4/8/16/24   ok
$.size.control.md   the same slot                        TS2345  Var<"length","30px"> is not PaddingScale
$.color.primary.main                                     TS2345  a colour
```

That last pair is the point of the kind: the narrowing a project sets on a property reaches its
variables too, and the message names the offending VALUE rather than the variable.

Measured: 5,133 instantiations against 4,776 for an empty program, 0.39s either way.
`prototype-variable-types.ts` is the probe, and four errors in it are expected.

#### The config, entire

```ts
export default defineConfig({
  variables: {
    color: kind("color", {
      primary: { main: "#3b82f6", light: "#93c5fd" },
      surface: { base: "#ffffff", sunken: "#f3f4f6" },
    }),
    size: kind("length", {
      control: { sm: "24px", md: "30px" },
      weight: kind("number", { bold: 700 }),
    }),
    motion: kind("duration", { fast: "120ms", slow: "400ms" }),
  },
});
```

A name, a fallback, and a kind per group. Nothing else. The nesting is what gives grouped completion — `$.` then
`color.` then `primary.` — measured at 6, then 5, then 4 offered, against 88 for a flat union.

This REPLACES `variables: readonly string[]`, which is a hand-written list of names from outside
(`config.ts:47`). Same key, now carrying a value each: the rule still stops reporting those names,
and they gain a type and a fallback at the same time.

#### One source, and the CSS is OUTPUT

The user found the split I had left in: this config declares the variables, but the variables
themselves live in a `:root` block somewhere — *"ovaj config moraju da održavaju odvojeno od onog
drugog mesta gde su variable, zar ne?"* They do, and that is two places.

**So they do not write `:root` at all. Codegen emits it from the same object.**

```
ramonda.css.ts   ->   :root { --color-primary-main: #3b82f6; … }    emitted
                 ->   $ and the types                               emitted
                 ->   $.color.primary.main  ->  var(--color-primary-main, #3b82f6)
```

The fallback is then not a second copy of the value. It is one value, written once, used twice: as
the declaration codegen emits, and as the fallback every use carries. Their own answer to *"da li bi
bila preporuka da oni taj CSS napišu neki typescript objekat"* — it already is that object.

A theme is still theirs. `[data-theme="dark"] { --color-primary-main: … }` is CSS they write, in
their own file, and we know nothing about it. That is the whole reason the fallback exists rather
than a model of themes.

**The honest cost:** a nested object is less scannable than a stylesheet — the user's word was
*nepregledan*. `kind(…)` groups keep it shallow and grouped, and the emitted stylesheet is there to
read; but it is generated, not authored, and that is a real trade rather than a free win.

#### Reading a variable from JavaScript

Rare, and it happens. Measured in Chrome rather than recalled:

    --set-colour                          "#3b82f6"
    --unset                               ""          typeof "string" — never undefined
    --spaced (whitespace in the source)   "#10b981"   trimmed
    set on :root, read on a child         "30px"      inheritance, as expected
    set from JavaScript, read back        "irrelevant"

    width: var(--set-length)              "30px"
    width: var(--unset, 42px)             "42px"
    width: var(--unset)                   "720px"     <- the finding

**That last row is the strongest argument for the fallback in the whole design, and it is not mine.**
Without one the declaration does not merely miss: it is invalid at computed-value time, `width` falls
back to `auto`, and the element lays out at 720px. Nothing is reported and nothing looks broken.

And a fallback is **invisible to a read** — `--unset` is still `""` after a property used it with
one. So a typed read has to apply the fallback itself:

```ts
read($.color.primary.main, el)   // getPropertyValue, trimmed; "" becomes the declared fallback
```

which is what makes "never undefined" true in JavaScript too, not only in CSS. `$` is already an
importable object, so it carries the name and the fallback that this needs.

#### The whole thing end to end

##### 1. What a person writes

One file, `ramonda.css.ts`. The variables half is new; the strictness half already existed.

```ts
import { defineConfig, kind } from "@ramonda/css/config";

export default defineConfig({
  variables: {
    color: kind("color", {
      primary: { main: "#3b82f6", light: "#93c5fd" },
      surface: { base: "#ffffff" },
    }),
    size: kind("length", { control: { sm: "24px", md: "30px" } }),
    motion: kind("duration", { fast: "120ms" }),
  },
  rules: { /* … as today … */ },
});
```

##### 2. When codegen runs

The build plugin runs it on start and whenever `ramonda.css.ts` changes, so the ordinary case needs
no command. `ramonda-css codegen` exists for CI and for an editor that only watches files. Output
goes to a directory the project's `tsconfig.json` already includes.

##### 3. What it writes

| artefact | what is in it |
|---|---|
| `variables.css` | `:root { --color-primary-main: #3b82f6; … }`, and one `@property` per variable |
| the `$` module | the object — each leaf carries its NAME and its FALLBACK — plus `Var<kind, value>` types, `toStyle` and `read` |
| the value types | the narrowed per-property types the virtual file already consumes |

`$.color.primary.main` in a block compiles to `var(--color-primary-main, #3b82f6)`. In TypeScript it
is a real object, which is what `read` and `toStyle` need.

##### 4. Where a wrong value is caught — and where it is not

This answers the user's question directly: *do we scream at build too, or only at runtime?* Both, but
not everywhere, and the gap is worth knowing.

| a wrong value written… | caught at build? | by what |
|---|---|---|
| in the config — `kind("length", { md: "#3b82f6" })` | **yes** | `tsc`, `TS2322` |
| in a block — `padding: $.color.primary.main` | **yes** | the types, `TS2345` |
| in a block — `--size-control-md: crveno` | **yes** | the checker already reads custom properties a block sets |
| through `toStyle({ "size.control.md": "crveno" })` | **yes** | it is TypeScript |
| in THEIR own hand-written `.css` file | **no** | it is not a file we compile |
| from a server, at runtime | there is no build | — |

The last two rows are what `@property` is for, and it is not theoretical. Measured in Chrome:

    registered `syntax: "<length>"`, set to "crveno"    reads back "30px"   — refused, initial-value stands
    UNregistered, set to "crveno"                       reads back "crveno"
      and an element sized by it                        height "0px"        — silently collapsed

So the same `kind` the config already requires buys a second guarantee, in the browser, at no cost to
the person writing it. That is the one idea taken from StyleX, whose `stylex.types.*` emit exactly
these rules — the difference being that they write the type per variable and we write it per group.

##### 5. Overriding: a recommendation, not a feature

We do not model themes. But the names are readable by design, so overriding is ordinary CSS, and the
cascade does the work. Measured in Chrome, from weakest to strongest:

    :root { --c: base }                     ->  "base"
    @media (…) { :root { --c: mode } }      ->  "mode"
    <html style="--c: …">                   ->  "tenant-on-html"
    <div style="--c: …">  (a wrapper)       ->  "tenant-on-wrapper"

**The nearest ancestor that sets a name wins.** That single sentence is the whole mental model, and
it is CSS's, not ours.

##### 6. The complex cases, each one walked

*Light and dark.* Their CSS, their file:

```css
@media (prefers-color-scheme: dark) { :root { --color-primary-main: #93c5fd; } }
[data-theme="dark"]                 { --color-primary-main: #93c5fd; }
```

*A size that changes with the screen — 30px wide, 24px narrow.* The same shape. The config holds the
base value; a media query overrides it. This is why `when` is not in the config: CSS already has it,
and ours would have been a worse spelling of it.

```css
@media (max-width: 600px) { :root { --size-control-md: 24px; } }
```

*An organisation's theme, arriving from a server.* Values on an element, typed on the way in:

```tsx
<div style={toStyle({ "color.primary.main": org.primary })}>…</div>
```

*A user's theme.* The same call, applied wherever it should reach.

*All of them at once.* The cascade resolves it, by the sentence above: base, then the mode's media
query, then whatever element the tenant's values sit on. **Recommendation: apply a runtime theme to a
wrapper element rather than to `<html>`, and let it carry values already resolved for the current
mode.** On `<html>` it competes with the mode's media query on the same element, and inline wins —
so dark mode would lose. On a wrapper there is no competition, only distance, which is easier to
reason about and easier to undo.

And if they want their own override file checked rather than trusted, they write it as a block; then
row three of the table above applies and the checker reads it like any other.

##### 7. Their own CSS, checked — one hook, and they fill it

The table in §4 has one row where the build is blind: a `.css` file they wrote themselves. The user
would not leave it there, and proposed the shape: give them an output, let them write the reader,
and we say in time whether it will pass.

That is the right division, and it is the one this whole design already follows — **they read, we
check.**

```ts
export default defineConfig({
  variables: { … },

  /** Everything else that sets our variables. */
  alsoSets: fromCss("./src/theme.css"),      // a reader we ship
});
```

```ts
  alsoSets: () => fromWhereverTheyLike(),    // their function, our contract
```

The contract is small: return `{ name, value, where? }[]`. `where` is what separates a useful report
from an irritating one — the finding lands on THEIR file and line, not on the config.

For each pair we ask two things: is the name declared (if not, it may be a typo of one that is, which
is where did-you-mean belongs), and does the value satisfy the written `kind`.

This also absorbs the old `variables: readonly string[]`: a name set from outside is the same
question asked with no value. One mechanism instead of two.

**Two limits, stated rather than discovered later.** `fromCss` reads a subset and is not a
spec-complete CSS parser — the existing parser already handles nested rules with a prelude, `@media`
included, which is the shape a `:root` override has, but a file it cannot read is a real
possibility. That limit is only acceptable BECAUSE the hook exists: they replace the reader with
their own function and lose nothing. And a value computed at runtime can never be on the list;
`@property` stays the net for that.

##### 8. What registering costs, measured on the emitted stylesheet

The generated CSS was fed to Chrome rather than reasoned about, and it does what §4 claims:

    base value reaches a child                       "30px"    inherits
    an override still works                          "24px"
    `--size-control-md: crveno`                      "30px"    REFUSED, initial stands
    `--color-primary-main: 12px`                     refused
    `any`, which registers nothing                   anything sticks
    `<integer>` given 1.5                            "2"       refused — the case no type can express

**One thing registering also does, and it had better be written down before somebody meets it.** A
registered variable's computed value is NORMALISED; an unregistered one reads back verbatim:

    registered    `--x: #10b981`    reads  "rgb(16, 185, 129)"
    unregistered  `--x: #10b981`    reads  "#10b981"
    registered    `--x: 2rem`       reads  "32px"

For reading that is usually an improvement — a resolved value rather than a token. But `read` cannot
promise to hand back the literal that was written, and a length comes back absolutised against the
element it was read on. `inherits: true` is likewise not a preference: an unregistered custom
property inherits, so a registration saying otherwise would quietly change how every existing use
behaves.

#### What was tried and dropped, and why

Every one of these was the user refusing a complication, and every one was right.

| tried | why it went |
|---|---|
| `{ kind: "color", value: … }` per variable | *"neću pored svakog tokena da pišem njegov kind"*. Answered by declaring it per group instead — not by dropping it. |
| reading the kind off the fallback value | *"ne možeš da čitaš kind, moraš eksplicitno da ga napišeš"*. `"0"` is a length or a number and the value cannot say which. |
| `ref("palette.blue.500")` | *"ti to ne možeš da napraviš type safe"*. Measured: `ref("totally.made.up")` and a colour pointing at a length both compiled, unreported. A config literal cannot reference its own paths — the inference is circular. |
| `when: { "max-width: 600px": "24px" }` | conditions are unbounded, and maintaining a model of them commits us to something we do not understand. |
| `themes: { dark: { when, values } }` | the same, one level up. Themes are theirs. |
| a scope list per runtime theme (`owns: […]`) | policy, not types. They write their own logic; we owe them types, not permissions. |
| reading the project's token stylesheet | it assumed a Figma-shaped export, and it put us in the business of parsing somebody else's CSS. *"zasto bi mi to radili za njih"*. |

The through-line: **we do not model theming.** A variable may be set by a theme, a media query, a
container query, an ancestor, a tenant's values from a server, or code we never see. We state the
name, the fallback and the kind; everything past that is the project's.

#### Left to settle

- A property narrowed to a scale that IS a variable group would otherwise be written twice. Proposal:
  the strictness config names the group (`"space"`) instead of listing values, and codegen refuses an
  unknown group with a sentence. Checked at build time rather than by `tsc`; not everything has to be
  a type.
- Four consumers have to learn `$`: the grammar, the formatter, the checker and the virtual file.
  Only the last is interesting — a hole there is already a real TypeScript expression, so `$` rides
  the same machinery for completion while compiling to text rather than to a custom property.
- Names that are not identifiers (`2xl`, `0`): written with a dot in the block, bracketed in the
  virtual file. Measured — `$.space.inline.2xl` does not parse (`TS1351`), `["2xl"]` does — and the
  mapping already supports it, since `Segment` keeps `sourceLength` apart from the virtual length and
  `copied` is written rather than inferred. The path is emitted as several runs so completion lands.

### A list of things worth forbidding, and where it should live

The user's idea, in their words: *"verujem ako pogledas stylex tailwind, oni blokiraju mnogo
besmislenih featurea koje ima CSS jer postoji uvek bolji nacin, pa da vidimo i mi tu listu."*

#### What StyleX actually forbids, read rather than recalled

From their own documentation:

| forbidden | their stated reason |
|---|---|
| descendant and sibling combinators — `.x > *`, `.x ~ *`, `.x:hover button` | *"make styles fragile, less predictable and harder to debug. An element could be styled without having any classes applied to it."* |
| `border` and `background`, entirely | write `borderWidth`, `borderStyle`, `borderColor` instead |
| multi-value shorthands — `padding: 8px 12px`, `margin`, `borderWidth` | one side per property |

Their principle is one sentence: *"All styles on an element should be caused by class names on that
element itself."* Their `valid-shorthands` lint rule autofixes every one of these.

**What I could not verify and am not going to guess at:** the complete list of properties they ban.
Their site documents the rule's OPTIONS rather than its contents, and the rule's source was not where
the search put it. So the three rows above are what is quoted from their docs, and nothing else here
is attributed to them.

#### What this package can already say, measured

    828 properties
    262 vendor-prefixed          webkit 182, ms 48, moz 30, apple 2
    124 of those have an unprefixed form that ALSO exists
     98 shorthands

**The 124 is the interesting number.** `-moz-appearance` beside `appearance`, `-webkit-box-flex`
beside `flex-grow`: writing the prefixed one is not a preference, it is a name that was needed once
and is not any more. That is a list worth offering, and it is derivable rather than opinionated —
it is the properties where a standard spelling of the same thing exists.

#### Where it belongs, and why not as a default

The mechanism is already here. `properties: { "-webkit-box-flex": { shorthand: false } }` does not
apply (it is not a shorthand), so this needs one more key — call it `allowed: false` — or a list of
its own. Either way it is the same pipeline: the config narrows, codegen writes, the types and the
completions follow.

**What it must not be is a default of ours.** Three reasons, and the third is the one that decides:

1. *"a better way exists"* is a judgement about somebody else's project. `-webkit-line-clamp` has no
   standard equivalent that ships everywhere, and a team supporting an old WebKit needs it.
2. This package's own rule is that refusing correct CSS is the failure it may not have. A blocklist
   is exactly that, held deliberately — which is fine when a PROJECT holds it and not when we do.
3. The same argument already settled the narrowing: what CSS allows is this package's to state, and
   how far a project goes is the project's. A blocklist we ship is that decision taken back.

So the shape is a PRESET: a config a project imports and spreads, published beside this package or
by anybody else. `DESIGN.md` above already chose design C partly because its merge is well-defined —
key by key — which is what makes a preset worth starting from rather than a thing to fight.

#### DECIDED: no preset. The mechanism, and worked configs in the documentation.

The user's call, and it is the better of the two for reasons this design had already half-written.

**A published preset is a dependency, and the failure it invites is silent.** Design D above was
refused for exactly this — one missing `...strict.properties` and the constraints are gone with
everything green. A preset makes that a permanent shape rather than a thing somebody might write: it
is spread into a config, it changes under the project when it is upgraded, and the counts codegen
prints are arithmetic over what the function returned rather than over what anybody intended.

**A config in the documentation is copied, and then it is theirs.** No version, no merge, no spread
to forget. Every line is editable and the project owns all of them, which is the same reason the
narrowing was moved out of the shipped types in the first place: how far a project goes is the
project's.

**And a config in the documentation is CHECKED, which a preset would not need to be.**
`scripts/check-examples.mjs` type-checks every ```ts and ```tsx fence on every page — `CHECKED` is
`new Set(["ts", "tsx"])` — so a config example is compiled against the real `Config` type on every
run. A property that does not exist, an arity CSS does not give, a unit that is not one: each is
refused before the page can ship. A wrong example in the documentation is the worst kind, because a
reader trusts it and copies it, and this is the one mechanism that already stops it.

**The honest limit of that:** the gate proves an example COMPILES, not that it is good advice. A
config that forbids something worth having would pass. So the pages have to argue for each row
rather than list it — which is what `what-a-page-owes-its-reader` asks of every page anyway.

What the pages should carry, from mildest to strictest, is the open question — and it is a writing
question rather than a design one, so it belongs with the documentation work rather than here. The
one row with evidence behind it today is the 124 vendor-prefixed properties whose unprefixed form
also exists, measured above.

### Two things the user found while using it, both OPEN

#### A token's type carries its declared VALUE, and a theme changes that value

Codegen writes:

```ts
"main": "var(--color-accent-main)" as Token<"color", "#10b981">
```

The user's reading of it, and it is right: *"dobra stvar je sto to mogu da procitam, losa strana je
sto mi mozemo da promenimo vrednost jer kod teme je to i sustina."*

The literal is what makes the narrowing work — a property limited to `4px | 8px` can refuse a
variable whose value is `12px` only because the value is in the type. But under a theme that value is
the FALLBACK and nothing more: `[data-theme="dark"]` sets the same name to something else, and the
type still says `#10b981`.

Three shapes were named, and the choice is not obvious:

1. **The literal stays and means "the declared fallback".** Honest if it is said out loud, and the
   narrowing keeps working. A reader hovering sees a value that a theme may have replaced.
2. **The literal goes.** `Token<"color">` alone. Nothing lies, and a property narrowed to a scale can
   no longer refuse a variable outside it — which is a capability the user asked for by name.
3. **Two kinds of token.** A fixed one carrying its value and a themed one carrying only its kind,
   declared differently in the config. The user's own suggestion — *"ili su ovo oni readonly tokeni,
   a za temu da se prave drugi"* — and it keeps both properties at the cost of a distinction to
   learn.

**Not decided, and it should not be decided quickly**: it is the first thing in this design where
being right about themes and being strict about ranges pull against each other. Whatever wins, the
themed tokens have to be typed too.

#### The path's colouring

`$.space.gutter.wide` colours only `space`, as a property VALUE, and the rest — the `$`, the dots,
`gutter`, `wide` — comes out as plain text.

**That is the state BEFORE `ramonda.css-variable`, measured and fixed.** The grammar makes the whole
path one token now, and `grammar.test.ts` asserts it. What the user is seeing is the installed
extension: the marketplace has `0.1.2`, and the fix is in the `.vsix` that has not been uploaded.

So this is not a bug to fix but a release to make — and the one thing worth deciding with it is the
SCOPE. It is `variable.other.ramonda` today, which most themes colour as a variable rather than as a
value. The user asked for the whole path to read as `space` does. Worth checking against two or three
themes before the upload, because a scope is not a colour and only a theme turns it into one.

### A worked config: what is worth forbidding, what is worth narrowing

Asked for by the user. Every row has its reason, because a row without one is a row somebody deletes
the first time it is in their way — and because the documentation gate proves an example COMPILES,
not that it is good advice.

#### 1. Shorthands whose parts are different things

**The line is derivable, not an opinion.** A shorthand is either n of ONE thing or several different
things at once, and only the first can be checked:

    n of one thing, checkable     20   padding, margin, gap, inset, border-color, border-width, …
    several different things      69   background, border, transition, animation, font, …

`background: red` also resets `background-image`, `background-repeat` and six more to their initial
values. Nothing in a type or a rule can say that is wrong, because it is legal CSS doing exactly what
it says. A longhand cannot do it.

So forbid the 69 and keep the 20 — `padding: 8px 12px` is four lengths and is checked already.

```ts
properties: {
  "*": { shorthand: false },
  // Back, by name: these are n of one thing and are checked.
  padding: { shorthand: true },
  margin: { shorthand: true },
  gap: { shorthand: true },
  inset: { shorthand: true },
  "border-color": { shorthand: true },
  "border-width": { shorthand: true },
  // … and the fourteen block/inline pairs of the same shape.
}
```

**Twenty lines is the honest cost of the config as it stands**, and it is worth noticing: the package
knows which twenty, and saying so for a project would be deciding for them. A `shorthand: "checkable"`
on `"*"` would spell the same fact in one line and is NOT policy — it is the mechanism's own
classification. Worth building; not built.

#### 2. Units — narrow, and it costs nothing

```ts
"*": { units: ["px", "rem", "%"] },
```

Forty-nine length units exist and a team uses three. This is the cheapest row in any config: the unit
parameter is already in `CssDimension`, so it is a type substitution rather than a new check.

**`units` is not a range.** It narrows which units may appear, not which values — `30px` passes a
`px`-only property, correctly.

#### 3. Values — narrow where a scale exists, and nowhere else

```ts
"z-index": { values: [0, 1, 10, 100, 1000] },
```

A layering scale is the case every project has and nobody writes down. The type refuses `z-index: 5`
and the editor stops offering `auto`.

**Not for colours, and the user is right about why:** *"tesko mi je da poverujem da ce neko zeleti
odredjene vrednosti boje u tipu, to mi deluje kao overkill."* A palette is fifty values, they change,
and pinning them in a property's type puts the palette in two places.

What a project wants for colours is a different thing: *"za boje moze reci da hoce samo kroz tokene i
variable da radi, nece hardcoded values."* **That cannot be said today** — a closed list of every
permitted colour is not it. It needs its own spelling, and by KIND rather than by property, since a
colour reaches fourteen properties:

```ts
"<color>": { variablesOnly: true },   // proposed; built, and as a selector
```

#### 4. Arity — the one most projects should NOT set

```ts
"*": { arity: 1 },
```

Reads as the obvious strict default and forbids `margin: 0 auto`. Set it per property where a team
means it, and leave the sweep alone.

#### What a project does NOT have to decide

CSS's own maximum applies with no config at all — `padding: 4px 0 0 0 0` is five values where CSS
gives four, and that is reported without anybody asking. A config narrows from there and can never
widen past it.

### A variable's DEFAULT and its RANGE, which is one thing today and should be two

The user's question, and it is the last hole in the theme story: *"kako to u configu da uradimo, da
zna sta je default vrednost, ali da kasnije zadrzi range ako zelis da menjas vrednost te variable."*

Today a variable declares one value, and it is both the initial and the whole of its type:

```ts
size: kind("length", { control: { md: "30px" } })
```

That value goes into `:root`, into `@property`'s `initial-value`, and into `Token<"length", "30px">`.
Under a theme the first two are right and the third is a claim about a value the theme replaces.

**Proposed: a variable may declare what it MAY BE, beside what it starts as.**

```ts
size: kind("length", {
  control: { md: { value: "30px", range: ["24px", "30px", "36px"] } },
}),
color: kind("color", {
  text: { primary: { value: "#111827", range: ["#111827", "#e5e7eb"] } },
  brand: { main: { value: "#10b981", range: "any" } },
}),
```

Three states, and each says something different:

| written | the type carries | what it means |
|---|---|---|
| `"30px"` | `"30px"` | this never changes |
| `{ value, range: [ … ] }` | the list | it may be any of these — light and dark, wide and narrow |
| `{ value, range: "any" }` | the kind alone | it changes and we do not pin it — a tenant's colour from a server |

What it buys, and each is something the design cannot do now:

- The range is what a property's narrowing is checked against, so the check is about what the
  variable may BE rather than what it happens to start as. The theme hole closes.
- `toStyle` accepts only values from the range. Setting a variable at run time becomes checked
  instead of being a string.
- A reader hovering sees the range, which is more useful than one value that a theme replaces.
- **It is the user's own "readonly tokens versus themed tokens" distinction**, expressed as data on
  the variable rather than as two kinds to learn.

The cost is one object form beside the bare value, written only where a variable actually changes —
which in a real design system is the semantic colours and the responsive sizes, not the palette.

**And most of it should not be written at all.** The user's correction: *"neke vrednosti dolaze
kasnije, ne mogu odmah ovde da ih upisem. Zapravo, mogu, ako imaju CSS fajl, oni pozovu neki parser i
izvuku za odredjen token sve moguce vrednosti, zar ne?"*

Yes — and the hook for it is already designed. `alsoSets` returns `{ name, value, where }` from
whatever a project reads, so a theme file setting `--color-text-primary: #e5e7eb` hands codegen that
value. **The range is then the declared initial plus everything anything else sets for that name**,
and nobody writes it twice.

What stays hand-written is only the two cases no file can answer:

    range: "any"       the value arrives from a server and no stylesheet holds it
    range: [ … ]       pinned deliberately, with no file to read it from

`alsoSets` has only its name-list form today; the reader is designed and not built. Until it is, a
range is written by hand or left open.

**Cost, measured, because the question was asked:** none. On a program shaped like a real design
system — variables set from a block, a dozen properties written —

    200 variables x 1 value    18,104 types   5,742 instantiations   0.41s
    200 variables x 3 values   19,104         5,742                  0.44s
    200 variables x 8 values   21,104         5,742                  0.41s
    500 variables x 3 values   22,704         6,942                  0.42s

Instantiations do not move with the range at all. A union of string literals is the cheap kind.

### `@@` and the editor's own completion — reported, not diagnosed

The user, typing: *"kada napisem `css={@@` i krenem da kucam `(` desi se `css={@@Component()}` … je
mnogo iritantno."*

What is happening is the editor's ordinary completion: after `@@` the caret is in an expression
position TypeScript knows nothing special about, so it offers every symbol in scope, `Component`
among them — and `(` is a commit character, so typing the very next character of the block ACCEPTS
the highlighted one.

**Not diagnosed, and worth saying so:** the `@` is not the problem in itself, and this is very
probably not VS Code deciding anything about decorators. It is a completion list that should not be
there at all, and the plugin already owns `getCompletionsAtPosition` — it returns its own list inside
a value and drops the virtual file's own bindings everywhere. A caret between `@@` and its `(` is a
position where the answer is NOTHING, and saying so is the same shape of fix.

To confirm before building: whether the list is TypeScript's or the editor's word-based fallback,
because the two are answered in different places. Measure it the way `configReaches.test.ts` does —
a real project, the real plugin, the caret exactly there.

### Completion after a `:` — BUILT, and it found a second fault beside it

The user, while using it: *"voleo bih kada napisem `:` da imam autocomplete za `&:hover` i ostale."*

A caret in a PRELUDE gets nothing today. The data is there — `SELECTORS` holds 129 names and the
`unknown-selector` rule already reads it, including the four one-colon CSS2 forms — so this is the
same shape as `valueWords`: a region the plugin knows it is in, answered from the table the checker
already asks.

Both things this said to get right were right, and both bit:

- **A caret in empty space belongs to no run yet** — and to the WRONG one. Measured, `&:` is read as
  a declaration whose property is `&`, so the value region CLAIMED the caret and the first version of
  the fix never ran. The text decides instead: a prelude starts with `&`, which `CssBlockShape`'s
  `` `&${string}` `` key makes a fact rather than a convention, and the run is bounded by `;`, a
  brace, or just past the block's `(` — that last bound measured too, because stopping ON the paren
  put it at the head of the run and nothing matched.
- **The offer matches what the rule accepts**, asserted: every name offered is a key of `SELECTORS`,
  which is the table `unknown-selector` reads.

**And the same probe found a second fault, in the mapping.** `position: ` with the caret after the
space — a union-typed property, whose words are deliberately TypeScript's to offer:

```
author 36 (the caret)    ->  virtual 783   between `},{` and `},]`
author 37 (the newline)  ->  virtual 778   between the quotes of `position:""`
```

One character apart, and the first is the key position of the NEXT declaration — which is why the
answer was the 828 property names. So `position: stat` worked and `position: ` did not: the answer
arrived only once you had typed enough not to need it. TypeScript is asked at the value region's own
end where nothing is typed yet, which is the same fact the property is read from rather than a
second guess at where the value lives.

### What is not in dispute

The codegen step is the same in all three: read the config, write a `.d.ts` the project's
`tsconfig.json` includes. Only what a person writes differs.

**And this makes the config serve two audiences** — the checker reads it at check time, the codegen
reads it at build time. That is this repository's most common shape of fault, one question with two
consumers, so whichever design wins has to say out loud which keys the checker honours and which the
types do, and a key honoured by only one is a key that will surprise somebody.


**1. Where a hole may appear.** A custom property holds a *value*. It cannot hold a property name, a
selector, or a whole declaration:

```
border-left: {…};                ✓   becomes  border-left: var(--r-8e271c6c1f3a4b02-0)
{cond ? "display:flex" : ""}     ✗   a declaration — nothing to put a variable in
&:{state} { … }                  ✗   a selector
{name}: 24px;                    ✓   ONLY where `name` is a `@@property( … )` — see below
```
*Decided:* value position only, refused at build time with the source position, and reported by the
checker first — **with one exception this section did not foresee.** A `@@property( … )` compiles to
a NAME, a string known at build time, so a hole holding one is written in rather than substituted,
and `{W}: 24px` emits `--r-…: 24px`. That is what makes a generated custom property settable; without
it, registering one would be half a feature. `A_HELD_NAME` in `read.ts` is the discriminator, and
nothing else may stand there.

**2. ~~What an `undefined` hole does.~~ DECIDED by the server-rendering measurement below: the type
refuses `undefined`.** It was a preference; the four hydration directions make it a requirement.

**The `var(--…, initial)` floor was NOT built, and this line used to say it would be.** What ships is
`var(--r-…-0)` with no fallback. The floor would be dead weight: the type refuses `undefined`, the
runtime refuses a value that is not a boolean, a number or a string, and a custom property that is
genuinely unset already computes to the guaranteed-invalid value, which is what `initial` names.

**3. Merging with a written `style`.** *Recommended:* merge, generated first, author last.

**4. ~~Ordering and specificity.~~ DECIDED, and NOT the way this line recommended.** It said *one
block emits one class holding all its declarations*. **What ships is one class per DECLARATION** —
`display: flex` written anywhere in an app is one rule, and an element carries one class per thing
its block sets. That is what lets two files agree on a class without knowing about each other, and it
is why the sheet does not grow with the number of blocks.

Order is decided by `sheetRank` — not by module graph order, because a rule may land in any chunk and
a chunk has to stand on its own. The rank is *how specific the case is*: a condition beats none, a
longhand beats its shorthand, and of two breakpoints the narrower case is emitted last, which is what
every atomic CSS framework arrived at and is read off the query rather than off the author's order.

**And the rank is a LAYER, not a position, because a position was not enough.** One rule goes into
the stylesheet of every file that names it — the thing that lets a chunk stand alone — so a second
file re-emitting a shared rule put it after the first file's higher-ranked ones and same-specificity
later-wins undid the rank. Measured in Chromium through a real build: a file writing `color: red` and
`@media { color: blue }` rendered blue alone and red once an innocent file writing only `color: red`
loaded after it. A layer's place is fixed by its declaration rather than by where its rules sit, so
each rank gets a layer under `ramonda` and every stylesheet declares the whole order.

A breakpoint is a number, so the layer for it comes out of a name space of thousands — written as the
slot's DIGITS, one nested layer each, because ten names per level is a list every stylesheet can
carry and thousands is not. Unconditional rules stay flat.

The modes are ordered against the breakpoints the way Tailwind orders them — reduced motion, colour
scheme and medium below, `@supports`, orientation, contrast and `forced-colors` above. That is a
decision the user made over the one this first shipped, and the argument is about which mistake is
silent rather than about taste: a base block carries the theme and the block reusing it adjusts at a
breakpoint, and only the runtime can see that pair at all. Which is why `compose` warns about it in
development, and why that warning is measured to cost nothing in a production build.

**The thing this buys is not that dev matches the build.** Measured on a real dev server against a
real `vite preview` of the same app: before the layers the two already agreed, and both were wrong.
What moved is that a rule's place in the cascade is a function of the RULE — not of which files are
in the build, and not of when a chunk arrives. With the layers off, loading a lazy chunk changed the
colour of an element already on the page. `prototype-dev-vs-build.mjs` runs both sides. What is still not settled is two
conditions carrying no width, `@media print` against `prefers-color-scheme`: nothing tells them
apart, and there the file's own order is still the answer. See `PLAN.md`.

The sheet does sit in a named `@layer ramonda`, and the honest statement of what that buys is on the
docs page rather than here: **unlayered CSS beats layered CSS**, checked before specificity, so an
author's ordinary stylesheet wins without doing anything. An author who wants the other order writes
`@layer app, ramonda;`.

**5. Nesting, `&:hover`, `@media`.** Unusable without them. *Recommended:* those three in v1.

**6. ~~The compiled value's exact shape.~~ DECIDED, and it moved again after this line was written.**
It said `_s2(value)`. What ships is a MAP — `_merge({"color":["r-OsXzXT1Qd",x],"gap":"r-gap-8px"})` —
which decision 4 forced: one class per declaration needs a value that says which class belongs to
which property, so that merging two blocks can decide precedence property by property. Measured: the
order of classes in a `class` attribute decides nothing, so the call site is the only place
precedence can be decided at all.

What survives from this line, and it is the part that mattered: **the compiler concatenates nothing**.
The expression is transplanted verbatim as an array element, emitted exactly once.

**7. May anything happen at runtime?** **DECIDED — no.** Custom properties only, never an injected
rule. Injecting would give up server-render determinism, the cached sheet and the checker's view of
the styles, which is every property this design has. Written down so it is not reopened by
convenience later: a feature that "just needs a rule at runtime" is a feature that belongs somewhere
else.

**8. ~~The name, and where it lives.~~ DECIDED: `@ramonda/css`, in this monorepo.** The earlier
recommendation here was a name outside the org — `stilo` — on the reading that "completely isolated
from the framework" meant *organisationally* separate. It does not. It means **technically**
uncoupled, and the precedent for that already exists in the repository: `@ramonda/lens` is under the
org, ships in other people's bundles, and imports nothing at all.

So the constraint stands and only its enforcement moves: **this package may not import the framework,
in any direction, at any depth, not even as a peer.** A wrapper putting a `css` prop on another JSX
library gets the value and `toStyleObject`, and drags nothing else in. Being under the org buys one
gate, one release pipeline and one place to look, and costs nothing that constraint 3 was protecting.

Two entry points, and the split is load-bearing rather than tidy: `@ramonda/css` is the compiled
value that every page loads, and `@ramonda/css/compiler` decides names and never reaches a browser.
A runtime that could hash a block would be a runtime that could invent a rule, which decision 7
forbids — the boundary makes that true by construction.

**9. ~~Does the framework report the generated object?~~ MEASURED, and it did.** Answered above:
`RMD020` fires on every render for the object form. **Decided: the `css` prop is exempt**, one line
beside the two exemptions already in `compareAttributes`. The escaping question that the string form
raised is **gone**, not deferred — a value that never becomes attribute text has nothing to escape.

---

## Server rendering, and how the values cross

Measured against the framework's own `renderToString` and `hydrateRoot`, because this is the half
where a design that reads correctly can still be wrong.

**Nothing needs a separate channel.** The values are derived from state during the render, and the
server writes them into the markup:

```html
<div class="r-8e271c6c1f3a4b02" style="--r-8e271c6c1f3a4b02-0: #10b981; --r-8e271c6c1f3a4b02-1: 24px;"></div>
```

The client re-derives them from the same state during hydration. There is no payload to serialise
beside the HTML, no registry to ship, and nothing for the client to look up — which is the whole
benefit of the values being *values* rather than rules. **Static generation is the easy case**: the
class names and the custom properties are baked into each page, and the stylesheet is a file.

**The sheet itself needs no injection.** It is a build artefact linked by the document shell —
`renderDocument`'s `styles` option takes the hrefs today — so there is no flash and no runtime work.
What is still open is code splitting: one sheet per entry is simple, per-route critical CSS is not,
and nothing here decides it.

### The one requirement that is easy to miss

**The server build and the client build must hash identically.** A class name is the hash of the
normalised block, so the two passes have to normalise the same way — which means **hashing happens
before any post-processing**, and post-processing may not rename. That is the same constraint as the
round-trip assertion above, arriving from the other direction.

### What the framework does and does not catch — measured, four directions

| server | client | reported | DOM afterwards |
|---|---|---|---|
| `#10b981` | `#10b981` | — | correct |
| `#10b981` | `#ff0000` | **RMD007** | corrected to the client's value |
| *(hole `undefined`, no attribute)* | `#ff0000` | **nothing** | client adds it |
| `#10b981` | *(hole `undefined`)* | **RMD007** | **the server's value stays** |

Row three is silent because an attribute the server omitted and the client adds is not a mismatch the
framework reports — measured on an ordinary `title` too, so it is general behaviour and not something
about `style`. Row four is not general: with `title`, both directions are silent and the DOM is
repaired both ways; with a custom property the divergence is reported and the stale value **survives
hydration**. Worth confirming against the runtime's own rules before treating it as a defect — a
framework that does not know which `--` properties are its own has a reason not to remove one.

**Measured again once the framework side existed, and the second row changed.** The table above was
taken on the OBJECT form — `style={{ "--r0": … }}` — where the value is part of an attribute the
comparator reads. A compiled block is not: the class is compared like any other class and the values
are applied with `setProperty` after the attribute pass, so nothing compares them. A differing hole
is now **silent, and the client's value wins**. That is the better half of the two failing rows —
the one that was reported was the one that was not repaired.

**And a hostile value injects through a server render, which nothing here predicted.** `setProperty`
writes one declaration whatever it is handed, so the client is safe; but a server render is
serialized to HTML and the browser PARSES the style attribute back, and the parse applies the CSS
grammar to whatever the serializer wrote. Through `renderToString` and `innerHTML`,
`red; position: fixed; width: 100vw` came back as real, applied declarations. **A value carrying a
`;` is refused** — see `CONTRACT.md`, *the one rule a consumer of a value must implement*.

**What this settles: a hole may never be `undefined`, and the type is what enforces it.** Decision 2
was a preference before this measurement and is a requirement after it. Both failing rows are
`undefined` rows, and each fails in its own unhelpful way — one ships a page missing a style with no
diagnostic, the other reports a divergence it does not repair. A hole that cannot be `undefined` has
neither problem, and that is a property of the signature rather than of anybody's care.

---

## Sharing, collisions, and what N instances cost

Three separate questions that look like one.

### Two identical blocks are one class, and that is the point

The class name is the hash of the normalised block, so the same declarations written twice — in two
files, two packages, by two people who never spoke — produce **one rule**. Deduplication is global
and needs no registry, because nothing has to be coordinated: agreeing on the same answer is what a
hash is for.

### Do instances fight over the variable? Between siblings, no

A custom property set inline belongs to that element and its subtree. Measured — three siblings
sharing one class, each with its own value:

```
SIBLINGS:         red | blue | green
NESTED-SETS-OWN:  blue          (a child that sets its own wins over its parent's)
```

So a component mapped a thousand times is a thousand elements with the same class and their own
values, and no interference. **That is the ordinary case and it is safe.**

### The case that is NOT safe, in full

Two components. A card styles its own title through a nested rule; the title has a block of its own.
Both are ordinary, and neither author knows about the other:

```
Card's block:    & .title { color: {this.accent} }
Title's block:   padding: {this.pad}
```

With positional names, both call their first hole `--r0`:

```css
.r-card .title { color: var(--r0) }
.r-title       { padding: var(--r0) }
```

```html
<div class="r-card" style="--r0: red">
  <span class="r-title" style="--r0: 8px">…</span>
</div>
```

Now read the first rule. It applies **to the span**, and `var(--r0)` is resolved on the element the
declaration applies to — so it finds the span's `--r0`, which is `8px`. The card's title comes out as
`color: 8px`, which is not a colour, so the declaration is dropped and **the colour silently
disappears**.

Nothing is wrong with either component. The bug exists only in the pairing, appears only when one is
nested in the other, and no test of either alone would find it.

**The fix is to scope the name to the block**, which the hash already identifies:

```css
.r-card .title { color: var(--r-card-0) }
.r-title       { padding: var(--r-title-0) }
```

Two blocks then cannot name the same variable, and inheritance stops being something anyone has to
reason about.

**This cannot be measured in the repository's harness**, and the honest note is worth more than a
number: jsdom returns `""` for an inherited custom property. That is the harness, not the fact — a
control on ordinary `color` inherits correctly in the same test. The failure above is read from the
specification.

### What N instances cost — measured, and the stylesheet does not grow

One block, 10,000 instances, values varying per instance because identical repetition is gzip's best
case and would flatter every row:

| | raw | gzipped | per instance |
|---|---|---|---|
| **the stylesheet** | **0.10 KB** | — | **one rule, whatever N is** |
| static block, no holes | 293 KB | 0.8 KB | 30 B |
| a hole, positional `--r0` | 615 KB | 44.3 KB | 63 B |
| a hole, block-scoped name | 713 KB | 46.7 KB | 73 B |

**Scoping costs 5.3% gzipped**, which is a small price for removing a class of silent bug.

The number worth reading twice is the first row. **Class count grows with the blocks in your source,
never with instances.** A component mapped ten thousand times is one rule and ten thousand class
attributes. What does cost is having a *hole* at all — 44 KB gzipped for ten thousand varying values —
and that is inherent to a value that differs per instance, not to this design.

### The hash length, and what it does and does not guarantee

Two DIFFERENT blocks landing on the same name is a birthday problem, and the prototypes' 8 hex
characters are not enough:

| blocks | 8 hex (32b) | 12 hex (48b) | 16 hex (64b) |
|---|---|---|---|
| 2,000 | 4.7e-4 | 7.1e-9 | 1.1e-13 |
| 10,000 | **1.16%** | 1.8e-7 | 2.7e-12 |
| 50,000 | **25.25%** | 4.4e-6 | 6.8e-11 |
| 200,000 | **99.05%** | 1.80% | 1.1e-9 |

**A longer hash guarantees nothing, and it is right to say so.** Probability is not a promise: 12 hex
makes a collision unlikely, not impossible. So the two jobs have to be kept apart.

**The guarantee is the assertion, not the length.** Where the sheet is assembled, every block is
visible at once, so "no two distinct blocks share a class" is a fact the build can check rather than
hope for. That check is what makes a collision impossible to ship.

**The length decides only whether that check ever fires** — and firing is expensive, because the
class name is already written into the emitted JavaScript by then. Resolving it means the assembly
step reaching back to rewrite one string literal in one file, which is possible but gives up the
locality that makes the transform cacheable.

So the length should be chosen to make the check a tripwire that never trips. **Measured, that is
free:**

| hex | class name | raw | gzipped |
|---|---|---|---|
| 8 | `r-xxxxxxxx` | 712.9 KB | **46.7 KB** |
| 12 | `r-xxxxxxxxxxxx` | 791.0 KB | **46.7 KB** |
| 16 | `r-xxxxxxxxxxxxxxxx` | 869.1 KB | **46.7 KB** |

10,000 instances, values varying. Raw grows by 22%, and **gzipped there is no difference at all** —
the name is the part that repeats, so it compresses to nothing. Over the wire, a longer hash costs
zero.

*Recommended:* **16 hex characters**, where 200,000 blocks gives 1.1e-9 — below the rate at which
memory silently corrupts a byte — **plus the assembly-time assertion**, which is the thing that
actually guarantees it.

### One sheet, then one per route — and the second is cheaper than it looks

Every block's CSS has to end up in a file the page links.

- **One sheet for the whole app.** Simple, cached once, and a visitor pays for pages they never open.
- **One per route.** Each page carries only what it uses.

The second sounds like new analysis and mostly is not. **The CSS follows the JavaScript chunk.** Each
block belongs to the module it was written in, the bundler already decides which modules land in
which chunk, and a lazy boundary — `AsyncLoad`'s dynamic import — is what creates a chunk in the
first place. So a route that is already code-split gets its own stylesheet by inheriting a decision
the bundler has made anyway. Nothing here needs to know what a route is.

**And the report already exists**, which is worth knowing before anyone estimates this. `ramonda-check
<tsconfig> --split` computes exactly this shape, today, on a real app:

```
before anything      15 declaration(s) in 7 file(s)
loaded on demand     266 split point(s)
shared between them  50 declaration(s)

split point                                   reach  already  shared  its own
Page  src/generated/pages/accessibility.ts       57        6      50        1
```

`its own` versus `shared` is the same division the stylesheet needs. It cannot be a dependency —
`@ramonda/css` may not import the framework's checker — but it means the split is understood here,
not guessed at.

*Recommended:* ship one sheet, and treat splitting as **high priority rather than someday**. No
syntax, type or compiled value changes when it lands, which is what makes starting with one sheet
safe rather than a decision to regret.

---

## The framework's own tools read the author's source — and that is the conflict

The four pieces of work above are about the compiler, the check command, the editor and the bundler.
There is a fifth thing that reads a `.tsx` file in this repository and it was not on the list:
**`ramonda-check` itself**, which builds a `ts.Program` from the project's tsconfig.

The obvious guess is that a file with `@@( … )` in it fails to parse and the run stops. **Measured,
and it is worse than that: TypeScript error-recovers, so the run looks completely normal.**

The same component, twice, differing only in where the block sits in the attribute list:

```
<div onclick={this.go} role="button" tabindex={5} css=@@( display: flex; )>   // block last
<div css=@@( display: flex; ) onclick={this.go} role="button" tabindex={5}>   // block first
```

```
block LAST  :  half-built-keyboard-path  positive-tabindex  unnamed-image
block FIRST :  unnamed-image
```

**Two accessibility faults disappear, and nothing says so.** The parser recovers by discarding
everything from the unparseable attribute to the end of the tag, so what the checker sees depends on
where the author happened to put the block. The exit code is 1 either way and the output reads
normally in both.

A tool that stops is a problem you fix in an afternoon. A tool that quietly checks less is one that
ships.

**The fix is the layer that already exists.** The checker has to read the same virtual file the type
checker does — one transform, now used three times: by the build, by `tsc`, and by the rules. That is
an allowed dependency: `@ramonda/check` may depend on this package. The direction that is forbidden
is the other one.

**Measured honestly, the damage so far is to the RULES and not to the graph.** The same project
graphed with and without a block gives 2 nodes and 1 edge either way, with the `renders/tag` edge to
the child intact — children survive the recovery, later attributes do not.

### The certificate lands on the same requirement

`--certify` makes three claims, and two of them are exposed here:

- **`complete`** — *every component it names, it can follow*. It holds only when there are no holes,
  and a reference the parser threw away is exactly a hole.
- **`plain`** — *nothing needed an exemption written beside it*. It fails the moment somebody papers
  over the blindness with a `// ramonda-check-ignore`.

So the rule to write down before anyone builds a package with this: **a package whose source uses
`@@( … )` cannot honestly certify until the checker reads through the transform.** The certificate is
not decoration here — it is the thing that would notice, and it should not be taught to look away.

---

## Where this stands: what is answered, and what is not

Written as an audit rather than a summary, because the useful question is not "does it look right"
but "which parts are still opinion".

### Answered, and proved by something that runs

| | evidence |
|---|---|
| a hole is type-checked in its real scope | a real `TS2339` at the author's line and column |
| a property-name typo | `TS2561 … Did you mean to write 'display'?` |
| a value typo | `TS2820 … Did you mean '"flex"'?` |
| a hole typed by its property | `TS2322` on `padding: {nekaFunc()}` |
| dev speed | +2.6% over esbuild; 15–22 µs per file, linear |
| values crossing to the client | in the markup; no channel, no registry |
| instances do not multiply rules | one rule at any N; 0.10 KB either way |
| a longer hash is free | 8, 12 and 16 hex all gzip to 46.7 KB |
| the generated object is reported | `RMD020`, every render |
| the checker goes quietly blind | three rules become one, silently |

### ~~Answered by a decision, with the mechanism verified but not yet built~~ — ALL OF IT IS BUILT

This section listed five things as designed-but-unwritten. Every one of them now runs, and the list
is kept because reading it against the code is what found this document drifting:

- **The `RMD020` exemption** is written, in `renderStability.ts`, beside the two keys it already
  skipped.
- **The assembly-time collision assertion** is in `Sheet` — no two distinct blocks may share a class,
  because a longer hash makes a collision unlikely and probability is not a promise.
- **The round-trip assertion after post-processing** is `Sheet.verify`, called from the bundler's
  `generateBundle` against every emitted stylesheet at once. It catches the failure that is invisible
  by construction: a minifier renaming a class the emitted JavaScript already points at.
- **The checker reading the virtual file** is what `ramonda-check` and the editor plugin both do, and
  `checkSource` is the one sequence all three consumers share.
- **Scoped variable names** ship, and the cost stayed where it was measured.

Only jsdom's limit is unchanged: it still cannot resolve an inherited custom property, so that
failure is read from the specification rather than from a test.

### The two that were unexamined — both measured now, both fine

**Source maps compose.** Two maps sit between the browser and the author: ours, and esbuild's.
Walking both, for five positions in the emitted JavaScript:

```
the class declaration          OK  -> Card.tsx:3:7
the field above the block      OK  -> Card.tsx:4:11
the hole's expression          OK  -> Card.tsx:13:23
a method BELOW the block       OK  -> Card.tsx:20:2
code below that                OK  -> Card.tsx:21:23

5 of 5 positions land on the author's own line.
```

The interesting rows are the last two. A transform that deletes the CSS and inserts a call moves
everything below a block, and a map that is right *at* the block and drifts *below* it would pass a
careless test. It does not drift.

**And it produced a rule for the implementation, found by getting it wrong first.** Replacing the
whole block in one span costs the mapping: every expression then points at the block's opening line
instead of its own — measured, the hole reported line 8 instead of line 13. **Replace only the CSS
*between* the expressions and never the expressions themselves**, and each one keeps the bytes the
author put there. It costs nothing but writing the gaps out one at a time.

**The transform reaches the test runner.** A component under test is compiled by the runner, not the
dev server, and Vitest transforms through Vite — so a Vite plugin covers it. Run rather than reasoned,
with a fixture that cannot parse without the plugin:

```
enforce: "pre"       PASSES   1 passed
no enforce           FAILS    ERROR: Expected "{" but found "@"
```

**`enforce: "pre"` is a requirement, not a preference.** Without it the plugin runs after Vite's own
esbuild step, which has already refused the file. The same ordering applies to the dev server and the
build, so it is one rule in three places.

### The tooling cost, and what can be done about it

**Every tool that parses a `.tsx` file has to be taught.** `tsc`, the editor, the bundler and
`ramonda-check` all can be, through the virtual file. The formatter and the linter cannot be taught
directly — measured, biome answers *"Expected a JSX attribute value but instead found '@'"* and
oxlint answers *"Unexpected token"*.

**A suppression comment cannot rescue it, and the reason is the useful part.** `biome-ignore` and
`oxlint-disable` are read BY the parser, so the parser has already failed before it reaches them —
measured, with all three spellings in the file, biome still says *"Code formatting aborted due to
parsing errors"*.

**This is also why the comparison with CSS in a backtick is misleading.** Those work because a tagged
template is *already* valid TypeScript: the tool parses the file, sees a string, and looks no
further. Nothing had to be taught, and nothing had to be ignored. Here there is no region to ignore,
because there is no parse.

But both halves have an answer, and they are different answers.

#### The linter: run it on the virtual file and map back

The same trick as `tsc`, and `oxlint --format=json` reports offset, line and column, which is all a
map needs. Measured, with two real faults placed BELOW a block so the mapping has to survive the
offset shift:

```
Card.tsx:13:9  Variable 'neverUsed' is declared but never used.
    const   neverUsed   =    41;
Card.tsx:16:3  `debugger` statement is not allowed
    debugger;
```

Real rules, real messages, the author's own lines.

#### The formatter: a placeholder, not a map

A position map is not enough here, because a formatter rewrites text rather than reporting positions
in it. So the block is replaced by something that parses, the file is formatted normally, and the
block is put back at whatever indentation the formatter chose:

```
export const Card = (props: { id: string }) => {
	const accent = "#10b981";
	return (
		<div css=@@(
			display: flex;
			border-left: {accent};
		)>
			<span>{props.id}</span>
		</div>
	);
};

const neverUsed = 41;
```

Measured — the input had `const   neverUsed   =    41;` and a ragged block, and biome did the whole
file including choosing tabs. **Copy the formatter's own indentation rather than counting columns**,
or the block comes back with spaces inside a tabbed file.

#### What it actually costs, after all that

Not "no formatting and no linting". **One wrapper command**, which formats and lints through the
layer that already has to exist for the type checker. What stays true is that it is *our* command:
an editor's format-on-save has to be pointed at it, and the CSS inside a block is formatted by us
rather than by biome.

That is a smaller price than it first looked, and it is still a price — **a decision to take
deliberately, not something for the first person who runs the formatter to discover.**

### A third kind of tool, and it fails differently

The parsers either work or stop. There is a third category — **the highlighters** — and it neither
works nor stops. It renders the code in the wrong colours.

A `.tsx` code fence containing `@@( … )` is highlighted by whatever reads the fence: this repository's
own documentation site, an editor's markdown preview, npm's README rendering, and GitHub's diff view,
where it is visible in any pull request that touches this file.

**A highlighter never breaks a build.** It is a cosmetic failure — but for a framework whose
documentation is its shop window, cosmetic is not nothing.

**What is available today, and it costs nothing:** do not label the fence `tsx`. The code is not
TypeScript, and saying so is honest rather than a workaround. Both this repository's site and GitHub
fall back to plain text for a language they do not know — `build-content.mjs` does it deliberately,
with the comment *"A fence language Shiki does not know would throw; fall back to plain text."* Plain
is better than wrong. **The fences in this document were relabelled for exactly that reason; they had
been claiming `tsx` for code that is not.**

**What a real answer needs is a TextMate grammar** — which is the same grammar the editor needs, so
it is not extra work but the same work seen from another side. Whether the documentation site can
then load it is an implementation question and **not one to take on trust: one attempt at a Shiki
grammar injection here changed nothing about the output.** It is recorded as untried rather than as
impossible.

**GitHub and npm cannot be taught at all** without upstreaming a grammar, so a fence there stays
plain. That is the honest end state, and it is acceptable: plain text in a diff is a small price.

### The docs gate does not fail either — it goes quiet, and that is the third time

Planted into a real documentation page and run:

```
[examples] 428 code blocks in 115 files type-check and are clean to `ramonda-check`,
           23 not standalone code and skipped, 20 marked as not one program.
           skipped apps/docs/content/styling.md:100
Exit: 0
```

`check-examples.mjs` cannot tell *"this is pseudo-code"* from *"this is a real example in a syntax I
cannot parse"*, so it files the block under **not standalone code and skipped** and passes. Every
documented example of this feature would be unverified, in a repository that has already shipped
three wrong examples exactly this way.

**So the docs example gate is a sixth consumer of the transform**, alongside the build, `tsc`, the
editor, `ramonda-check` and the test runner. The same virtual file answers it.

### The verdict

**No blocker.** Every problem found has an answer, and the load-bearing ones are proved by running
code rather than argued: that a syntax `tsc` cannot parse can still be type-checked, that the
transform is cheap, that the maps compose, and that the test runner is covered. The remaining work is
large but ordinary.

The two candidates for a blocker were the two nobody had looked at, and both came back clean. What remains is not a risk to the design but a cost to its users, and it shrank when it was
examined: the formatter and the linter cannot read the file, but both work through a wrapper —
proved above — which turns "no tooling" into "our tooling".

---

## ~~What this contradicts today~~ — RESOLVED, and the page was rewritten rather than amended

`apps/docs/content/styling.md` said, under *What the framework does not do*: **no scoping, no
generated class names, no CSS-in-JS**, for three reasons — such a style ships in the bundle, is
rebuilt every render, and cannot be cached as a file.

**Build-time extraction satisfies all three rather than contradicting them**, which was the strongest
argument the design was right. The page now says so in its own words: both paragraphs name style
blocks, one as the opt-in that generates a class and one as *"not the exception they look like"*.
The framework's position is unchanged and the exception is stated where a reader meets the rule.

---

## The prototypes

```
node packages/css/prototype-typecheck.mjs packages/css/example.tsx.txt
```

Proves the claim everything else depends on: a `tsc` diagnostic from inside a `{ … }` hole,
reported at the right line and column of the author's own file.

**The `.txt` on the end of the fixture is itself a measurement.** Named `example.tsx`, it turned this
repository's own gates red:

```
oxlint    packages/css/example.tsx:11:12: error: Unexpected token
biome     format check failed
```

Neither tool can read the syntax, so neither can be pointed at a file containing it. That is piece 3
of the work above, arriving early and uninvited — and a reminder that "the editor" means every tool
that opens the file, not just the one with the squiggles.

Nothing here is started.

---

## The design review, and what it changed

The feature was finished and green before this: `$`, `kind()`, codegen, the checker, the grammar,
the formatter, `toStyle`/`read`. The user then asked for a review of the DESIGN rather than the code
— *"razmisli da li smo nesto nepotrebno ukomplikovali, nesto sto ce praviti vise problema nego
koristi"* — and every finding below was MEASURED against the real checker rather than recalled.

Three claims survived every probe and are worth naming, because a review that only lists faults
misreports the thing it reviewed:

- **The merge is real.** `"*": { units, arity }` plus `"padding-left": { values }` stacks; each
  constraint fires on its own. `"*": { shorthand: false }` with `padding: { shorthand: true }` brings
  exactly one back. Presets — design C's whole reason — will work.
- **A token is not a hole in the strictness.** `padding-left: $.rems.big.one` is refused where the
  property is px-only; `z-index: $.space.gutter.normal` is refused because a length is not an
  integer.
- **`$` earns the virtual file.** `$.space.gutter.norml` gets *Did you mean 'normal'?* from
  TypeScript itself, with rename and go-to-definition for free.

### 1. `units` meant two different things — FIXED

Measured, the two keys spelled `units` disagreed about scope, not just about mechanism:

| written | `units: [...]` | `properties["*"].units: [...]` |
|---|---|---|
| `transition: all 200ms ease` | reported | accepted |
| `width: 50%` | reported | accepted |
| `rotate: 45deg` | reported | accepted |
| `repeat(3, 1fr)` | reported | accepted |
| `letter-spacing: 0.05em` | reported | reported |

Same name, same value shape, and `width: 50%` refused by one and accepted by the other. Setting
both — which the docs invited — reported one mistake twice.

The top-level key is read by a RULE and sees every value. The property-level key reaches the TYPES
and can only bind a property whose value is a dimension. Neither can do the other's job, so both
must exist; what was wrong was that a flat list could not say what anybody meant.

**`units` is keyed by FAMILY now.** `units: { length: ["px", "rem"] }` — and a family the config does
not name is not constrained, so `200ms`, `45deg` and `1fr` are nobody's business but the project's.
An empty list bans a family outright: `{ flex: [] }`. The families come from `UNIT_TYPE`, generated
with an assertion that every unit lands in exactly one, so a unit CSS adds fails the build until
somebody classifies it. `CssUnitFamily` is generated beside it.

**The flat list is refused, not reinterpreted**, and that is the decision worth recording. Reading
`["px", "rem"]` as `{ length: [...] }` would be a project's rules quietly getting weaker on an
upgrade — `200ms` stops being reported and nothing says so. The `ConfigError` writes out the family
form with the project's own units in it. A config that stops loading is a minute's work; a check that
stops checking is found in production.

This was agreed with the user in an earlier session as "a later version" and the review is what made
it urgent: `units` reached only the checker then, and it reaches the types now.

### 2. One typo, two squiggles — FIXED

A mistyped `$` path was reported twice, at two columns, with the same suggestion in each:

```
unknown-variable  `$.space.gutter.norml` is not a variable this project declares.
                  Did you mean `$.space.gutter.normal`?
TS2551            Property 'norml' does not exist on type
                  'Readonly<{ normal: Token<"length", "16px">; }>'. Did you mean 'normal'?
```

**The first idea was to delete the rule, and it was wrong.** The rule's own note said the types say
this in an editor and the rule says it "in CI, in a hook, and to a reviewer — none of which run
TypeScript over the block." Measured, that is only half true: `ramonda-css check` DOES run TypeScript
over the block, which is where the double report came from. But the BUILD does not — vite and
esbuild run these rules and never type-check — so deleting the rule would leave a `var()` into a name
nothing sets compiling clean in the one place that ships.

So the fault was never the rule; it was two consumers speaking where one fault existed. `inOrder`
already drops the compiler's word where a rule of ours said it better, and this is that mechanism
widened once more: a `TS2551`, `TS2339` or `TS2322` on a LINE where `unknown-variable` already spoke
is the same fault, and goes.

By line rather than by character, which is the one place this departs from `inOrder`'s own principle.
The two land at different columns by construction — ours spans the whole path from the `$`, the
compiler's sits on the segment that failed — and a `$` path does not span lines, so the line is the
fault's extent here.

Three shapes, and the compiler spells each differently: `TS2551` for a near miss, `TS2339` for a
segment near nothing, `TS2322` for a GROUP, which is a real member whose type no property accepts.

### 3. `padding: 0` refused by `variablesOnly` — FIXED

Measured, `variablesOnly: ["length"]` refused the most common declaration in CSS:

```
padding-left: 0   →   Type '"0"' is not assignable to type
                      'Narrowed<never, Token<"length" | "length-percentage" | "percentage">>'
```

**A bare `0` is not a hardcoded length.** CSS lets a zero length go without a unit, `CssDimension`
holds `0 | "0"` for exactly that reason, and a project saying *lengths come from variables* is not
asking anybody to write `$.space.none`. The dimensionless zero went out with the literals because
the two lived in one type.

Both spellings are admitted: a block is CSS, so `padding-left: 0` reaches the type as the string
`"0"`, while a hole can hand over the number. It goes in the VALUE slot of `Narrowed<K, V>`, not
beside the keywords — `K extends string`, and `0` is a number.

Not for `<number>` or `<integer>`. A zero there is a number written out, which is what the setting
is refusing.

**And the two narrowings disagreed about zero**, which is the shape this review kept finding: `units`
leaves the literal type in place and swaps only the unit parameter, so `0` always survived it. One
question, two settings, two answers.

#### The message was the other half, and finding 8 answered it

`Narrowed<never, Token<…>>` names neither the project nor `ramonda.css.ts`. A doc comment on
`Narrowed` would show on hover and NOT in the compiler's text, so that was never the fix. What
worked is the one written there: the rule speaks for every property with a kind, and `inOrder` drops
the compiler's word on that line.

### 4. `variablesOnly` covered a list nobody could see — MOSTLY FIXED

Measured on seven hardcoded lengths in one component, under `variablesOnly: ["length"]`:

```
padding-left: 8px;      reported          width: 200px;        SILENT
margin-top: 16px;       reported          border-radius: 4px;  SILENT
gap: 8px;               reported          max-width: 320px;    SILENT
                                          flex-basis: 240px;   SILENT
```

Three of seven. A team turns the rule on, fixes three places, sees green, and concludes hardcoded
lengths are gone. Four remain in the same file. **A rule that looks enforced and is not is worse
than no rule** — without it the team would at least know to watch.

The user's instinct was right and my first reading was wrong: there was no design reason `width`
could not be narrowed exactly like `padding-left`. `auto` was never the problem — a classified
property already puts its keywords in the `Narrowed<K, V>` keyword slot, so `width: auto` passes and
`width: 200px` does not, which is precisely what was wanted. `width` simply never reached the
classifier.

**Three faults in `primitiveOf`, every one a SPELLING rather than a grammar:**

```
fit-content(<length-percentage>)    a call written out, where `<calc-size()>` was skipped
[ auto | … | fit-content(…) ]       parens disqualified an alternation `alternatives` splits safely
<length-percentage [0,∞]>           the range's comma read as a comma in the grammar
```

`PRIMITIVE` went from 172 to 195 — `width`, `height`, every `min-`/`max-`, the logical `inline-size`
and `block-size` families, `flex-basis`, the logical `margin-` and `inset-` longhands. **Nothing
lost, nothing reclassified**, asserted against the whole map before and after: a classifier that
gains one property and quietly moves another is worse than one that gains nothing.

A fourth attempt was REVERTED. Stripping the range annotation from the syntax up front looked
equivalent and lost `animation-duration`, so the range is ignored inside the one test that misread
it and nowhere else.

#### What StyleX does here, read rather than recalled

Their `@stylexjs/valid-styles` rule takes a `propLimits` map, keyed by property name or glob, and
each entry is a `limit` plus a **`reason`**:

```json
"padding": { "limit": [0, 4, 8, 16, 32, 64], "reason": "Use a padding that conforms to the design system" }
```

`limit` is `null` (ban the property), `"string"`, `"number"`, one constant, or a list of them.
**There is no rule of theirs that forbids literals in favour of tokens generally** — a project
enumerates the properties and the permitted values itself. So `variablesOnly`, keyed by KIND and
reaching sixty-odd properties from one word, is a thing their design does not offer.

**Their `reason` is worth taking.** It is the config author's own sentence, carried into the
message, and it answers finding 3 from the other direction: we cannot make TypeScript say why a
project refused a value, but a project could say it once and have the checker repeat it.

### 5. `variablesOnly` moved inside `properties`, as a KIND selector

The user's question, and it was about the config's SIZE rather than about the setting: *"mene brine
koliko je nas konfig komplikovan. Da li ima smisla da taj deo bude tamo gde je padding."*

`variablesOnly` was a top-level list of kinds. That made it **the one setting keyed by kind while
every other was keyed by property** — the inconsistency this review opened with.

Moving it per property alone was measured and cannot work: `<color>` reaches 40 properties and
`<length>` 127. Nobody lists those.

**So `properties` got a third selector.** It already had one — `"*"` is not a property name, it is
*every property* — and the middle rung was missing:

```ts
properties: {
  "*":             { shorthand: false },      // every property
  "<length>":      { variablesOnly: true },   // every property whose value is that kind
  "border-radius": { variablesOnly: false },  // that property, overriding the kind
}
```

Each binds more tightly than the one before, which is the shape CSS itself has. Merged key by key,
so a kind can say `variablesOnly` while the property beneath it says `values` and both apply — and
so two shared configs still combine, which is what design C was chosen for.

**Nothing new to learn.** `<length>` is the same word already written in `kind("length", …)` and
registered in `@property { syntax }`. The angle brackets are CSS's own notation for a type and keep
a kind apart from a property name.

**What it gains that the list could not express: the exemption.** `variablesOnly: ["length"]` was
all-or-nothing per kind, so a project could not say *lengths from variables, except `border-radius`*.

Top-level keys: six to five. The old key is refused with the selector written out from its own list,
by `validate` rather than by the unknown-key check — a key that MOVED needs to be told where it went,
and *"which is not a setting"* loses exactly that.

Both machineries follow the selector. A property that says what it takes is narrowed by its TYPE; a
composite one — `border-left: 4px solid red` — has no type worth narrowing and the
`literal-not-allowed` rule reads its value. The rule asks the KIND selectors what is variables-only,
because a composite property has no kind of its own, and asks the property by NAME whether it is
exempt, because only its own entry can speak for it.

#### `reason` was considered and NOT added

StyleX carries the config author's own sentence into the message. It does not fit here, and the
reason is worth writing down: the message for `padding-left: 8px` is TypeScript's `TS2322`, and
nothing a project writes can get inside it. A `reason` would need the checker to recognise that
refusal and speak over it first — and once that machinery exists, the sentence can be GENERATED from
what is already known, including a suggestion of the declared variable whose value matches:

```
`8px` is a length written out, and this project takes lengths only from its own variables.
You declared `$.space.sm` with exactly this value.
```

So the work is the same either way, and generating leaves the config one key smaller. `reason` goes
back on the table only if a project wants a sentence we cannot derive.

### 6. What `variablesOnly` MEANS, and the three faults the question exposed

The user asked it plainly, and it is the right question to ask of a setting with two neighbours:
*"sta znaci variablesOnly? Da samo variable smes da pises za taj property ili su variable nacin da
zaobidjes range vrednosti za taj property?"*

**It removes the LITERAL spelling and nothing else.** A variable is still checked against the range,
by its declared value. Their own position — *"variabla takodje mora da postuje range. Ako im se ne
svidja, pa onda prosiri range."* — was already the behaviour, and measured:

```
"padding-left": { values: ["4px", "8px"] }

padding-left: 12px      refused    a literal outside the list
padding-left: $.s.ok    accepted   declared 8px, which the list permits
padding-left: $.s.big   refused    declared 30px, which it does not
```

So `variablesOnly` is not a way around a range. It is the same range with one spelling taken away.

**But asking the question found three faults, all one root cause.** The branch that writes a closed
list walked `Object.entries(rules)` — the keys somebody typed — while every other setting asks
`ruleFor(property)`. Invisible while the only keys were property names and `"*"`; the kind selector
broke it three ways at once:

```
values + variablesOnly        the literal went in anyway — `variablesOnly` was never consulted
"<time>": { values: [...] }   emitted a row literally NAMED `"<time>"`, constraining nothing
"*": { values: [...] }        silently did nothing at all, and had since before the selector
```

The third is the oldest and was never noticed. It is refused now, naming the two places a closed
list belongs, because a list of permitted values for all 935 properties is not a thing anybody
means and doing nothing about it quietly was the worse of the two answers.

**This is the repository's recurring fault in its clearest form yet** — one rule, many consumers,
and one of them asking a different question. Every other setting asks per property; this one asked
per config key, and agreed with the others only by accident of which keys existed.

A property with NO kind keeps its literals under `variablesOnly`, because nothing can check a
variable into it: narrowing it to a token it cannot have would leave nothing a person could write.

### 7. `Token<"length", "16px">` — what the second parameter IS, and the message behind it

The user's question: *"sta ces da radis za one primere tipa `as Token<"length", "16px">`, da li tu
menjamo sta se vidi jer onaj 16px sto je inicijalna vrednost ne znaci sta je range mogucnosti za ovu
variablu"*

**It is already the range, not the initial.** Measured across the three declaration forms:

```ts
fixed:  kind("length", { gutter: "16px" })                              Token<"length", "16px">
themed: kind("length", { gutter: { value: "16px", range: [...] } })     Token<"length", "8px" | "16px" | "24px">
open:   kind("length", { gutter: { value: "16px", range: "any" } })     Token<"length", ValueByKind["length"]>
```

All three set `--gutter: 16px` in the stylesheet and register the same `initial-value`. The type
differs because the RANGE differs. A bare declaration means the variable never changes, so its range
is one value, and the two coincide on purpose.

**But asking exposed the message, and it was the worst one in the package:**

```
toStyle([[$.space.gutter, "24px"]])

TS2322: Type 'Token<"length", "16px">' is not assignable to type 'never'.
TS2322: Type 'string' is not assignable to type 'never'.
```

Two errors on one line, naming neither the variable, nor the range, nor what to do. And **not only
for the fixed case** — a variable with a real range said `never` too, so the range check worked and
could not be read. `Permitted` intersected the author's pair with the permitted pair, and an
intersection of two different literals is `never`.

Now:

```
Type '"24px"' is not assignable to type
  '"24px" & this_variable_was_declared_with_one_value_give_it_a_range_to_set_it_at_run_time'

Type '"24px"' is not assignable to type
  '"24px" & this_variable_may_only_be<"8px" | "16px">'
```

One error, and the second names the permitted values.

**The message is the TYPE'S NAME**, which reads oddly in the source and is deliberate: TypeScript
prints a type's name verbatim and prints nothing else it is handed, so a sentence in the name is the
only channel a type has. This is the same wall finding 3 hit from the other side — there the answer
must be the checker speaking over `TS2322`, because the refused thing is a value in a block and there
is no type of ours to name.

**`Fixed<V>` is written by CODEGEN, not inferred.** Only codegen knows the declaration was bare:
`range: ["16px"]` is a range that happens to hold one value, and setting the variable to it is a
thing the project said it may do. `Fixed<V> = V & {…}`, so a marked token is still a token
everywhere else — it goes into a block, and into a property narrowed to its own value, unchanged.

### 8. `variablesOnly` did not reach the BUILD at all — FIXED

Chasing the bad message found a hole, not a wording problem. The types refused `padding-left: 8px`
and the RULE said nothing, which read as a division of labour — *one mechanism per property, never
two for one*, as the rule's own note put it. Measured by asking the rules alone, which is all vite
and esbuild ever run since neither type-checks a block:

```
padding-left: 8px       []                      the build compiled it
width: 200px            []                      and this
color: red              []                      and this
border: 1px solid red   [literal-not-allowed]   only the composite was caught
```

So a project could set `variablesOnly`, watch `ramonda-css check` refuse a file, and watch the dev
server serve it. **The repository's recurring fault once more** — one rule, three consumers, two of
them silent.

The rule speaks for every property with a kind now, and `inOrder` drops the compiler's `TS2322` on
that line. Both machineries are needed and neither is redundant: the TYPE is what an editor squiggles
as you type, the RULE is the only thing the build runs. What an author must not get is the pair, and
measured they did — twelve reports for six faults.

Ours is the one kept, which also closes finding 3 for this case:

```
before   TS2322: Type '"8px"' is not assignable to type
           'Narrowed<never, 0 | "0" | Token<"length" | "percentage" | "length-percentage">>'

after    literal-not-allowed: `8px` is a length or a percentage written out, and this project
           takes them only from its own variables.

           Declare it in `ramonda.css.ts` and write `$.…`, or set
           `"padding-left": { variablesOnly: false }`.
```

**What is deliberately not a literal.** A CALL is an escape hatch and is not read into —
`calc($.space.md * 2)` holds a `2` that is not a hardcoded length and nothing here can tell it from
one that is. A bare `0` needs no unit in CSS. `var()` is what CSS itself provides. A HOLE evaluates
at render.

**And the top-level value walk is SHARED now.** `too-many-values` counted values inline and this
needed the same answer; a second scanner agreeing by accident is the fault above in miniature, and
it is the one that made `variablesOnly` mean something different in the build than in the checker.
One walk, one answer, both callers.

### 9. The slash form — `border-radius` classified

`<length-percentage>{1,4} [ / <length-percentage>{1,4} ]?` — four corners, then four again after a
slash, one primitive throughout. `sequence` wanted every piece bracketed and the first one is not,
so the property a design system constrains right after padding could not be narrowed at all.

Two changes, both in `sequence`: a bare type with a multiplier is a group, and a `/` between groups
is a separator. **The slash separates values in CSS and never IS one**, so skipping it cannot admit
a grammar holding two kinds — every piece still has to reach the same primitive, which is what keeps
`font`, `grid`, `border-image` and `mask` unclassified where they belong.

`PRIMITIVE` 195 → 205, nothing lost and nothing reclassified. Ten properties: `border-radius`, and
the `animation-range` and `timeline-trigger-range` families.

**A classified property is a NARROWED property, which is where refusing correct CSS becomes
possible.** `animation-range-start` arrived with this and its value is a keyword and a percentage
together — `entry 50%` — which is exactly the shape a narrowing gets wrong. Measured with no config
at all and guarded by a test: the elliptical `border-radius: 50% / 20%`, `entry 50%`, and
`animation-range: entry 0% exit 100%` are all silent.

### 10. The two ways a literal still reached the page

**A colour LONGHAND did not reach the build**, and that is a miss in finding 8's own fix. The
dimension half was extended and the colour half was not: `literalNotAllowed` skipped a property
whose grammar says `<color>` as *the types' to refuse*. A test asserted exactly that, with the
reason *saying it twice for one mistake is the fault this repository keeps finding*.

The first half of that reason was true of the checker and false of the build. **The count was never
two — it was one in the checker and ZERO where it ships.** Forty properties, `color: red` the first
of them, compiled by vite and esbuild. Both speak now and `inOrder` drops the compiler's word, which
is what the second half of the reason was really asking for.

**And a custom property set in the block was an open door.** `--own: red; color: var(--own)` is two
declarations this compiler reads and neither was looked at, so a rule a project turned on could be
walked around in one line — by accident as easily as on purpose.

A custom property has NO KIND, which is what keeps this narrow. Only a value that can be nothing
else is reported:

```
--own: red          reported      a named colour and nothing else
--own: #ff0000      reported      a hex
--gap: 8px          reported      a number carrying a unit
--n: 3              silent        a bare number is not a length
--label: "red"      silent        quoted, so it is text — `topLevelValues` keeps the quotes
--own: var(--x)     silent        the escape CSS itself provides
--gap: 0            silent        a zero needs no unit
```

It is reported against every forbidden kind at once, because nothing in a custom property says which
was meant.

### 11. `rules: off` silenced half of what the config turned on

Three settings reach both a rule and a type, and a rule severity can only reach the rule. Measured:

```
"*": { arity: 1 }                     too-many-values off      accepted
"<length>": { variablesOnly: true }   literal-not-allowed off  TS2322, still refused
"<length>": { units: ["px"] }         unit-not-allowed off     TS2322, still refused
```

**Worse than a gap: it is a trap.** An author with a file full of errors silences the rule to ship,
and is not unblocked — the error stays, and the message gets WORSE, because ours names the project
and `ramonda.css.ts` while `Narrowed<never, Token<…>>` names neither. Only `arity`, the one setting
with no type behind it, silences completely, so the same gesture means two different things
depending on which setting it lands on.

The other direction cannot be built: codegen would have to write a narrowing and then unwrite it.

So the contradiction is refused, and the message names the switch that works:

```
silences `literal-not-allowed`, which this config turned on itself with
`properties["<length>"].variablesOnly`.

    `rules` is for a report you did not ask for. This one you did, and silencing it
    would not even lift it — the same constraint reaches the TYPES, which no rule
    severity can reach. Change the setting instead:

    properties: { "<length>": { variablesOnly: false } }
```

**Only the contradiction.** `rules: { "literal-not-allowed": "off" }` in a config that never turned
it on is fine, and so is `too-many-values` off where no `arity` is set — that rule also reports CSS's
own maximum, which is a report a project may genuinely not want.

---

## For the NEXT pull request — asked for, measured where possible, not built

None of these blocks the merge. Each is written down with what was measured, so the next session
starts from a fact rather than from a recollection.

### 1. Two rules on one fault, since passes 4 and 6

Measured after both passes, on a config that narrows several things at once:

```
letter-spacing: 2rem   →  literal-not-allowed + unit-not-allowed
margin: 8px            →  shorthand-not-allowed + literal-not-allowed
padding: 1px 2px       →  too-many-values + literal-not-allowed
```

Each of those is ONE mistake. `literal-not-allowed` is the widest of the rules — it fires on any
written-out value of a variables-only kind — so it lands beside every narrower one that also fired.

This is the repository's recurring fault in a new place, and it is the shape `inOrder` already
answers for the compiler's word: the most SPECIFIC finding at a position should be the one kept.
`unit-not-allowed` says which unit; `literal-not-allowed` says the kind comes from variables. Both
are true; only one is the thing to fix first.

### 2. Class names — shorter, more readable, and one approach rather than two

The user's words: *"mislim da neke mogu da budu jos krace ili citljvije"*, and — the part that
decides — *"mislim da cemo morati da iskljucimo onu opciju da ih generisemo sa hash uvek."*

**The reason is packaging, and it is a good one.** People will build a component library in one
package and consume it BUILT in another. Two naming modes means two packages can name the same
declaration differently, and nothing at consume time can notice: the CSS is already emitted. One
approach, always, is what makes a built package composable with a source one.

`CONTRACT.md` §3 already fixes the prefix for this exact reason, and `config.ts` refuses `names`,
`hash` and `prefix` as settings because identity is the one thing every consumer must agree about.
The `names: "hash"` bundler option is the remaining way to disagree.

### 3. A manifest carrying what a package REQUIRES — measured, and it does not exist

The user remembered a Ramonda build step writing a manifest that carries the app tree, and asked
whether it could carry a package's required variables too.

Measured: there is no such thing today. `apps/docs/scripts/build-manifest.mjs` is the docs app's own
script and maps lazily-imported modules to chunk URLs — *"the piece nothing at runtime can know"* —
and `@ramonda/build` exports bundler settings and nothing else. No package emits a manifest.

So this is a design question rather than a change: a built package that uses `$.color.accent.main`
needs the consuming app to declare that variable, and nothing carries that requirement across the
package boundary today. The `@property` registration in the built stylesheet is the nearest thing —
it declares the name and its initial — which may be the whole answer, or may need a manifest beside
it. Not decided.

### 4. An unclosed call eats the block's closer

Measured twice, in an earlier review and again in pass 3, unchanged:

```
content: url(;

unknown-value: `content` does not accept `Hello`.
unknown-value: `content` does not accept `div`.
```

Two words out of the author's own JSX, reported as CSS values — the value ran past `)}` into the
markup, because `readValue` counts parens and a block's closer is a `)` like any other. The real
fault, a missing `)`, is never named.

The parens are BALANCED, so a cheap check does not exist, and the value scanner is what all 39 rules
read. This one needs a design before code.

---

## `css-system/`, committed — and the argument that was wrong

The generated files were `ramonda.css.generated.ts` and `.css` beside the config, both gitignored.
The user asked about both halves at once: *"gledam playground i ovi generisani fajlovi su
gitignorisani. Ja mislim da to ne treba da bude ignorisano, kao sto se i ostale codegen stvari ne
ignorisu. Samo je pitanje da li je bolje da ove generisane stvari imaju svoj folder."*

**The reason for ignoring them was written down and it was wrong.** It said committing would let a
config and its output drift apart in review. That is the right worry and the wrong answer, and this
repository already answers it the other way for its own generator: `keywords.generated.ts` is in the
tree and `build-css-properties.mjs --check` fails when it is stale. Hiding a file does not stop it
drifting — it stops anybody SEEING that it has. And it costs a fresh clone its `$` until something
builds, which an editor meets before any build runs.

So `check-css-system.mjs` runs codegen and compares, and is wired into `pnpm check` beside the other
cheap read-only checks. Seen to fail: one hand-edited line and it names the file.

### The name

`.ramonda/` was proposed and refused by the user, for a reason worth keeping: **a leading dot reads
as *not committed*,** and these are. The name had to be agnostic besides — `@ramonda/css` is usable
outside Ramonda, where a folder named after the framework says nothing, and inside one where it says
nothing either.

`css-system/` says what is in it and names neither framework nor tool. The nearest precedent is
Panda CSS's `styled-system/`: committed, framework-agnostic, and a shape people recognise.

```
ramonda.css.ts          the config
css-system/
  index.ts              `$`, `Value`, `Var`, and this project's narrowed property map
  variables.css         `:root`, and an `@property` for each
```

`index.ts` so an import writes the folder and no filename — `import { $ } from "../../css-system"`.

### `outDir`, and why it is read from the TEXT

The user asked for it to be configurable, and the reason is concrete: a project may already have a
folder called `css-system`, and a generated one landing silently beside it is worse than a key.

`propertiesFor` and `variablesSheetFor` are asked PER FILE — they run inside an editor, on every
keystroke's worth of work — so they read the key out of the config's text with a regex rather than
transpiling it. A config that computes the name falls back to the default for those two lookups and
is still written correctly by `writeGenerated`, which has the real config. That is a mismatch a
project can see and fix; a transpile per file to close it would be the worse trade.

A path that climbs out of the project, or starts at the root, is refused.
