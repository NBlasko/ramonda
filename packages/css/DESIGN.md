# A style block that becomes a class before the browser sees it

**Status: BUILT.** This header said *a design, not a package — no `package.json` on purpose*, and
that stopped being true when the package landed: `@ramonda/css` is a real workspace package at
`0.0.0`, private and unpublished, with a compiler, a check command, an editor plugin, two bundler
adapters and a formatter wrapper.

> **The spelling changed on 2026-10-02**, after most of this was written: code goes into a block as
> `$( … )` (it was `{ … }`, and `{{ … }}` before that), a condition is `when $( … ) { … }` with
> `else when` and `else` (it was `if ({ … })`, and `@@if` before that), a match is `match $( … ) { … }`
> at both levels, a value may be a choice `$(c) ? a : b`, and a variable is `$group.path` (it was
> `$.group.path`). Prose here has been moved to the new spelling where it names the construct; where
> it records what an OLD spelling did, the old spelling is the point and stays.

This file is the *why*, and it is the oldest of the three. `PLAN.md` is the *when*; `CONTRACT.md` is
what both halves must agree on.

> **Everything above §15 is a RECORD of what was decided when, and its examples are written in the
> spelling of the day.** Six steps landed on 2026-09-22 and §15 is their live account: `match`,
> `@@property`'s typed setter, the hole refused, a key in every class name, `merge` over strings, and
> the `css` prop removed — a block goes on `className`. Where an example above writes `css=@@( … )`
> or a map, read §15 for what it is now. Rewriting the record would delete the reasoning that led
> here, which is the one thing this file is for.

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

### A `$color.primary.main` syntax for variables — BUILT

**Status 2026-10-02:** built and shipped — `$` paths in a block, codegen's `css-system/`, and the
pages in `style-blocks/variables.md`. What follows is the reasoning as it was weighed.

The user's proposal: a third spelling for a custom property, `$color.primary.main` instead of
`var(--color-primary-main)`, with three reasons. Two of them turn out to stand differently than
posed.

**"It does not create a hole" is already true of `var()`.** Measured through the real transform:

    var(--accent)   ->  "border-left": "r-bl-4px_solid_var(--accent)"     a class, no value
    {accent}        ->  ["r-J7FSVc8dZ", accent]                          a class AND a value

So a `var()` costs nothing per element and nothing on a change; the new syntax adds no capability
there. **The argument survives in a stronger form**, though: a hole costs 41 bytes an element and a
render, people reach for one anyway, and making the free path the SHORT path is a real lever. That is
a different claim from "it avoids a hole", and it is the one worth arguing.

**"It is shorter" barely is.** `$color.primary.main` is 20 characters against 25 for
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
    $color.                                             5 offered   border, primary, state, …
    $color.primary.                                     4 offered   contrast, dark, light, …

The service returns the whole list at both string positions; the editor narrows what it DISPLAYS by
what has been typed. That is filtering, and filtering requires already knowing the name. The nested
object answers the other question — *what exists here at all* — and it is the question somebody
reaching for a token usually has. At two hundred tokens the gap widens rather than closes.

**The objection is the user's own principle.** This would be the THIRD spelling of one thing:

    var(--color-primary-main)   plain CSS, checked by our rule against every name the build sets
    var({accent})               a `@@property` binding, checked by TypeScript, compiles to a name
    $color.primary.main        proposed

`Why the condition is inside { }` in the docs makes exactly this argument for `when $(…)`: *the
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
| `$color.primary.main` | **closed** — the tokens this project declared | the type: complete, with completion and rename |
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

**A group is an error; always write a leaf.** `$color.primary` names three variables and no value.
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

$size.control.sm   in a padding narrowed to 4/8/16/24   ok
$size.control.md   the same slot                        TS2345  Var<"length","30px"> is not PaddingScale
$color.primary.main                                     TS2345  a colour
```

That last pair is the point of the kind: the narrowing a project sets on a property reaches its
variables too, and the message names the offending VALUE rather than the variable.

Measured: 5,133 instantiations against 4,776 for an empty program, 0.39s either way.
`prototype-variable-types.ts` is the probe, and four errors in it are expected.

#### The config, entire

```ts
export default defineConfig({
  variables: {
    $color: kind("color", {
      primary: { main: "#3b82f6", light: "#93c5fd" },
      surface: { base: "#ffffff", sunken: "#f3f4f6" },
    }),
    $size: kind("length", {
      control: { sm: "24px", md: "30px" },
      weight: kind("number", { bold: 700 }),
    }),
    $motion: kind("duration", { fast: "120ms", slow: "400ms" }),
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
                 ->   $color.primary.main  ->  var(--color-primary-main, #3b82f6)
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
read($color.primary.main, el)   // getPropertyValue, trimmed; "" becomes the declared fallback
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
    $color: kind("color", {
      primary: { main: "#3b82f6", light: "#93c5fd" },
      surface: { base: "#ffffff" },
    }),
    $size: kind("length", { control: { sm: "24px", md: "30px" } }),
    $motion: kind("duration", { fast: "120ms" }),
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

`$color.primary.main` in a block compiles to `var(--color-primary-main, #3b82f6)`. In TypeScript it
is a real object, which is what `read` and `toStyle` need.

##### 4. Where a wrong value is caught — and where it is not

This answers the user's question directly: *do we scream at build too, or only at runtime?* Both, but
not everywhere, and the gap is worth knowing.

| a wrong value written… | caught at build? | by what |
|---|---|---|
| in the config — `kind("length", { md: "#3b82f6" })` | **yes** | `tsc`, `TS2322` |
| in a block — `padding: $color.primary.main` | **yes** | the types, `TS2345` |
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
  virtual file. Measured — `$space.inline.2xl` does not parse (`TS1351`), `["2xl"]` does — and the
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

### Two things the user found while using it — both CLOSED

**Status 2026-10-02:** the token's value is split from what it may become — `kind(…, { value,
range })`, documented in `variables.md` under *A range, when the value is meant to move*; and the
path's colouring shipped in the extension's 0.2.0. The question as it was put:

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

`$space.gutter.wide` colours only `space`, as a property VALUE, and the rest — the `$`, the dots,
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
node packages/css/probes/prototype-typecheck.mjs packages/css/probes/example.tsx.txt
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
- **A token is not a hole in the strictness.** `padding-left: $rems.big.one` is refused where the
  property is px-only; `z-index: $space.gutter.normal` is refused because a length is not an
  integer.
- **`$` earns the virtual file.** `$space.gutter.norml` gets *Did you mean 'normal'?* from
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
unknown-variable  `$space.gutter.norml` is not a variable this project declares.
                  Did you mean `$space.gutter.normal`?
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
asking anybody to write `$space.none`. The dimensionless zero went out with the literals because
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
You declared `$space.sm` with exactly this value.
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
padding-left: $s.ok    accepted   declared 8px, which the list permits
padding-left: $s.big   refused    declared 30px, which it does not
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
toStyle([[$space.gutter, "24px"]])

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

           Declare it in `ramonda.css.ts` and write `$group.…`, or set
           `"padding-left": { variablesOnly: false }`.
```

**What is deliberately not a literal.** A CALL is an escape hatch and is not read into —
`calc($space.md * 2)` holds a `2` that is not a hardcoded length and nothing here can tell it from
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

## Asked for after the first pull request — each item says where it stands

None of these blocks the merge. Each is written down with what was measured, so the next session
starts from a fact rather than from a recollection.

### 1. Two rules on one fault, since passes 4 and 6 — FIXED

**Status 2026-10-02, measured:** each of the three below now gets one rule — `literal-not-allowed`,
`shorthand-not-allowed` and `too-many-values` respectively.

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

### 2. Class names — shorter, more readable, and one approach rather than two — CLOSED

The user's words: *"mislim da neke mogu da budu jos krace ili citljvije"*, and — the part that
decides — *"mislim da cemo morati da iskljucimo onu opciju da ih generisemo sa hash uvek."*

**The reason is packaging, and it is a good one.** People will build a component library in one
package and consume it BUILT in another. Two naming modes means two packages can name the same
declaration differently, and nothing at consume time can notice: the CSS is already emitted. One
approach, always, is what makes a built package composable with a source one.

`CONTRACT.md` §3 already fixes the prefix for this exact reason, and `config.ts` refuses `names`,
`hash` and `prefix` as settings because identity is the one thing every consumer must agree about.

#### CLOSED — measured, and nothing was left to build

**There is one approach already.** The `names: "hash"` bundler option this note called *the remaining
way to disagree* does not exist: both plugins take `runtime`, and esbuild also takes `filter`. A name
is readable when it can be and a hash when it cannot, and the five cases that force a hash are
properties of the declaration rather than of anybody's settings — a hole, no spelling for the
context, a character a class name cannot hold, an underscore the author wrote, or a name over
`NAME_BUDGET`.

**The packaging worry is answered, and is now a test.** The same declaration compiled under seven
configs that disagree about units, kinds, shorthands, variables, silenced rules and `outDir` comes
out as ONE class name each time. `what a project's config may not change` in `nameFor.test.ts` holds
it; seen to fail by making a name depend on `units`.

**Shorter is measured and has no defensible change.** Over forty declarations a real app writes:

```
38 readable, 2 hashed          the two are a `linear-gradient(…)` and a quoted font stack
shortest 6   median 12   longest 30   (budget 32)
```

The long ones are long because their VALUES are — `r-anim-spin_1s_linear_infinite` is thirty
characters and twenty-three of them are the author's own text. Every unabbreviated property that
turned up (`text-overflow`, `scroll-margin-top`, `will-change`, `object-fit`) is one with no
conventional short spelling, and the abbreviation table's own note answers that: *an abbreviation
nobody recognises is worse than the property's own name — it is shorter and it has to be learned.*

### 3. `ramonda.graph.json` — a build artefact saying what a package needs and gives — NOT built

**Not built. Measured, scoped, and then widened by the user in a way that changes the shape** — so
this is the record a next session starts from, and the shape below is not final.

The user's own words for what it is for: *"neki json ili slicno nesto sto ramonda build bi trebalo
da kreira, kako bi smo mogli to da damo drugim paketima koji se reuzaju da mogu da sastave citav
graf"*.

#### What it does not exist today

`@ramonda/build` exports bundler settings and two adapters, and nothing else — no package emits any
artefact of this kind. `apps/docs/scripts/build-manifest.mjs` is the docs app's own script mapping
lazily-imported modules to chunk URLs, which is a different question.

#### The three things measured to be missing, each by a failure

A library `@acme/ui` whose block writes `color: var(--acme-accent)`, published as `dist`:

| what is missing | what happens today |
|---|---|
| **`requires`** — names the package reads and does not set | the page renders with the variable unset and NOTHING anywhere says so |
| **`provides`** — names the package sets | the consuming app is **refused**: *nothing in this build sets `--acme-radius`* — a false report, worked around by listing the name by hand in `alsoSets` |
| **`values`** — where the values are | a library declaring `$` produces `css-system/variables.css` holding `:root { --acme-accent: … }`, its `files` is `["dist"]` so it does not ship, and the consumer has no way to know it must import it |

The `provides` row is the sharpest: it is not a silent fault but a build that **stops**, and the cure
is hand-maintaining a list the package already computed.

**And the build KNOWS all of it.** Measured on that library's own transform:

```
the file SETS:  []
the file READS: ["--acme-accent"]
```

That is computed, used for one check, and thrown away.

#### One thing measured and ruled OUT

The cascade layers do not need carrying. Two packages' emitted stylesheets declare an identical
nineteen-layer statement, so there is nothing for a consumer to reconcile.

#### The shape as it stood before the last measurement

```json
{
  "ramonda": 1,
  "name": "@acme/ui",
  "css": {
    "requires": ["--acme-accent"],
    "provides": ["--acme-radius"],
    "values": "./css-system/variables.css"
  }
}
```

#### What widened it, and why the shape above is not final

**The user raised injected dependencies**, and they are right that it changes this: *"zamisli da imas
paket koji ocekuje funkciju foo, ali ta funkcija se kreira u drugom paketu i potrebno je
injectovati."*

A package expecting a value another package creates is the SAME question as a package expecting a
custom property another package sets — `requires` and `provides`, for values rather than for names
in a stylesheet. So the file is not a CSS artefact with a `css` key bolted on; it is a
requires/provides record of which CSS is one kind.

Today the mechanism for receiving something from elsewhere is `createContext`, exported from
`@ramonda/core`. Whether a context is the thing to declare, and whether a package can know statically
which ones it needs, is **unmeasured** — and it has to be measured before this file is designed,
because it decides whether the CSS half can be written first without the shape moving under it.

#### The rule that governs building it, whenever that is

**No producer without a consumer.** This repository already has one of those written down: `format:
{ indent }` was accepted, validated and documented in its own type, and NOTHING read it — a person
could set it, be told nothing, and get two spaces. A `ramonda.graph.json` that nothing reads is the
same fault in new packaging.

So whatever is built first ships with the side that FAILS: an app installing a package with an
unmet requirement hears about it at build time, with the package named, and an app reading a name an
installed package provides stops being refused for it.

### 4. An unclosed call eats the block's closer — FIXED

`content: url(;` reported two words of the author's own JSX as CSS values, and the real fault — a
missing `)` — was never named. The note parked this saying the parens are BALANCED so no cheap check
exists.

**That is true of the BLOCK and false of the DECLARATION**, which is what unlocked it: inside one,
`url(` is short a `)` and counting says so. Two things the count has to do, both measured: skip a
string (a naive count called `url("a)b.png"` balanced and `url("a(b.png")` unclosed, both
backwards), and stop at the `;` — because the fault itself means the value has already swallowed the
block's closer.

Two halves, because a refusal runs before any rule: `unclosed-call` is what an editor shows, and the
strict read carries the same sentence and reports at the CALL's own position. Measured through the
CLI: `src/Card.tsx:2:12`, on `url(` itself, where it used to say line 4.

### 5. A number where only keywords go — FIXED

`display: 1` compiled in silence while `position: 1` was caught, and both take no number. The note
had the design already: *the fix belongs in the GENERATOR — a positive fact, measured against the
engines rather than guessed from a gap.*

`scripts/build-numberless-properties.mjs` asks Chromium, Firefox and WebKit
`CSS.supports(property, n)` for seven numbers, and records the 241 of 566 unprefixed properties that
refuse all of them. Three decisions inside that, each measured:

- **seven numbers, not one** — `1` alone would have called `font-weight` numberless;
- **the INTERSECTION, not the union** — every other generator here takes a union because a keyword
  any engine accepts is one somebody may write; this says a number is WRONG, so all three must
  agree. Chromium alone claimed 301;
- **a property an engine does not KNOW is dropped**, because silence is not agreement.

The rule fires only when the number is the WHOLE value. `box-shadow: 1` is refused by all three and
`box-shadow: 0 0 1px red` is accepted by all three — the `0` is a length. The first version reported
both, and `transform: scale(2)` with them.

### 6. Forbidding a pseudo-class — asked for nothing, and NOT built

Measured: there is no way to say *this project does not use `:hover`*. `properties` is keyed by a
property, a kind or `"*"`, and a selector is none of those; `rules` takes a rule id and there is no
rule to silence. A block writing `&:hover { … }` under either spelling compiles, and nothing is
reported.

**Left alone deliberately.** Every other item in this chapter earned its place by something breaking
quietly — a false report, a build that stops, a page that renders wrong with nothing said. This one
breaks nothing: the CSS is correct, the compilation is correct, and the only thing missing is a
prohibition nobody has asked for.

Building it would also mean a fourth kind of key in `properties`, whose whole design is that the
three it has nest — `"*"` then `"<kind>"` then a property name, each a narrowing of the one before.
A selector is not a narrowing of a property; it would be a second axis, and that is a cost to pay
when somebody wants it and not before.

### 7. A block a PROP can constrain — SHIPPED

**Status 2026-10-02:** shipped as `CssBlock<Allow>`, documented in `style-blocks/prop.md`, with the
CSS-wide keywords taken by every narrowed value since §13. The design as it was agreed:

The user asked for a type on `@@` that limits what may be sent through a prop, drawing the
comparison with a typed `sx`:

> *"bilo bi lepo da moze da se gurne tip na `@@` sintaksu … u kojoj mozemo da ogranicimo opet sta
> moze da se salje. Usecase je kada zelimo kroz props da posaljemo samo odredjene stilove za
> odredjen element ili skup elemenata."*

Designed with them on 2026-09-18. Everything below was measured in scratch; **none of it is in the
package yet**. Their brief for the shape of the answer: *"da bude smisleno, da rezultat na kraju
bude dobar DX i da ne dozvolimo previse sposobnosti koje ce na kraju da nas ujedu."*

#### What StyleX does, read rather than recalled

`@stylexjs/stylex@0.19.1`, from its own `.d.ts` files, because it is the only other project that
has shipped this and its boundaries are worth knowing before ours are drawn.

- **A prop carries a compiled class name, not a style.** `StyleXClassNameFor<Key, Value>` is an
  opaque `string` with the key and the value kept in the brand. That is what makes both sides
  typable at all.
- **The allow-list is a type parameter**, `StyleXStyles<{ color?: string }>`, and the refusal of
  everything else is an intersection that types every OTHER known property as `never` — so the
  error names the offending property rather than the whole object. They also ship the deny-list
  (`StyleXStylesWithout`) and a stricter pair that refuses runtime values (`StaticStyles`).
- **Conditions attach to a VALUE**, not to a block: `color: { default: 'red', ':hover': 'blue' }`.
  The condition key is typed `` `:${string}` | `@${string}` ``, so `:hover` and `:nth-child(2n)`
  are the same to the type. Their rule `no-lookahead-selectors` then bans some in LINT — evidence
  that a vocabulary of permitted pseudo-classes cannot live in the type.
- **Pseudo-elements are a hand-written closed list** of keys, with `::part()` and `::slotted()`
  given up on in a comment as "a pattern and not a static key".
- **Descendants cannot be expressed at all** — there is no key shape for a combinator.

**What they do NOT catch is the thing the user was most worried about:** a child that declares the
prop and never applies it. Nothing in their types or their nine lint rules sees it.

#### And how the two MERGES compare, measured through both runtimes

The user asked which is safer. Neither dominates — they are strict about different things.

| | StyleX (`styleq`) | ours (`merge`) |
|---|---|---|
| the merge key | the property name | `condition\|property` |
| `color` then `color` | `c-blue` | `r-blue` — the same |
| a hover colour, then a plain one | **`c-green`** — the hover is gone | **`r-hov-blue r-green`** — it survives |
| a longhand then a shorthand | cannot be written at all | `r-p-8` — cleared exactly |
| a shorthand arriving past a spread | — | `r-p-8` — the clear-list travels |
| `padding` inside a `@media` | — | `r-pl-40 r-m-p-8` — cleared only in THERE |

**We are stricter on shorthands.** StyleX does not solve the shorthand/longhand merge; it removes
it. Its lint rule reads *"Require shorthand properties to be split into individual properties"*, so
`padding: 8px` may not be written. Ours emits `~padding` carrying all ten longhands, and the key
carries context — measured, a `padding` inside a `@media` cleared the `padding-left` inside that
same query and left the outer one standing. And the difference in the KIND of guarantee matters:
theirs is a lint rule, which one comment disables; ours is in the compiled output, which nothing
does.

**On conditions they differ, and it is not a strictness difference — it was written up as one here
and that was wrong.** For them one property is one unit: replacing `color` takes its `:hover` with
it. For us `color` and `&:hover|color` are different keys and both survive.

Ours is the behaviour plain CSS has, which `behave-like-css` requires. Measured: both land in the
same layer, `.r-\:hover-c-blue:hover` is (0,2,0) against `.r-c-green` at (0,1,0), so the hover wins
while hovering whatever order they were written in. Nothing is ambiguous and no rule is needed —
`override-out-of-order` does NOT fire on this pair and never would, because it is about two
conditions that TIE in the sheet, which a pseudo-class and a bare selector never do.

What StyleX buys with total replacement is a different override CONTRACT: a caller who writes
`color: green` gets green in every state, and can never inherit a state they did not write. That is
a real property. It costs them agreement with CSS, and this package has already chosen the other
side of that trade.

**The one strictness they have that this design does not:** `StaticStyles` refuses runtime values
outright — *you may style me, but with nothing computed*. A slot here can constrain what a hole
evaluates to (`Token<"color">` refuses a bare string in a hole, measured) but cannot forbid a hole.
Whether that is wanted is open; it is named here so it is not mistaken for an oversight.

Their `no-conflicting-props`, which bans `className` and `style` beside a spread of
`stylex.props()`, has no counterpart here and needs none: `css` and `className` are separate props
that both land, so the collision it guards against does not exist.

So StyleX is stricter by **removing capability**; this package is stricter by **tracking more**. The
second costs a clear-list and a rule, and takes nothing away from the author.

#### The shape, and the decisions taken

```ts
type Sx = {
  color?: Token<"color">;                    // a property -> a constraint on its value
  gap?: "8px" | "16px";
  "&:hover"?: { color?: Token<"color"> }[];  // a state -> a FLAT list of its own
};
```

Written in the vocabulary that already exists — `CssProperties` for the names, `Token<Kind>` for a
declared variable — so no second dialect appears beside `ramonda.css.ts`. The names are the CSS
names, dashed and quoted, the same spelling a block uses.

Decided with the user:

- **The short form is in.** `Slot<"color" | "gap">` when the values do not matter. The map is the
  full form and the union of names is the shortcut.
- **Pseudo-elements are out.** They make a box the child does not control, and `content` and
  positioning are exactly where a silent break happens. A child that needs one exposes a second
  slot.
- **One slot is one element.** A child that wants to expose an inner part names another slot for it,
  rather than letting a caller reach through a combinator. Its own structure is not its API.

#### What the prop is CALLED, and it is `css` both times

Measured before deciding: **no component in this repository takes a block through a prop**, so this
feature creates the convention rather than joining one.

**`css` for the element a component IS, and `<part>Css` for each named part.**

```tsx
function Card(props: { css?: CssBlock<Root>; titleCss?: CssBlock<Title> }) {
  return <div css={@@( display: flex; ...$(props.css); )}>
           <h2 css={@@( ...$(props.titleCss); )}>…</h2>
         </div>;
}
```

The host attribute keeps its name and is not renamed to anything. It is the older name for this
idea — a `css` prop taking styles written in CSS shipped years before the system-prop spelling that
is easy to reach for — and that other spelling carries a promise this package does not keep: there,
values go through a theme scale, so `p: 2` means a multiple. Here a value is a CSS value. Beyond
that it is declared in `CONTRACT.md`, implemented in the framework, and exists so a wrapper can put
it on another JSX library; renaming it is a break across two packages for nothing.

Using the same name for a component's own prop was measured to be safe: the framework intercepts
`css` only where `"tagName" in node` — a host element — so on a component it is an ordinary prop it
never touches.

Three reasons it beats a generic name, and each follows from a decision already taken:

- **One slot is one element**, so a component with parts has several props. A generic name cannot
  say which element it styles; `titleCss` can, and it scales where the generic one stops at two.
- **A caller need not know what `Card` is.** `css={…}` means the same thing on a `<div>` and on a
  `<Card>`.
- **Nothing fails quietly.** A component that did not declare the prop refuses it as an unknown
  prop, which is an ordinary type error.

#### The mechanism, and it is the only one of three that works

```ts
declare function __block<A extends Allow = Allow>(d: NoInfer<{ [P in keyof A]?: A[P] }>[]): CssBlock<A>;
```

`NoInfer` is load-bearing: the allow-list has to be **fixed from the return position before the
block is read**. The two alternatives were measured and both put the fault in the wrong place.

| shape | what happened |
|---|---|
| infer `A` from the argument | every line reported, including the correct ones |
| compare `CssBlock<Keys>` on the result | one error on the whole call, naming `Block2<…>` — scaffolding the author never wrote |
| `NoInfer`, the allow-list fixed first | the fault lands on the value, on the property, or inside the state |

Measured with the real generated types, against `Sx` above:

| the caller writes | where the error lands |
|---|---|
| `color: {brand}` | quiet |
| `color: red` | the **value** — *`string` is not assignable to `Token<"color">`* |
| `padding: 4px` | the **property** — *`padding` does not exist in type `{ color?: …; gap?: … }`* |
| `&:hover { padding: 4px }` | `padding`, **inside** the state |
| `&:focus { … }` | the state — it is not in the list |
| `& > span { … }` | the selector |

**The control:** an ordinary block, in no slot at all, carrying `padding`, `display` and `color`
together, is silent. Existing blocks are untouched.

The user agreed to raise the `typescript` peer floor to 5.4 for `NoInfer` — *"mozes slobodno i da
podignes, a ko neko pocinje projekat, pocinju ga sa novim typescriptom"*. A pre-5.4 spelling,
`[T][T extends unknown ? 0 : never]`, was measured to behave identically if it is ever wanted back.

#### Three things that need no rule of their own

- **A combinator is refused because it is not a key.** `& > span` fails by the same mechanism as
  `padding`. There is no list of forbidden selectors to keep.
- **`!important` closes itself.** The moment a value is narrowed to `"8px" | "16px"`,
  `"8px !important"` stops being assignable.
- **Pseudo-classes are not a category.** `&:hover` passes only because the child wrote it, and
  `&:focus` fails because it did not. This is the same conclusion StyleX reached from the other
  direction, and it means the measurement that found no vocabulary of element-local pseudo-classes
  costs nothing here.

#### Three things measurement refused

**Nested is an ARRAY.** The compiler emits `{"&:hover":[{color:"blue"}]}`. The first allow-list
type used an object and failed against the real emitter. Read what is emitted; do not assume it.

**Forwarding belongs to the CHECKER, not to the type — measured after three type-level attempts
failed.** A child allowing `{ color, gap }` may hand its slot to a grandchild allowing only
`{ color }`. Plain assignability stays quiet, because extra entries are optional. Required-ifying
the entries then broke the safe direction, refusing a block that sends LESS than permitted. And a
keys witness — `{ keys: keyof A; allow: A }` — is correct written out by hand and stops working the
moment it is behind a generic alias, because **TypeScript measures variance for a generic reference
and takes that shortcut instead of comparing structurally**: `{ keys: keyof A1 }` against
`{ keys: "color" }` is refused, and `Brand<A1>` against `Brand<A2>` is not.

So the comparison is done where it is trivial. Measured: from the contextual type of the forwarded
expression and the type of the expression itself, the checker reads both allow-lists and takes the
difference of their keys —

    forwarding {color,gap} into {color}       ->  REPORT: gap
    forwarding {color,gap} into {color,gap}   ->  quiet

— and it **names the offending key**, which no assignability error could. This is the same division
the section reaches for composition: the type checks a literal against a fixed shape, which it does
excellently; anything that compares two allow-lists is ordinary code with a program in hand.

**677 of the 832 properties are `CssValue`, which is `string | number`.** `color`,
`background-color`, `padding`, `margin`, `gap`, `display`, `width`, `height`, `font-size`,
`border-radius` — all of them. Only 155 are closed keyword sets, and of a realistic list only
`flex-direction` and `text-align` were among them. So **the default constraint constrains almost
nothing**, and only two constraints are worth teaching: `Token<"color">`, which is the one that
earns the feature — *you may recolour me, but only from the theme* — and a literal union.

#### Two rules the slot brings with it, and a new category for them

`rules.ts` states in its own header that a rule reads a parsed `Block`, not a `ts.Program`, and may
not import `@ramonda/check`. Both rules below need a program, so they do not belong in `rules.ts`.
They are **typed rules**, beside the existing ones rather than among them.

**Rule 1 — a slot nobody consumes.** The user's own worry, in their words: *"Najvise me brine da
neko ne stavi nesto da ide kroz props, a ja ga ne konzumiram na strani deteta, to je cesto slucaj da
se tiho rastave stvari."* Eight shapes measured, and two controls each flipping exactly one of them.

- **Walk BACKWARD from every `__from` and `__val`, following initialisers.** The forward walk, from
  the declaration to its references, falsely reported `const s = this.css; ...$(s)` — a prop that is
  used, through one local. Breaking the initialiser-following on purpose put that false report back,
  which is how the fix is known to be the fix.
- **A destructured prop is TWO slot-typed declarations.** For `function M({ css }: { css?: Slot })`
  the `BindingElement` and the `PropertySignature` are different symbols, and the subject was
  reported twice — once quiet, once wrongly. They have to be linked.
- **The honest limit:** a slot consumed inside a method nobody calls passes quietly. That is
  reachability, a different tool. The rule catches *never consumed*, not *consumed on a dead path*.
- **The control that passed first time:** a prop that is not a slot is never mentioned at all.

**Rule 2 — a slot that silently loses.** The user asked it directly: if the child spreads the slot
and then writes a shorthand below it, does anything scream? Measured: **nothing does, twice over.**
TypeScript sees `padding` and `padding-left` as two unrelated keys, and `flatten` does not put a
spread in the block at all, so the rule has nothing to look at.

The allow-list is what makes a spread legible for the first time. The relation machinery already
exists and is right — `covers` and `conflict` in `flatten.ts`, checked across nine shorthand
families including the logical ones (`margin` over `margin-block-start`, `inset` over `top`).

> **The rule: nothing the slot allows may be written below the spread.**

**The runtime is not wrong here, and that is the point.** Measured: the merge emits `~padding` with
the full clear-list and the list travels through the spread, so `padding` really does clear the
caller's `padding-left` — and a `padding` inside a `@media` clears only the `padding-left` inside
that same `@media`, leaving the outer one alone. So this rule is not about a broken merge. It is
about a child that PROMISED a property in its allow-list and then took it back.

`...$(css); padding: 8px` with `padding-left` allowed is `covers(padding, padding-left)`;
`...$(css); color: red` with `color` allowed is `conflict(color, color)`. `padding: 8px; ...$(css)` is
quiet, and that is the order a slot is for. There are two fixes and both are right — move the spread
down, or take the property out of the allow-list. The second turns a CSS ordering mistake into a
question about the API: *why promise `padding-left` and then clear it?*

`overrideOutOfOrder` deliberately stays quiet on `padding-left: 40px; padding: 8px` when the author
wrote **both** lines, with a measurement behind that call, and it is still right. This is a
different question, because the earlier value came from somebody who cannot see the later line.

#### Where a typed rule can run, and why it is not ours alone

| | has a `ts.Program` | can run a typed rule |
|---|---|---|
| `ramonda-css check` (CI) | yes, builds one in `checkProject` (`check.ts`) | yes |
| the tsserver plugin (the editor) | yes, via `languageService.getProgram()` | yes — unused today |
| the vite and esbuild plugins | **no** — `createProgram` appears 0 times in either | no |

So this is **not** a build-time feature. Both adapters only transform and never see a type.

**It needs nothing from `@ramonda/check`** — no graph, no component model, no decorator. The
manifest is the proof: `@ramonda/css` depends on `magic-string` alone, with `typescript` as a peer.
Measured on plain `function` components with no class and no decorator, the rule behaves
identically. It wants three things — a program, the `__from`/`__val` bindings, and the identity of
the slot type — and all three are in this package. Whatever renders the elements is irrelevant.

#### Composition does not need a type, and that division is the design

Raised by the user with an example of their own, and it is the better question:

```tsx
const base = @@( @media (prefers-color-scheme: dark) { color: white; } );

const card = <div css={@@(
  ...$(base);
  @media (min-width: 40rem) { color: blue; }
)}>…</div>;
```

**It is not a fault.** The real emitted stylesheet puts the scheme query first and the width query
second at equal specificity, so the width wins — and it is the same answer when `base` is in
another file, when both are written inline, and **when the files are added in the opposite order**.
`widthSlot` ranks them 2 and 5644: different bands, so the sheet can order them and does. There is
nothing here to type, and a type parameter that never changes an answer is cost without benefit.

**The same-band case IS a fault, and it is silent through a spread.** Two `@supports` in one block
are reported by `override-out-of-order`; the moment one arrives by `...$(base)` the rule sees
nothing. So the single fault — *a spread is opaque* — has two faces: **merge time**, where a
shorthand clears a longhand, and **sheet time**, where two same-band conditions tie.

**But only one of the two needs a type**, and this is the rule to keep:

- **`...$(base)`** — there is a declaration to follow. Measured: the checker resolves the import
  across modules and reads the block verbatim. The COMPILER deliberately does not — `...$(base)`
  emits `_merge(base, {"@media (min-width: 40rem)|color": "r-…"})`, a runtime merge of class maps
  keyed `condition|property`. The checker is not the compiler, and it can read what the compiler
  chose not to.
- **`...$(this.css)`** — there is no declaration. The value comes from a caller who has not been
  written. Only the type can describe it.

**The block type must NOT carry both its contents and its allow-list.** Measured: it works, and the
message degrades from *`padding` does not exist in type `{ color?: … }`* on the property to
`TS2345 … & NoInfer<…>[]` on the whole argument — losing exactly what made the mechanism worth
choosing. The type carries the allow-list; composition is read from source.

#### Refusing a runtime value — reachable, and it costs no expressiveness

Measured, the difference a hole makes is real: `color: red` emits `r-c-red { color:red; }` and the
element carries a class, while `color: {this.brand}` emits `color:var(--r-OsXzXT1Qd-0)` and every
instance carries an inline custom property. Ten thousand rows is ten thousand style attributes.

**The reason this can be refused without losing variants is that a condition is not a hole.**
StyleX has three mechanisms and `StaticStyles` refuses only the third — selecting a precompiled
style by a condition, conditions inside a value, and a style function returning
`[compiledStyles, InlineStyles]`. This package has all three, and the first compiles to pure class
selection:

    when $(this.active) { color: blue; }
      CSS    r-c-red{color:red;}  r-c-blue{color:blue;}
      value  _merge({"color":"r-c-red"}, this.active && {"color":"r-c-blue"})

    color: {this.brand}
      CSS    r-OsXzXT1Qd{color:var(--r-OsXzXT1Qd-0);}
      value  _merge({"color":["r-OsXzXT1Qd", this.brand]})

No custom property, no inline attribute, two static rules in the sheet. `...$(cond ? hot : cold)`
is the same. So a project or a slot that forbids holes loses nothing it cannot say another way.

**Two levels, both measured.**

- **Project-wide** is an ordinary rule over the AST — `HolePart` is already in the tree, so it needs
  no program and belongs in `rules.ts` with the rest.
- **Per slot** is a flag on the block type, `CssBlock<A, S extends boolean>`. `CssBlock<A, false>`
  is refused where `CssBlock<A, true>` is wanted, and both pass where `boolean` is. It works where
  the allow-list COMPARISON did not, and the reason is worth keeping: a boolean literal is not a
  structural comparison, so the variance shortcut cannot mis-answer it.

  The flag must not be written as an explicit type argument — TypeScript takes type arguments
  all-or-nothing, so `__block<A, true>` would lose the contextual `A` that the whole mechanism
  rests on. **Two emitters instead**, one per shape, the compiler picking the one the block IS.
  Measured: the slot's faults still land on the value and on the property exactly as before.

#### What is still open

Nothing in the shape.

### 8. A declaration that does nothing — layout faults inside ONE block — BUILT

**`declaration-does-nothing`, with its own page at `/style-blocks/does-nothing`.** The user's words
for the target: *"kada neko slucajno polomi layout"*.

**Two of the four this section first named were removed by measurement, and both would have been
false reports.** `z-index` on a static element WORKS when the parent is a flex or grid container,
and the parent is a different block. `width` on `display: inline` works on `<input>` (308px) and
`<button>` (300px) and not on `<span>` (39px) — it needs the tag, and a block is a value that can be
spread onto anything. Both belong to §9.

**What shipped instead is wider: ten rows.** Asking Chromium the same question of every neighbouring
property found seven more of the same shape — `top`/`inset` beside `position: static`, `float`
beside `position: absolute`, `resize` beside `overflow: visible`, `text-overflow` beside a wrapping
`white-space` or a visible `overflow`, `aspect-ratio` beside both sizes, and the whole flex/grid
container family beside a display that lays out nothing.

**And measuring the LIST is what earned the most.** Of seventeen container properties, four act on a
block container in current engines — `align-content`, `justify-items`, `place-items`,
`place-content`. Written from memory they would have been four false reports on correct CSS.

A block is ONE element's rule, so this compiler knows every declaration that lands on an element.
Ordinary CSS cannot ask that question — nothing there knows which rules reach which element — and it
is what makes these reportable at build time, with no browser and no test.

Six pairs, measured in Chromium, each differing by one word:

| | broken | fixed |
|---|---|---|
| `z-index` on `position: static` | does not stack above | stacks |
| `gap` on `display: block` | gap 0 | 12 |
| `width` on `display: inline` | width 108 (content) | 300 |
| `text-overflow: ellipsis` without `white-space: nowrap` | wraps, no ellipsis | one line, ellipsis |
| `align-self` on a block child | top 0 | 30 |
| `float` on a flex child | ignored | floats |

**The first reading of this measured the wrong thing, and it is the reason the whole item exists.**
Read through `getComputedStyle`, three of the six looked correct: the browser reports `z-index: 10`
on a static element and `width: 300px` on an inline one, having done neither. Computed is not used.
So **a test that asserts computed styles passes on all six** — the declaration is there, its value
is what the author wrote, and the browser did nothing with it. That is exactly the shape of a layout
somebody broke by accident: nothing throws, nothing is reported, and no test anyone would write
catches it.

**Scope, measured: four of the six are answerable from one block** — `z-index`+`position`,
`gap`+`display`, `width`+`display`, `ellipsis`+`white-space`+`overflow`. The other two
(`align-self`, `float`) need the PARENT's declarations, and a parent is a different block. Those
belong to item 9.

This is the family `unknown-media-feature` and `override-out-of-order` already belong to — *compiles,
ships, does nothing*. What is new is that these report a broken LAYOUT rather than broken CSS.

### 9. Across blocks — what is knowable, and what the graph would have to carry — ANALYSED, not built

Item 8 stops at one element. The question the user asked next is the harder half: *"desava se cesto
u CSS da ja nesto promenim kod roditelja i tako sredim child"* — a change to a parent whose effect
on descendants nobody looked at, in an application with more render scenarios than anyone can test.

**It is not simply "runtime".** There are three tiers, and only the last needs one:

1. **Inside one block** — fully static. Item 8.
2. **Inside one component's JSX** — the nesting is in the TypeScript AST. **But the source tree is a
   SUBSET of the runtime tree**, measured: an element passed as `children` really sits inside
   whatever its host renders around it, and the source never says so. A probe that counted source
   nesting called such an element "topmost" while at runtime it had a styled ancestor.
3. **Across components** — this is what `ComponentGraph` is for. It is component-level today:
   nodes are `component | hook | context | root | helper`, and it records **no host elements and no
   blocks**. So the parent/child style relationship is not in it, and adding it is the work.

**No snapshots.** The user ruled the shape out and gave the reason: *"na kraju svi krenu sa slepim
updateom snapshota umesto da ulaze u diff"*. Everything here stays deterministic, with nothing to
bless and nothing to keep in step.

**And a forbidding rule is the wrong instrument.** The dangerous declarations are knowable — the
inherited properties, plus the ones that establish a context (`display: flex|grid`, `position`,
`overflow`, `transform`, `contain`, `z-index`). But the user named the flaw in forbidding them
himself: *"opet je pitanje kako da znas da li je developer to hteo ili ne"*. A rule that refuses
would be wrong about intent every time.

**What answers the real problem is IMPACT, not assertion.** The complaint is not "I cannot write the
test", it is "I cannot test n scenarios". A report saying what a change reaches turns n scenarios
into the few that matter, and records nothing as an expectation — the opposite end from a snapshot.

**But the obvious form of that report was measured and it does not work.** On `apps/docs` (362
nodes, 931 edges):

| asked | answered |
|---|---|
| paths from a root to one component | **462,036** |
| what reaches `CodeBlock` from above | 286 of 362 components |
| what a change reaches below it | 284 of 331 components reach 21+ |

Everything in a real application funnels through shared shells, so "what does this touch" is very
nearly "all of it". The graph's own note already said the first row — *the graph is small, the set of
paths through it is not* — and the other two are the same fact from the other directions. A report
that names 284 components is no report.

**What may survive is narrower, and it is a CSS fact rather than a graph one.** A change to a parent
can reach a descendant by only two routes: an **inherited** property (`color`, `font`,
`line-height`, …), or a declaration that **establishes a context** (`display: flex|grid`,
`position`, `overflow`, `contain`, `transform`). A parent's `padding` reaches no descendant at all.
So the question is not *which components are below* but **which descendants declare something that
depends on what changed** — a far smaller set.

**Its size is UNMEASURED**, and cannot be measured until the graph carries blocks and elements.
Nothing should be designed on it before that number exists.

**This is a separate task, to be done WITH the checker and graph work**, at the user's instruction.
See `ramonda.graph.json` in §3, which is the same file and the same question from another side.

### 10. A combinator the formatter leaves alone — DONE 2026-09-30

**Done:** `canonicalSelector` spaces `>`, `+` and `~` at the top level of a selector, so the
formatter writes `& > span` and `non-canonical-spelling` reports `&>span`. Inside parentheses and
brackets they are left alone (`:nth-child(2n+1)`, `[class~="x"]`), and so is a sign before a number
(`+50%`, a keyframe selector — which the first version broke).

Raised by the user while reading the slot work: whether `& :hover` and `&:hover` are two spellings
of one thing, and whether the formatter should settle it.

**They are two different selectors and neither is a formatting choice.** The space is the descendant
combinator, so one is the element itself and the other is a descendant of it. Measured through the
real emitter:

    &:hover     ->  .r-\:hover-c-red:hover      the element, hovered
    & :hover    ->  .r-_\:hover-c-red :hover    a DESCENDANT, hovered
    &.active    ->  .r-\.active-c-red.active
    & .active   ->  .r-_\.active-c-red .active

The generated names differ too — `_` marks the space — so nothing downstream confuses them, and CSS
nesting itself reads the two exactly this way. Nothing to fix there.

**But the probe found a real inconsistency next door.** The formatter normalises whitespace around
the DESCENDANT combinator and does nothing about the others. Measured, running `ramonda-css format`
on one block:

    &  :hover   ->  & :hover     two spaces collapsed to one
    &>span      ->  &>span       unchanged

And the oracle disagrees with the second. Prettier's own CSS formatter, on the same selectors
written as plain nested CSS, produces `& > span`, `& + b` and `& ~ c` — spaced.

So the formatter is right about `:hover` and inconsistent about `>`, `+` and `~`. It is a small,
contained fix and it belongs with the formatter rather than with anything above.

### 11. An allow-list nothing checks against CSS — DONE 2026-09-30

**Done:** `allow-list-not-css`, a typed rule. Each LITERAL in an allow-list is compiled as a
declaration and asked of the compiler's own value rules, so it is refused exactly when it would be
in a block. Measured first, as below asked: in this repository 5 of 12 allow-list entries are
literals (`400 | 600`, `"8px" | "16px"`), so the rule reads something.

Found by the user while reading the playground demo. They changed

    "font-weight"?: 400 | 600;   ->   "font-weight"?: "notexisting";

and were right about both halves of what happened: the CALLER was refused, which makes sense, and
the component holding the slot said nothing — which they expected it to.

**Why it says nothing.** The component never writes `font-weight`. It spreads the slot and nothing
else, so there is no declaration of its own to be wrong about. The nonsense is in a TYPE, and no
rule reads a type as CSS.

**Why the entry was legal at all**, measured:

    const a: CssProperties["font-weight"] = "notexisting";   // compiles — a loose property
    const b: CssProperties["position"]    = "notexisting";   // refused — a closed keyword set

`font-weight` is one of the **677 of 832** properties typed `CssValue`, so `"notexisting"` is a
perfectly good subtype of what it accepts: the allow-list is saying *you may set `font-weight`, and
only to the literal string `notexisting`*, which is coherent and useless. Written on `position` the
allow-list itself would have been refused on the spot.

**What would close it.** The same machinery `unknown-value` already uses, pointed at a TYPE rather
than at a written declaration: a typed rule can read an allow-list's literal types and ask, for each
one, whether the property accepts that value as CSS. It is a typed rule because only the checker can
see the type — see §7 for where those live and what they cost.

**Measure first:** how many allow-list entries in a real project are literal types at all. A
constraint written as `Var<"color">` or `Token<"length">` has nothing to check, and if those are the
shapes people write, the rule would be reading a mostly empty set.

### 12. What a generated file's header should say — DONE 2026-09-30

**Done:** a second line, `/* To change it, edit ramonda.css.ts and run \`ramonda-css codegen\`. */`,
under the first, which stays exactly as it was so a search for it still finds every generated file.
The place a person meets this file is their editor, at the top — which is where the line is.

Asked by the user: is `/* Generated by @ramonda/css from ramonda.css.ts. Do not edit. */` enough,
should it say how to regenerate, and should it be wrapped in stars to stand out.

**The repo's convention is one line and no stars**, and this header already follows it. Six
generated files carry the same shape — what wrote it, what it was written from, and *Do not edit* —
and none of them says how to regenerate. Wrapping one of them in stars would make that one the odd
file rather than the visible one.

**But this one is not like the other five, and that is the argument for saying more.** The rest are
internal to this repository; `css-system/index.ts` is the only generated file that ships into
somebody ELSE's repository, committed beside their own code. The likely reader is a person who
opened it in their own project and wants to change something in it.

**What it tells that person, and what it does not.** It names `ramonda.css.ts`, which is the
important half — where to make the change. It does not name the command. The command exists and is
good, but it is only ever read after CI fails:

    [ramonda-css] 1 generated file(s) no longer match ramonda.css.ts:
      - css-system/index.ts
        Run `ramonda-css codegen` here and commit the result. Nothing was written.

So the loop closes, one failed build later than it could.

**The shape to try**, keeping the line count and the greppable phrase:

    /* Generated by @ramonda/css from ramonda.css.ts. Do not edit. */
    /* Change `ramonda.css.ts` and run `ramonda-css codegen`. */

**Measure first:** whether the header survives where people actually meet the file. A diff hides the
top of a file, an editor's outline does not show comments, and a search result is one line out of
five hundred. If the answer is *nowhere*, a longer header is a longer thing nobody reads and the
work belongs in the `settings` page instead.

### 13. A narrowed value refuses `inherit` — DECIDED: it takes them, BUILT

**The user's decision (2026-09-30): the keywords are allowed, always.** Built in the virtual file's
`__block` declaration: a narrowed value takes `inherit`, `initial`, `unset`, `revert` and
`revert-layer`, inside a state too; `!important`, another value and another property are refused
as before. Two traps measured while building it, both in `virtual.ts`'s note:

- widening EVERY value made TypeScript print `Keyword<…>` member by member on ordinary blocks, so a
  value that already takes `inherit` is handed back unchanged;
- importing `CssGlobal` from the properties module made the whole file `any` where the module lacks
  it — a typo went silent — so it is guarded, and such a module gets the five words written out.

A review of it found three more, all fixed: `any` in an allow-list was opened as if it were a state
(`width?: any` refused `width: 10px`); a NAMED type for the widening is global in a file that is a
script, so two such files were `TS2300` — it is written out level by level now, four deep; and the
same collision had been there before §13 for `$`, `declare const __vars`, now a `var`. The messages
name `CssGlobal` rather than listing its five words in front of the author's own values.

What follows is the question as it was put, kept for the reasoning.

Found while checking the claims on the new `/style-blocks/prop` page against a real project.

    type CardStyle = { color?: Token<"color"> };

    color: red       ->  TS2322  Type 'string' is not assignable to type 'Token<"color">'
    color: inherit   ->  TS2322  the same

The first is the point of the feature. The second takes away `inherit`, `initial`, `unset` and
`revert` — the CSS-wide keywords, which are what CSS itself provides rather than anything the
project decided.

**The rest of this package is careful about exactly this.** `Keyword<K>` is
`K | CssGlobal | var(…) | !important` for that reason, and `variablesOnly`'s own note says
*refusing them would be refusing what CSS itself provides*. The allow-list is the one narrowing
mechanism here that does not keep them.

**Two ways out, and the choice is the user's:**

- **Say it, and let an author opt in.** `color?: Token<"color"> | CssGlobal` is one union longer and
  it is what the page now documents. Nothing is surprising: the author wrote a type and got that
  type.
- **Keep them automatically**, the way `Keyword<K>` does — `{ color?: Token<"color"> }` would mean
  `Token<"color"> | CssGlobal`. Consistent with the rest of the package, and surprising in the other
  direction: a type that quietly admits more than it says.

Documented as the first for now, because a review is not where a design changes. **Measure before
deciding:** how often `inherit` is written into a constrained prop at all — if the honest answer is
*almost never*, the union stays a footnote and nothing needs building.

### 14. A block rebuilt every render — CLOSED by §15

**Status 2026-10-02:** neither half below was built, because §15 removed the cause: a block is a
string, equal by value, so two renders of one block are the same value whatever its `if`s chose,
and a runtime value in a declaration is refused. The two halves as they stood:

Reported by the user from the playground as `RMD020` on `Chip.labelCss`: two renders in one tick
produced values with identical contents and different identity, so the child re-renders for nothing.

**A block with no runtime value was already fine** — it is hoisted to a module constant, measured.
Two shapes are not, and they were settled separately.

#### SUPERSEDED — a block holding an `if`

    <Chip labelCss={@@( font-weight: 400; when $(this.loud) { font-weight: 600; } )} />
      ->  _merge({"font-weight":"r-fw-400",}, this.loud && {"font-weight":"r-fw-600",})

**The compiler hoists every combination and leaves only a choice in the render.** A block with `n`
conditions has `2^n` possible results, all of them known at build time and none depending on data:

    const _s0 = _merge(A);        // the condition false
    const _s1 = _merge(A, B);     // the condition true
    …  this.loud ? _s1 : _s0

Nothing is written at run time, so there is no question of when anything is deleted. A list of any
size picks from the same fixed set, so no row can displace another. Identity is stable for the life
of the module, and the values are SHARED between instances — which the user noted is a gain rather
than a cost.

**Needs a cut-off**: the count doubles per condition, so above some `n` the compiler falls back to
merging at the site. `n` is one to three in practice.

Does not apply to a block carrying a hole — see below.

#### CLOSED — a block carrying a runtime value (the hole is refused)

    @@( color: {this.brand}; )   ->   _merge({"color":["r-x", this.brand],})

The object is rebuilt because its value is the render's. Two rows with different values SHOULD be
two objects; the waste is a row re-rendering with the value it already had.

**Nothing has been agreed here.** What is shipped meanwhile is a one-slot cache in `merge`, keyed on
the class name — measured to cover a list of conditional blocks completely (20/20, two objects for
twenty rows) and to do nothing for a list where each row carries its own value (each evicts the
next; the values stay correct throughout).

#### Ruled out, and why — so none of it is proposed again

| | why it fell |
|---|---|
| the whole value as one string | the user will not have stringify and parse |
| only the VARIABLES as a string | the prop is the object, and the object is still new — the string is stable and nothing compares it |
| a keyed cache with a cap | a cap is a cliff: a list larger than it keeps NOTHING, because the second pass evicts what the first stored |
| `WeakRef` + `FinalizationRegistry` | collection time is not knowable, and unpredictable behaviour is refused |
| doing nothing | contradicts the framework's own rule about render stability |
| exempting a compiled block from `RMD020` | *"necemo da ucutkujemo framework zbog naseg loseg resenja"* |
| comparing the prop by content in `@ramonda/core` | *"mora da radi i u reactu"* — it would help one consumer only |
| the framework's per-key shallow-compare escape | refused deliberately: *"mi pravimo kompajler i zasluzujemo najbolje resenje"* |
| generations rolled over on a microtask | assumes a render pass fits in one turn, which lazy loading, deferred mounting and a child that renders only when its parent changes all break |
| an OWNER (`this`) as a `WeakMap` key | not framework-agnostic — a React function component has no stable one — and the value in a hole is any expression, not a field |

#### Where it stands

**The shape of the answer is still missing.** Per-element state has to live somewhere, and every
somewhere proposed so far has been ruled out for a reason that holds. To be continued with the user
on Tuesday, on the variables alone — the `if` half is closed.

### 15. `match`, and a block with no room for a runtime value — DONE

The user's decision, 2026-09-22, after the `RMD020` thread ran out of answers in §14: **`@@` has no
room for dynamism.** A value that varies per element is not a thing a compiled class can hold, so it
stops being written in a block at all.

Two things replace it. `match` absorbs variation that is ENUMERABLE — which is most of it, measured
by kind rather than by count: of the five holes in this repository one was a constant written as a
hole, two were two-way choices, and two were arithmetic over a small integer. `@@property` is the
door for what is left, and it already works.

**The field agrees about the mechanism and differs only about the spelling.** Tailwind puts a
literal value in the class name and a runtime one in an inline custom property, and warns against
building class names in code. vanilla-extract ships `createVar()` + `assignInlineVars()` — the same
two places, declared. StyleX wraps it in a style function and pays for it: measured in their runtime,
`styleq` sets `nextCache = null` the moment an inline value appears, abandoning its cache. All three
end at an inline custom property.

#### `match`

```
color: match $(this.variant) {
  primary   => #10b981;
  secondary => #6b7280;
  _         => inherit;
};
```

**It is a lookup table, not pattern matching.** TC39's proposal has destructuring, guards and custom
matchers; none of it is wanted, and the documentation has to say so or the name promises it.

- `=>` rather than `:`, because `:` already separates a property from its value.
- A bare word where it is an identifier or a number, quoted where it is not — the distinction CSS
  already makes between an ident and a string.
- **Arms hold literals only.** `primary => {this.x}` must be refused, or the hole is back through a
  side door.
- **Exhaustive, or `_`.** The checker can see the union. When nothing matches at run time — which a
  cast can always arrange — **no declaration applies**, which is the same answer `when $(false)`
  already gives.

**`match` and `if` do not overlap**, and the user drew the line: `if` takes any expression that comes
out true or false; `match` takes one expression with several outcomes. So a block-level `match` is
not needed to replace `if`, and is left out — it can be added later, which is the direction that
costs nothing.

**The combinations multiply rather than add** — `if` is 2, a `match` of `n` arms is `n` — but the
user is not concerned, and the reason is sound: if the value is a STRING, hoisting the combinations
is an optimisation rather than a requirement, because a string with the same contents is already
equal by value.

#### The hole goes

`{expr}` in a declaration's value is refused, and the message points at `match` and `@@property`.
`when $(cond)` and `...$(block)` keep their braces — neither injects a value, both choose between
classes.

Two measured facts argue for it beyond stability:

    padding-left: {this.v}; padding-right: {this.v};   ->  TWO variables, two classes
    padding-left: var({pad}); padding-right: var({pad}); ->  ONE variable, two classes

A hole cannot know that two declarations want one value. A declared property is one name however
many read it.

#### `CssBlock` becomes a branded string — measured

```ts
type CssBlock<A extends CssBlockShape = CssBlockShape> = string & {
  readonly [COMPILED]: true;
  readonly [ALLOWS]: A;
};
```

Every type-level power survives, checked against the real types: the allow-list still refuses a bad
VALUE and an unlisted PROPERTY on the right token; a plain `string` is refused as a block; a block
is accepted where a `string` is wanted, so `className={block}` needs nothing; `CssSpreadable` still
refuses a hand-written object. Removing the brand collapses four of those refusals, so the check is
not vacuous.

And one thing is gained: **concatenation loses the brand**, so `` `${a} ${b}` `` cannot be handed to
a block position. The merge cannot be bypassed with `+`, which today is not even expressible.

#### The order to build it in

1. ~~**`match`**~~ — **DONE.** Additive, and nothing else could land before authors had the
   replacement.
2. ~~**`@@property`'s typed setter**, plus a rule for a property read by a block and set by
   nothing.~~ — **DONE.** The binding is `CssVar<K>`, read from the `syntax` it declared, so
   `toStyle` refuses a length where an angle was asked for; `registered-never-set` is the rule.
   Measured while building it: an IMPORT of the binding is not a set. A block's reference to it is
   substituted for the generated name before the TypeScript is written, so after the transform the
   import is referenced by nothing — counting it would have meant the rule could never fire on a
   shared theme, which is the one place it is worth most.
3. ~~**Refuse the hole.**~~ — **DONE**, and it took the `holes` setting AND `StaticCssBlock` with
   it. Both were ways of saying *not here*, and a refusal nobody can get past needs no second
   spelling. `CssBlock` lost its second type parameter, the virtual file lost its second block
   helper, and every block is hoisted now.

   Two things fell out that the plan did not predict, and they are the notes for the rest:

   - **`Value<K>` and `Var<K>` lost their use site inside a block.** Both were annotations for a
     value computed in TypeScript and put in a hole. What is left for them is `toStyle` and an
     ordinary annotation; inside a block, a choice between two variables is a `match` whose arms are
     `$` paths.
   - **`match` cannot take a boolean subject.** Arm keys are emitted as string literals, so
     `match $(this.full) { true => …; }` is `"true"` against `boolean` and does not type-check. `if`
     is the answer for a boolean, and that is what the documentation says — but the rule that would
     SAY so does not exist yet.
4. ~~**A property key in every class name.**~~ — **DONE.** A class is `r-<key>-<value>`: the first
   `-` ends the key, so nothing in it may be one — a property's dashes are written `_` and the
   context joins the property with a `.`. Each half falls back on its own, and a hashed context is
   marked by a leading `0`, which nothing an author wrote can start with.

   Measured before building, on this repository's 91 declarations: a 5-character key prefix on every
   class would have cost **+40%** of the class attribute (1352 → 1898 bytes). Writing the key where
   it can be written costs **+17%** instead, and **23 of 91 names that had nothing readable in them
   now all name their property**.

   What it cost: a context holding a `-` — `[data-on]`, and every `@media (min-width: …)` — hashes
   where it used to be written. Measured: 8 of 91, and the property beside it still reads.

   **A key collision is a build failure**, in `Sheet.add`, with both texts named. Two hashed keys
   colliding would look to a merge like one thing set twice and drop the earlier rule from a page
   that renders — the one failure mode here that is silent.
5. ~~**`merge` over strings**, and `CssBlock` as the branded string.~~ — **DONE**, and the function
   is called `mergeClassNames` — see *The name it ended up with*, below.

   The clear-list question was answered by a REGISTRATION per module, measured before building: the
   whole table is 98 families, 23 KB raw and 3.7 KB gzipped — larger than the runtime — and this
   repository writes 13 of the 98. So a module registers the shorthands it writes, keyed by the
   property alone, and the runtime composes the context itself: a key is `<context><property>`, so
   `@media_print.p` clears `@media_print.pl` by putting the same context back in front. That works
   for a hashed context too, because the hash is a function of the context and is shared by every
   property sitting in it.

   **Two things the plan did not predict, both found by asking what would be LOST:**

   - **The order warning could no longer read a key's conditions.** It compares how strongly two
     conditions override, and `@media (min-width: 40rem)` hashes its context — so the warning would
     have gone silent on exactly the queries it was built for. The same registration carries the
     conditions, guarded by `process.env.NODE_ENV` so a production bundle drops it.
   - **And it named the wrong thing.** A key writes `pl` where the author wrote `padding-left`, so
     the message sent somebody looking for a string in no file. The property names are registered
     with the conditions and dropped with them.

   **The `;` rule moved with its hazard.** `toStyleObject` and the framework each refused a value
   holding one, because a `style` attribute is parsed back out of HTML on a server-rendered page and
   such a value came out applied. A block sets nothing on an element now, so `toStyle` is where a
   value reaches one, and `toStyle` is what refuses it.

   Gone with the map: `compose`, `block()`, `toStyleObject`, `StyleMap`, `StyleEntry`, `StyleBlock`,
   `HoleValues`, `StyleVarValue`, the one-slot canonical cache, `applyCssBlock` and `CSS_SYM` in
   core, `RMD062`, `RMD063`, and `scripts/check-css-contract.mjs` — there is no shape left for the
   two packages to disagree about.

6. ~~**`css` becomes sugar over `className`**, or goes.~~ — **GONE**, decided by the user.

   A block is a string, so `className` takes one and there is nothing a second prop can do. Declared
   as a MESSAGE rather than deleted, because deleting it would be silent: the element attribute type
   ends in `[val: Lowercase<string>]: any`, so a removed `css` would be `any` — the block would
   compile and its class string would be written onto the element as a `css` attribute with nothing
   to say so.

   **The gap it opened, and the measurement that found it.** Joining a block with a class of one's
   own is ordinary now, and a template literal is what anybody reaches for first — and a template
   literal is TEXT to the scan, so a block in a `${ … }` was found by NOTHING. Measured across every
   position a block can be written in:

   | | |
   |---|---|
   | attribute, assignment, call argument, object value, array element, `return`, arrow body, ternary | found |
   | **a template substitution** | **not found** |

   So `` `lead ${@@( … )}` `` compiled to silence, `@@(` survived into the bundler, and the author
   got a syntax error naming neither the block nor the line. `block-in-a-template` reports it and
   names `mergeClassNames`, which is found in a call argument like everything else.

Steps 4 to 6 are the architecture; 1 to 3 are what an author sees. Nothing after 3 is possible
before it.


### 16. A selftest's log looks like a failure — DONE

**Built:** every gate whose selftest printed its break as a failure now prints one line on stdout
when the break is caught — `scripts/lib-selftest.mjs` — with the count and the first thing found, so
a reader sees the planted break and not something else. Six gates changed: the five browser gates
and `check-changesets`; the rest already printed one line. A selftest that plants nothing still
exits 1, measured. The question as it was put:

Asked by the user reading a green CI run: the `SELFTEST=` runs print what they found — the break
they planted — in the same words as a real failure, so a green log is full of lines that read as
faults. They are assertions all the same: a selftest that finds NOTHING exits 1 and the job goes
red. But a reader should not have to know that.

**The fix:** a selftest that caught its break prints ONE line — `[split] SELFTEST=slot caught it:
3 values differ, as it should` — and the details only when it did NOT catch it. Then every detailed
difference in a log is a real one. Every gate with a `SELFTEST` mode, the same way.


### 17. A `$` variable in the cross-block check — DONE

**Built:** the virtual file hands the checker the name it bound `$` to, and the cross-block walk reads
a `$` path as a `var()` — alone, or inside a template when it is part of a value. The first checker
tests with variables declared are in `check.test.ts`: a config declaring them, and a properties
module exporting `$`, as codegen writes one. The question as it was put:

Found by the second review of `wholeAcrossBlocks` (`typed.ts`). The virtual file writes a variable
value as `__vars.border.thin`, a property access, and the walk reads only literal values — so
`...$(base); border-top: $border.thin` after a base holding `border: var(--x)` is not reported,
though the compiler makes that value a `var()` and it reaches the sheet whole. A MISSED fault, not a
false one: the merge's development warning still sees it at run time.

**What it needs:** read a `__vars` access as a `var()` value, and a checker test with variables
declared — no test in `check.test.ts` declares any yet, which is why it was left.

### 18. A `position-try` item of several words stays whole — DONE

**Built as a hand rule** in `splitByHand.ts`, from the engines rather than the grammar: every pair
of area words and every run of tactics — 3549 items — was put to all three engines, which agreed on
each one, and the rule matches them exactly. Two things the grammar gets wrong: no engine takes
`x-self-start` and its kin, and all three take `flip-x` and `flip-y`. The comma-in-the-last-longhand
path in `split.ts` went with it. The question as it was put:

Found by the fourth review, measured in all three engines. `position-try: --a, --b` splits, and so
does an item of one word; an item of two — `--a, top left`, `--a, flip-block flip-inline`,
`--b flip-block` — keeps the shorthand, though every engine takes it. Not a wrong page: the value
reaches the sheet whole, in `v`, where a longhand after it still wins. It only does not split.

**Why:** the grammar splitter reads an item of `position-try-fallbacks` word by word, and
`<dashed-ident> || <try-tactic>` and a two-word `<position-area>` are not one leaf each.

**What it needs:** read a fallback item against its own grammar (as `matchValue` can), or a hand
rule; then the values above go on `check-must-split.mjs`.


### 19. Which block gave an element its styles — BUILT 2026-10-01

**Built as agreed below**, with the two open points settled by the user: the mark is
`r:src:<path>:<line>`, and the path is from the project root. On the Vite dev server only, in any
mode it is started in — decided by Vite's `command`, after a review found `vite --mode staging`
served none when the mode's NAME decided. A build has none, in any mode, and neither has a test run
(mode `test`, or Vitest running at all), so a test comparing a whole `className` sees what ships.
Measured on a scaffolded SSR app: the server and the client carry the same marks, hydration reports
nothing, and an edit moves the line in both. Two blocks on one line share one mark — one place. `withoutSourceMarks` is the runtime helper a spread calls; it takes an absent part as the merge
does — found on the playground, where `...$(props.css)` with no prop threw.

Dev source maps point each rule at where it was written (`order.md`, "From a rule back to the line
that wrote it"). A class written in several places is one rule with several origins, so a style
panel lists all of them, and nothing in the page says which one THIS element's class came from.

**Rejected first, and why:**
- a browser extension (Chrome, Firefox) — it sees the element and its classes, and which BLOCK gave
  a class is known only while rendering; guessing from the element's component is wrong whenever a
  block arrives as a `css` prop or through `...$(base)`. Two extensions to maintain, for a guess;
- a dev-only custom property in every rule, `--r-src: "Card.tsx:14"` — it sits in the RULE, which
  is shared, so it has the same several-origins problem as the map; it inherits to every child;
- a suffix on dev class names — dev and production would carry different classes, and the merge
  reads classes, so the two could behave differently;
- a `data-style-src` attribute, as StyleX's debug mode spreads onto an element — a block here is a
  string, so the framework would have to set it; the class below needs no change to core.

**Agreed: a dev-only class that names the block, with no rule.** Each block's class string gets one
more class in development, `r:src:Card.tsx:10` (spelling to settle): file and line of the `@@`.

- It has **no CSS rule**, so it styles nothing, and it does not start with `r-`, so the merge never
  reads it as a style key — styles and winners are the same in development and production.
- It has its own **prefix the merge recognises** as a source mark.
- **A spread leaves no mark.** `const card = @@( ...$(base); … )` in `Card.tsx:10`: the element shows
  `Card.tsx:10` only. In development the compiler passes a spread's base through a helper that drops
  its source marks, and the block adds its own. What matters is where a block is USED, not where a
  piece of it came from.
- **Blocks used side by side keep all their marks.** `mergeClassNames(card, props.css)`, with
  `props.css` written in `Page.tsx:22`, shows both `Card.tsx:10` and `Page.tsx:22`: the two are
  equal, so both are shown (the user's decision).
- Production has none of it.

**Known costs:** a test comparing a whole `className` string sees the marks in development
(`toHaveClass` does not); a block whose every declaration was overridden still leaves its mark,
since the merge cannot tell a live source from a dead one; dev HTML grows by a class per block.


### The name it ended up with

`merge` was the name through all six steps. It ships as **`mergeClassNames`**, and the reason is a
collision measured after the steps were done rather than guessed at: **`@ramonda/core` exports a
`merge` of its own** — `merge(previous, next, identity?)`, the deep structural merge that keeps a
refetched row's identity.

The collision is not the loud kind. It does not arrive as a duplicate identifier, because a file
imports one or the other. It arrives as a call that means the wrong thing:

```ts
import { merge } from "@ramonda/core";   // the WRONG merge for this
const out = merge("lead", card);          // meant: a class beside a block
```

| | measured |
|---|---|
| `tsc -p` on the playground | **clean** — `previous` is `unknown`, `next` is `T`, so the call is well typed |
| at run time | returns `card`; **`"lead"` is gone**, silently |

`apps/playground-core/src/demos/panels.tsx` imports from both packages already, so that file was one
line from it.

**What was rejected.** Leaving `merge` exported and calling it internal-by-convention — considered
first, and it does not work: an export is an export, and the silent call above stays reachable
whether or not anybody is *supposed* to write it. Also rejected: keeping `merge` as a deprecated
alias, which would keep exactly the collision the rename exists to remove.

`mergeClasses` was considered and dropped — `class` means `class Component` in this framework, so it
would promise the wrong thing. The name says it merges class *names*, which after step 4 is literally
what it does.

The cost was five hand-written calls in the playground, one test file, and one string in the emitted
import, which was already aliased (`mergeClassNames as _merge`). Pre-1.0, breaking is a `minor`.

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

`index.ts` so an import writes the folder and no filename — `import { $color } from "../../css-system"`.

### `outDir`, and why it is read from the TEXT

The user asked for it to be configurable, and the reason is concrete: a project may already have a
folder called `css-system`, and a generated one landing silently beside it is worse than a key.

`propertiesFor` and `variablesSheetFor` are asked PER FILE — they run inside an editor, on every
keystroke's worth of work — so they read the key out of the config's text with a regex rather than
transpiling it. A transpile per file to close that would be the worse trade.

**The two readings are compared, and a disagreement is REFUSED.** This said the mismatch was one *a
project can see and fix*, and review pass 8 measured what a project actually sees: the files land in
one folder, everything that reads them looks in another, and the author is told

```
TS2339  Property 'size' does not exist on type
        '"Declare your variables in ramonda.css.ts, then run `ramonda-css …`"'
```

advice they have just followed. Running it again writes the same two files and changes nothing. A
comment that merely MENTIONS the key causes it, because the text reader takes the first `outDir:` in
the file. Codegen has both readings, so it compares them and refuses with both folders named.

A path that climbs out of the project, or starts at the root, is refused.

### 5. One more review, before licences and docs

Asked for by the user at the end of the session, and the reason is the session itself: seven passes
closed, and then a great deal changed after them — `css-system/`, a numeric value becoming a number
in the type, `SPEAKS_OVER_TYPES`, two completion faults, and the editor fixes before those.

Every one of those was measured, and several were found only by asking a question nobody had asked
before — what the BUILD sees against what the CHECKER sees, what a REAL project's completions offer
against what a unit harness offers. Changes made under a review deserve the same treatment as the
code the review was about.


### 6. Open after review pass 8 — a number where only keywords go — CLOSED

**Left here as the pass's own record**, because the measurement that found it is what the fix was
built on. What it discovered, sweeping values after `quoted` changed:

```
  caught   display: flexx;   overflow: scrol;   cursor: poitner;
  caught   position: 1;      float: 1;          text-align: 1;
  SILENT   display: 1;       overflow: 1;       white-space: 1;   cursor: 1;
```

Every misspelled keyword caught; a NUMBER silent, and inconsistently. The pass wrote no rule on
purpose — absence from `PRIMITIVE` means *the grammar was not reduced*, not *this takes no number* —
and named where the answer belonged: the generator, as a positive fact measured against the engines.

That is what was built. See §5 above for what the measurement decided.
### 7. Review pass 9 — what every consumer does with a config it does not like

The pass was chosen by measuring rather than by guessing. Nine files read the config; review pass 4
built its matrix against three of them — the checker, the build and the editor — and `codegen.ts`,
the third-heaviest reader, was never swept. That is how pass 8's `TypeError` got in. The consumer
list had been written down rather than derived.

So this pass derived it, and ran twelve broken configs through six consumers: `check`, `codegen`,
`codegen --check`, `explain`, a real Vite build, and the editor.

#### The one that mattered: a config that does not parse

```
export default { variables: {{{ };     →     exports.default = { variables: {} };
```

TypeScript's error RECOVERY. `transpileModule` reports nothing unless asked, and emits whatever it
managed to build — so the config LOADED: valid, empty, and nobody's. Nothing threw, nothing was
undefined, so no consumer had anything to notice. A real Vite build exited 0 and shipped

```css
.r-pl-2rem{padding-left:2rem}      units: { length: ["px"] }
.r-c-\#ff0000{color:red}           "<color>": { variablesOnly: true }
```

Only `ramonda-css check` caught it, and only because it alone type-checks the config file.

`readConfig`'s own note names this failure exactly — *a tool that quietly ran with defaults because
somebody's config had a typo would be the worst of both* — and it was true of a config that THREW
and not of one that would not parse. `reportDiagnostics: true` is the whole fix; the sentence it
produces says what the silence would have cost, because a parse error is the one fault where doing
nothing looks exactly like success.

#### Crashes, and the distinction that already existed

Three refusals in `codegen.ts` threw a raw `Error`, so a person met a Node stack trace with a
careful sentence buried in it. `cli.ts` draws the line — the author's file is SAID, a bug of ours is
thrown — and these were on the wrong side. No test saw it: a crash exits 1 and prints its message
too, so assertions on status and wording passed straight over. What separates them is the stack
frame, and that is what the new tests assert.

Every remaining raw `throw new Error` in the package was then read rather than assumed. Each one is
a bug of ours or a formatter this package has not been measured against, and says so. They are on
the right side of the same line.

#### The editor, which was silent

Returning an empty config there is right — a broken one must not take the language service down,
and measured it does not: 828 property names are still offered. It took every RULE instead, and
said nothing:

```
GOOD             [unit-not-allowed] … | [literal-not-allowed] …
a syntax error   (nothing)            828 completions, as if all were well
units: "px"      (nothing)            828 completions
… and six more, every one of them silent
```

A green file is a claim. With no config loaded the tool cannot support it, so one diagnostic sits on
the block — and only on a file that HOLDS one, because a file with no CSS in it is not affected by
the config and marking it would be noise on every file in the project.

#### Measured and left alone

`explain` answers from a config whose VARIABLES are broken, and that is correct: it reports what the
config does to one property, and a bad variable name does not change that answer. The build reports
one fault per file where the checker lists them all — deliberate, and written down where it happens:
a build stops at one anyway, and `ramonda-css check` is what enumerates.

### 8. Review pass 10 — the stylesheet in a real browser

Nine passes had asked whether the tool agrees with itself: rules against types, config against
consumers, one reader against another. The one thing none of them could find is a shared wrong
assumption — where both halves agree and both are wrong. Only an engine answers that, and measuring
it was easy to justify: the package compares its output against hand-written CSS in several tests,
but as TEXT. Nothing had ever rendered.

So: a real Vite build, the emitted stylesheet and the class list the RUNTIME produces, loaded in
headless Chromium beside hand-written CSS with the same declarations in the same order, comparing
`getComputedStyle` property by property.

#### The finding: a vendor prefix was ordered by the build, not by the sheet

`-webkit-box-shadow` and `box-shadow` are one property to the engine and two names to the model.
Both clear nothing, so both got the same breadth and the same cascade layer — and inside a layer the
sort is stable, so the winner was whichever the build emitted first:

```
-webkit-box-shadow: 0 0 1px red; box-shadow: 0 0 9px blue;   ← the same block every time

alone in the file                            blue   — what plain CSS says
after a block with the same two, reversed    RED
after a block naming only `box-shadow`       RED
after a block naming only the prefixed one   blue
```

The page depended on what another component wrote. That is worse than a divergence — it is invisible
from the block, it moves when somebody edits an unrelated file, and there is no answer to learn.

`sheetRank` puts the prefixed form first now, so the standard property wins wherever both appear and
wins identically in every build. That is also what a prefixed fallback means, and nothing that can
read this stylesheet needs one: it is built on `@layer`, and every engine with cascade layers has
the unprefixed `transform`, `box-shadow`, `user-select` and `appearance`. The other order is a
stable divergence and is REPORTED, which keeps the count in the rule above at one.

The same test found a prefixed SHORTHAND sitting in its longhands' layer: the shorthand table is
generated from unprefixed names, so `-webkit-border-radius` was recorded as clearing nothing.

#### What the browser confirmed, and it is most of it

- **26 shorthand/longhand pairs, 13 families, both orders** — every one agrees with hand-written
  CSS. The merge's clear-list settles them exactly as its note claims, and a suspicion that it did
  not was a FALSE report caught before it was made: the first probe hardcoded both classes, which
  the runtime never emits together.
- `!important` both ways, nested rules, `:not()` specificity, custom properties read after and
  before they are set, `all: unset`, inheritance — all agree.
- **All six generated `@property` registrations are accepted by Chromium**, and an invalid value
  falls back to the declared initial in every kind. That guarantee is the whole reason `$` compiles
  to a bare `var()` with no fallback, and it had never been put to an engine.

#### The method note worth keeping

The probe was wrong twice, and the CONTROL row caught it both times — once a bad `node_modules`
symlink, once a page asserting a class combination the runtime does not produce. A matrix whose
control does not pass is measuring itself.

### 9. Review pass 11 — the runtime, and a tie the bands never closed

Two halves. The runtime was the half nothing had swept; the finding came from the browser oracle
pass 10 built, pointed at the shape people actually write.

#### The finding: two conditions that can both hold

`widthSlot` ranks a breakpoint by its width and everything else by a small table of bands — and two
different conditions inside one band TIE. A tie is settled by the sheet's position, which is the
order the build happened to meet them:

```
@supports (display: grid) { color: red; } @supports (display: flex) { color: blue; }

alone in the file                     blue — what plain CSS says
interfering block in ANOTHER file     RED
interfering block in the SAME file    RED
```

Both queries hold in every browser that can read this stylesheet, so the page depended on what
another component wrote.

**The same fault is recorded twice already, and both records said it was closed.** `widthSlot`'s note
describes it for breakpoints — *the sheet fell back to the order the file happened to write them in,
which another file re-emitting one of the two then reversed; 280 of 750 load orders wrong* — and the
bands are what fixed it. Inside a band it was never fixed. And `sheet.test.ts` claimed it could not
happen at all: *within one file the author's order and the rank cannot disagree, because
`override-out-of-order` refuses the block where they would.* True where the ranks DIFFER. The rule
said nothing about a tie, and a production build puts every file's rules in one sheet where a shared
atom keeps the position of whoever claimed it first — so the per-file order that note is about never
reaches a build.

There is no order to give such a pair that is CSS's: one sheet, one position, two blocks each
wanting a different one. So it is refused, which is where this package puts a difference that cannot
be written. Conditions that EXCLUDE each other still tie and still say nothing — a colour scheme, an
orientation, a medium, which is most of what anybody writes. `exclusive` is conservative on purpose:
`@supports` asks what a browser CAN do rather than what is true now, so two of them never exclude
each other.

#### The runtime, and it is sound

- An empty hole — `undefined`, `null`, `""` — drops its declaration, and the declaration it was
  written to override with it. That looks alarming and is exactly right: measured in Chromium
  against hand-written `color: blue; color: var(--missing)`, both give the inherited colour, and
  both give `0px` for a non-inherited property. `@@` and `var()` agree.
- `false` and `NaN` reach the sheet as values. The TYPES refuse them — `TS2345: Argument of type
  'string | boolean' is not assignable to parameter of type 'CssValue'` — which is the designed
  place, since no rule can know what an expression will evaluate to.
- Two holes in one declaration drop together, because half a value is not CSS. A hole in a nested
  rule or under a `@media` drops only its own declaration. Composition with `...{}` and
  `if ({}) {}` gives later-wins in all four arrangements.
- `merge.ts`, `conditions.ts`, `token.ts`, `modules.ts`, `stale.ts` and `declared.ts` have no
  uncovered lines at all, so coverage had nothing left to point at here.

#### Two suspicions that were wrong, and how they were caught

Both were about to become findings. The empty-hole one dissolved when the hand-written control was
written — `var()` does the same thing. The other was a report that a shorthand written after a
longhand loses; the runtime clears it, and the first probe had hardcoded a class combination the
runtime never emits. **Write the control before believing the measurement.**

### 10. Review pass 12 — the dev server

Four dev-server tests existed and every one of them saves the same single source file. Two things
had never been asked here: what a save of the CONFIG does, and what two files sharing an atom do.

#### The finding: saving `ramonda.css.ts` did nothing

The hot-update hook takes files that hold a block, and a config holds none, so it returned at its
first line. Measured on a running server, both halves of what the config decides were stale and both
were silent:

```
a token changed 16px → 40px     css-system/variables.css still said 16px
units narrowed rem → px         a block writing 2rem still compiled
```

The first is the sharper one. `variables.css` is written by `buildStart` and never again, and it is
a plain stylesheet the project imports once — nothing else was ever going to regenerate it. The page
is wrong, nothing says so, and a restart is the only cure, on the file the playground's own copy
calls *here to be CHANGED*.

Codegen re-runs now and every file holding a block is invalidated. They are DROPPED from the memo
rather than recompiled in the hook, because recompiling would mean deciding what to do with one that
no longer compiles inside a hook whose errors are swallowed — which is how a fault becomes
invisible. The next transform compiles against the new config and reports at the author's own line.

A config saved half-typed is swallowed exactly as a block that does not compile is; that test passed
before the change and still does.

#### What was measured and found right

Two files naming `display: flex` are ONE rule, and the second keeps it when the first stops naming
it — through a value change and through the first losing its block altogether. Fifty saves leave a
file serving its own two rules. A file that gains its first block is picked up.

#### Two harness faults, and both looked like findings

**A fresh plugin measures nothing.** The first `saveConfig` called `ramondaCss(…).handleHotUpdate`
directly. A new instance has an empty memo, so it regenerated the stylesheet — filesystem state,
which passes — and invalidated no module — instance state, which fails. It passed the half it could
not have failed. It goes through the watcher now, so the server's own instance handles it.

**A request a browser cannot make.** A file gaining its first block measured as *the JavaScript
names a class the stylesheet does not define*, which is precisely the fault the first test in that
file exists for. The transform appends `import "<absolute path>?ramonda-css.css"`, so a client
learns that URL only by reading the JavaScript; asking for it first hits `load` with an id Vite has
not resolved, creates the module empty, and Vite caches that. Tracing `load` is what settled it.

That is the third false report in three passes, and all three were caught the same way: by building
the control rather than trusting the measurement.

#### And what the leak test does not say

It asserts what a file SERVES. Breaking the sheet's withdraw loop instead leaves dead entries in its
`rules` map while every file still serves the right CSS — so it does not bound memory. Written into
the test rather than left for its name to imply.

### 11. Review pass 13 — the esbuild adapter

Every earlier pass measured Vite. This package ships two bundler adapters and they are one rule with
two consumers, which is the arrangement this repository keeps finding a fault in — so the pass was
one question asked twice: *does esbuild do what Vite does, given the same input?*

#### The finding: it did not know which build it was running

A config may be written `env.production ? ["px"] : ["px", "rem"]`, and that dependence is the whole
reason it is TypeScript rather than JSON. Vite is handed its mode and passes it on. The esbuild
adapter read `NODE_ENV` alone and said why — *esbuild is not told which build this is*. It is told,
twice:

```
config   units: env.production ? ["px"] : ["px", "rem"]
block    padding-left: 2rem

vite,    --mode production, NODE_ENV unset    refused
esbuild, minify: true,      NODE_ENV unset    BUILT — `2rem` went in
```

`environmentOf` in `config.ts` records this exact failure and calls it fixed — *it silently took the
development branch of every such config, in production builds included*. Fixed for Vite; this
consumer was left behind.

`define: { "process.env.NODE_ENV": … }` decides it first, because that is a STATEMENT — esbuild
rewrites it into the bundle, so a project setting it has said which build this is out loud, and
somebody minifying a development build has to be able to say so or the escape hatch is not one.
`minify` next, an inference but a strong one. `NODE_ENV` last.

**The asymmetry settles the order of the last two.** Reading a build as production when it is not
gives stricter rules than the author wanted, which arrives as a refusal they can see and argue with.
Reading it as development when it is not ships the loose half, silently, to real users.

#### What the two adapters agree about, measured

The same source built both ways: **every class identical**, across a plain block, a nested rule, a
`@media`, a shorthand pair, a hole, a `$` variable, a `@@keyframes` and a vendor-prefixed pair. The
stylesheets hold the same twelve rules in the same twelve layers and differ only in minification.

All ten broken configs from review pass 9's matrix are refused here too, each naming the config
file, none crashing. Those fixes live in `config.ts`, so they reached this consumer for free — which
is the argument for where they were put, and the reason the adapters agree about everything except
the one thing each was asked separately.

#### One flake, unreproduced, written down rather than guessed at

`pnpm check` went red once during this pass, in `grammar.test.ts`, with a crash inside shiki's own
tokenizer — `TypeError: Cannot read properties of undefined (reading 'startIndex')` in
`_tokenizeWithTheme`. Nothing to do with the change under review.

It did not reproduce: the file alone three times, the failing test alone five times, the whole
package's suite, and `pnpm check` a second time — all green. The two highlighters are built once in
`beforeAll` and shared by all sixty-nine tests, which is the shape a load-dependent fault takes, and
it is the same shape the dev-server harness already records for chokidar.

**Not fixed, because it was not understood.** A repair aimed at a cause nobody has measured is the
mistake that harness note records making once already: *the first repair was a longer wait, which is
what one reaches for when the cause is a guess. It made the window smaller and left the race.* If it
returns, the thing to measure first is whether shiki's registry is safe to share across tests at all.

### 12. `match` takes a STRING subject — DECIDED, both halves

**Status 2026-10-05: CLOSED, by the user.** A number subject was measured to be fully buildable —
the run time already compares `String(subject)`, and keys checked against the subject's SPELLING
(`` `${S}` ``) made `1 | 2`, `-1`, `0.5` and a boolean all work, with the "trap" below not arising.
It was turned down anyway, for the reason that decides it: *kada napisemo true, da li je to boolean
ili string "true"?* An arm's key is a written word, and a reader cannot tell whether `1 =>` is the
number or its spelling. So `match` takes a string; anything else is refused ON THE SUBJECT, once,
saying what to write — `$(on) ? a : b` for a boolean, a word made in code for a number. The keys
are then taken as any string, so the refusal is not repeated per key. The build is unchanged: it
does not run the type check, and the run time still compares spellings.

The rest of this section is the history that led there.


**Status 2026-10-02:** a boolean subject is an `if`, and `composing.md` says so (*A boolean subject is
an `if`*). A NUMBER subject is still refused with a raw `TS2322` that names neither `match` nor the
fix — the open half, below.

Asked while the splitter work was running: *"da li nasa match funkcija prima samo string? nekada je
potrebno da imamo true / false slucaj"*. It does, and it is not only booleans.

Measured through the real checker, a block on a plain `const` so no JSX types are in the way:

```
string literal union    "hot" | "cold"      quiet
plain string            string              quiet
number literal union    1 | 2               TS2322: Type 'string' is not assignable to type '2 | 1'
number                  number              TS2322
boolean                 boolean             TS2322: Type 'string' is not assignable to type 'boolean'
```

The transform is happy with all of them — `match $(this.loud) { true => red; false => blue; }`
compiles and emits `r-c-red` and `r-c-blue`. It is the TYPE that refuses, and the cause is one line
in `virtual.ts`:

```js
derived(JSON.stringify(arm.key), arm.at, arm.length);
```

An arm's key is always written into the virtual file as a STRING literal, so against a `boolean` or
a `number` subject it can never match.

**The message is the worse half.** A reader gets a raw `TS2322` about `string` and `boolean`, which
says nothing about `match` having a constraint — it reads as a fault in their own type.

**The obvious repair has a trap.** Writing the key unquoted when it is `true`, `false` or numeric
makes those subjects work — and breaks an arm key of `1` on a string subject (`"1" | "2"`), because
the virtual file does not know the subject's type and cannot decide from the key alone. The way out
is for the constraint in `properties.ts` to accept a literal OR its string spelling, which is a
change to `lookup` and wants its own measurement.

**What authors do today**, undocumented: put the ternary in the SUBJECT, where a hole is an ordinary
expression.

```tsx
match $(this.loud ? "on" : "off") { on => red; off => blue; }
```

So the ternary is available after all, just not in the arm. That is a workaround rather than a
design, and it is written nowhere a reader would find it.

### 13. A logical longhand and a physical one share a layer — MEASURED, shipped, not fixed

Found while checking whether splitting needs a group clear. `padding-inline-start` and
`padding-left` set the same used value, neither covers the other, so both cover 0 properties and
both land in `ramonda.u17`. Measured in Chromium, one class each, same layer:

```
inline-start then left   10px
left then inline-start    2px
```

The load order decides, which is the one thing the layers exist to stop. Every logical/physical pair
is like this — `margin-block-start` against `margin-top`, and so on down the box model.

**Splitting does not fix it**, so it is not the splitter's to carry: there is no breadth to order by
when neither property covers the other.

**And CSS gives no answer either.** In a hand-written stylesheet the later declaration wins, and
that is all the specification says. Ramonda cannot preserve the author's order across files — inside
one block it could, but two blocks merged on one element have no order between them.

So it wants a decision rather than a repair: pick one side to win, always, and say so. The
measurement above is what a choice has to beat.

### 20. A variable read in CODE pulls its whole group into the bundle — MEASURED, READY, not started

**Status 2026-10-05: agreed with the user, parked behind higher priorities.** Start here when the
queue is empty. Everything below was measured; nothing is built. Branch from `main`.

#### The fault

`import { $color } from "../css-system"` and one read, `$color.accent.quiet`, ships the whole `$color`
object — every variable in the group — because a bundler cannot drop unused properties of an object.
Blocks pay nothing: the compiler already writes a block's `$color.x` as the plain `var(--…)`. Only
TypeScript code that imports a group pays, once per app, for each group it imports.

Measured with esbuild `--minify`, one variable read, against the same value written inline (42 B):

```
variables in the group    import, raw / gzip
20                        818 B / 204 B
100                       3.7 KB / 409 B
500                       18.7 KB / 1.5 KB
```

Linear: about **37 B raw, 3 B gzip per variable** in an imported group. 10 variables cost nothing
worth naming; 1000 in one group cost ~37 KB raw / ~3 KB gzip.

#### The fix that was agreed — no new syntax

**At BUILD time, the bundler plugin replaces every read of a whole leaf path with its value**:
`$color.accent.quiet` → `"var(--color-accent-quiet)"`. The import is then unused and the bundler
drops the module. The spelling in code stays the spelling in a block, and the types do not change
— TypeScript still sees the import.

**Rejected: `@@getVar("$color.accent.quiet")`**, the user's first idea. Two spellings for one thing
(the `$` was just made the config's spelling so there is ONE), a path in a string that needs its
own type support to be checked and completed, and a new construct to learn — to save what the
replacement saves without any of that.

#### Measured, so it does not need measuring again

- **The import really goes.** Every read replaced, the module unused: esbuild AND Vite (Rollup) both
  drop it completely — 18.7 KB → 0 for 500 variables, 42 B output either way. **No `/* @__PURE__ */`
  is needed** in the generated module; both treat `Object.freeze` as pure. (Probed both with and
  without the annotation: identical.)
- **Parsing is cheap.** `ts.createSourceFile` costs ~0.55 ms per file (225 files, 1.5 MB of this
  repository's sources, 124 ms). A text pre-check — does the file mention a declared group's name,
  `$color`, at all — costs 0.7 ms for all 225 together and let 4 through. Pre-check on the GROUP
  NAMES, not on `css-system`: `outDir` is configurable and an import may go through a path alias.
- **No app in this repository reads a group in code today** — only types are imported from
  `css-system`. So nothing here exercises it; the tests have to.

#### What to replace, and what to leave

| Written in code | Do |
|---|---|
| `$color.accent.quiet` — a whole leaf path | replace |
| `$color["accent"]["quiet"]` — literal brackets | replace |
| `import { $color as c }` → `c.accent.quiet` | replace, through the import binding |
| `import * as sys` → `sys.$color.accent.quiet` | replace |
| `$color.accent` — a sub-group, or `Object.keys($color)`, or `$color` passed whole | leave; the import stays and works as today |
| `$color` reached through a re-export in another file | leave; same |
| a file that ALSO declares a local named like a group (`const $color`, a parameter) | skip the whole file — no scope analysis, be conservative |
| a path the config does not declare | leave; the type check already reports it |

Leaving is always safe: the code is exactly what it was, and pays exactly today's cost.

#### How to build it

1. **Where:** `vite.ts` (`transform`) and `esbuild.ts` (`onLoad`), BUILD only — `production`, not the
   dev server; the value is identical in both, so dev gains nothing and keeps simpler maps. One
   shared function in a new file, e.g. `compiler/inlineVariables.ts`:
   `inlineVariables(code, file, config) → { code, map } | undefined`.
2. **Which files:** every TS/TSX/JS file outside `node_modules` — NOT only `fileMayHoldABlock`
   ones; a file that reads `$color` usually has no block. Pre-check the text for any declared group
   name first (`declaredByName` / `namesIn` give the groups), and parse only if it passes.
3. **Find the bindings:** import declarations whose specifier RESOLVES to the generated module
   (`<config dir>/<outDir>/index.ts` — `variablesSheetFor` shows how the sheet's path is found; the
   module is beside it). Named imports of `$group` (with aliases) and namespace imports.
4. **Replace:** property-access / literal-element-access chains on those bindings that end exactly
   on a declared leaf (`namesIn(...).path`), with `JSON.stringify(\`var(${name})\`)`.
5. **Source map:** the text changes length, so return a real map (the block transform already
   returns one — compose the same way). A file with no replacement returns `undefined`/`null`.
6. **A file also holding blocks:** run after the block transform on its output, or fold into it —
   decide by which keeps one map simpler.
7. **Config edits:** a changed `ramonda.css.ts` must re-run it, as it already does for blocks.

#### Tests it needs (each seen to fail once on purpose)

- each "replace" row above, through a real `vite build` and a real esbuild build: the output holds
  `var(--color-accent-quiet)` and NOT the other variables of the group (pick a distinctive one);
- each "leave" row: the build still works and the value is right at run time;
- shadowing: a file with `const $color = …` is untouched;
- a source map still points a later line at the author's own line;
- the dev server does not do it.

#### Done when

A production bundle that reads one variable in code ships that variable's string and none of its
group's others, in both bundlers; every shape left alone behaves exactly as today; the gate is
green; a changeset (`patch`) and one sentence on `variables.md` (reading a variable in code costs
nothing after a build) say so.

## A published package meets an application — the cascade across a version boundary

**Measured 2026-09-23, in Chromium, against real stylesheets from the real `Sheet`. NOT built.**

The vite plugin skips `node_modules` (`recompile` and `transform` in `vite.ts`), so a library that uses
`@ramonda/css` ships its own compiled CSS and two stylesheets meet in one document. That is the only
place any of this bites: inside one project, every measurement agrees with hand-written CSS in both
write orders.

### The fault

A layer name is global to the document, and the name is an INDEX into `BREADTHS` — a list derived
from the generated shorthand table (18 distinct counts today: `559 53 25 21 20 16 15 12 11 10 8 7 6
5 4 3 2 0`, with gaps at 9, 13, 14). A CSS release that changes how many DISTINCT counts exist
renumbers everything below the change.

Worse, the two statements then differ in LENGTH. CSS fixes the order on the first statement it sees
and can only APPEND an unseen name to the END, past `ramonda.c`. Measured, one version apart:

```
same version, library first        blue   ok
same version, app first            blue   ok
one version apart, library first   RED    wrong
one version apart, app first       blue   ok
```

Concretely: a `Button` whose block carries `@media (min-width: 40rem) { padding-left: 20px }` loses
to an application's unconditional `padding-left: 4px`, and the media query never runs. Nothing
reports it, and which stylesheet loads first is the bundler's choice.

### What the layers are for, and why this cannot be dodged

Measured against hand-written CSS, both directions agree:

```
padding then padding-left   hand-written 4px    ramonda 4px
padding-left then padding   hand-written 10px   ramonda 10px
```

Write order is settled by `mergeClassNames` (a later shorthand CLEARS its longhands); the LAYER is
consulted only when both classes survive. So the layer is not a new rule — it is what keeps CSS's
own answer from depending on which file the bundler put first.

Panda CSS has no version-skew problem because its five names (`reset, base, tokens, recipes,
utilities`) are semantic and never grow — but it cannot order a shorthand against a longhand at all,
calls that a *known limitation*, and ships a `prefer-longhand-properties` lint rule instead. StyleX
avoids it the other way: the application transforms every StyleX package in `node_modules`, so there
is one table. Nobody else derives layer names from a generated CSS table, which is why nobody else
has this problem.

Splitting every shorthand into longhands would remove the need for breadth layers — measured, the
merge alone then answers both directions. **First estimated as not scaling, and that estimate was
wrong**: counting a faithful expansion put `padding` at 4 classes, `border` at 17 and `font` at 20
(199 B of class attribute), because a shorthand RESETS everything it covers. It does not have to
emit that — the reset is already `mergeClassNames`'s job — so with the group clear `font` is 5
classes and `background: red` is one. See the section below, which supersedes this paragraph;
`lightningcss` not expanding shorthands is the only part of it that held.

### ~~The decision: a self-describing marker, and the application remaps~~ — SUPERSEDED

**Nothing remaps anything, because nothing drifts.** A layer is named by how many longhands a
shorthand covers, which is a fact about that property and not a position in a table, so two releases
write the same name for it without being told. The marker existed to let an application rewrite a
foreign stylesheet's numbering; with no numbering to disagree about, there is nothing to rewrite.
Verified in three engines, both load orders, by `scripts/check-layer-skew.mjs`.

Kept as the record of what the question looked like before splitting answered most of it.

#### What the marker was

The package's CSS passes through the application's bundler when the application imports it, and the
plugin already has a `transform` hook. So the emitted CSS carries what its layer names MEAN:

```css
/*! ramonda-css breadths=559,53,25,21,20,16,15,12,11,10,8,7,6,5,4,3,2,0 */
@layer ramonda.u00,…,ramonda.u17,ramonda.c;
```

~50 bytes. On a foreign stylesheet whose marker does not match, the plugin rewrites the layer names
into the application's own numbering, and the bundle carries ONE numbering. Skew cannot survive.

**A marker carrying the MEANING rather than a version number**, because a version number needs a
history of every past table — and a package built by a NEWER `@ramonda/css` than the application is
a history the application does not have. The breadth list translates in both directions with no
lookup.

Two limits, both accepted:

- **The CSS must pass through the application's build.** An `import` does; a `<link>` to a CDN does
  not.
- **A package published before the marker exists does not carry one.** The plugin can only assume
  the current table and say so. This is a reason to ship the marker before anyone publishes.

### For the `<link>` case: name the layer by what it COVERS

Where no remap can happen, the name must not be a position. Measured over 1068 covering pairs: if
`S` covers `L` then `count(S) > count(L)` in EVERY version, because `S` covers what `L` covers plus
`L` itself. All 1068 hold but six, and those six are aliases (`gap`/`grid-gap`,
`-webkit-border-before`/`border-block-start`, `-webkit-mask-position`/`mask-position`) — one property
under two names, to be treated as one.

So the name becomes the count, over a fully pre-declared descending range, which every version emits
identically:

```css
@layer ramonda.u1023,ramonda.u1022,…,ramonda.u0001,ramonda.u0000;
```

`1024` names cost 2152 B gzipped, once per page (esbuild merges identical layer blocks); 560 cost
1156 B. Measured against a five-year-old package, both load orders, both directions, with the counts
drifted: all correct.

**The residual flaw, measured:** the tightest margin is 2, across 86 pairs — `background-position`
(2) over `background-position-x` (0). It breaks only if a LEAF gains two sub-properties while an old
package stays frozen. Today's scheme breaks on the first change to the set of distinct counts, and
takes every family with it; this one takes only the family that moved.

**The shift is a NESTED LAYER, not a smaller number** — and the first draft of this said otherwise.
Scaling the name by 1000 so a shift has somewhere to go is unaffordable, because the room has to be
DECLARED: every integer a shift can land on must already be in every statement. Measured, gzipped,
one statement:

```
scale    names        gzip
    1     1024       2156 B
    4     4096       9283 B
    8     8192      19334 B
   16    16384      38716 B
 1000  1024000      ~14 MB raw — not possible
```

A nested layer needs no room at all. Measured: a sublayer sits after the layer declared before its
parent and before its parent's own rules, in either load order. So the shift moves the new
assignment INSIDE the next-stronger declared name, the top-level statement never changes, and the
range stays the dense 1024 names at 2156 B:

```
no shift            u0002           the count's own layer
one step stronger   u0001 > s       inside the next-stronger name
one step weaker     u0002 > s       inside its own — the direction control
```

**A second shift cannot nest deeper**, and that is the edge case the first write-up only gestured
at. Measured: `u0001 > s > s` is WEAKER than `u0001 > s`, because a sublayer loses to its parent's
own rules — so depth buys nothing. Each shift consumes a STRONGER NAME instead, and a property at
count 2 has exactly two of them, `u0001` and `u0000`:

```
1st shift   u0001 > s   beats u0002       ok
2nd shift   u0000 > s   beats u0001 > s   ok
deeper      u0001 > s > s                 WEAKER — no
2nd shift still loses to the leaves in u0000   ok
```

So each layer declares a fixed set of SUBLAYER names inside itself, from day one — the same trick
one level down, and about twenty bytes in the layers that carry rules:

```css
@layer u0001 { @layer s0,s1,s2,s3; @layer s0 { … } }
```

The budget becomes stronger-names × sublayers: eight for the tightest property with four, twenty
with ten. Measured, all of it in both load orders — siblings order among themselves, a sublayer
beats an old package's rule in the next-weaker name, and it still loses to its own parent's rules.

**An old package that never heard of the inner statement is unaffected**, which is the row that
matters: its rule sits directly in the layer, and a layer's own rules outrank every sublayer of it.

When the breadth table changes, the whole new assignment moves one place toward the STRONGER end.

`prototype-package-skew.mjs` holds all of it, in Chromium, on stylesheets from the real `Sheet`
with only the layer NAMES rewritten — the scheme is not built, so the probe models the naming and
the controls carry the weight:

```
control · today, table unchanged        4px / 4px     ok
control · proposed, table unchanged     4px / 4px     ok
event A · today                         10px / 4px    breaks
event A · proposed                      4px / 4px     ok
event C · proposed, newcomer must LOSE  4px / 4px     ok
event B · proposed, no shift            4px / 10px    breaks
event B · proposed, shift stronger      4px / 4px     ok
event B · proposed, shift weaker        10px / 10px   breaks
```

**Event A and event B are not the same event and do not break on the same pair.** A is the set of
distinct breadths changing, which changes the statement's LENGTH — the appended name lands past
`ramonda.c`, so the pair has to straddle `c`: a conditional rule against an unconditional one.
Measured, a shorthand/longhand pair under event A is correct by luck. B is a leaf growing to its own
shorthand's old count, which needs the shorthand/longhand pair.

**Event C is what makes the pre-declared range load-bearing**, and it was missing from the first
draft: cutting the range from 1024 names to four left every other row passing. Appending an unseen
name puts it at the STRONGEST position, so it only does damage where the newcomer was meant to be
WEAK — every other pair here wants the newer half to win and is rescued by the very thing that is
supposed to be the fault. C swaps the sides: the package holds the longhand, the application a
shorthand whose count the old table did not have.

Two modelling errors the probe caught, both of which would have read as the scheme working: handing
one naming to both sides passes the application's shift to the frozen package; and a subset
statement is invisible while both sides emit the same one.

The old package holds `background-position` at 2000; the new world puts `background-position-x` at
1999, which outranks it, and the old package's own leaf at 0 still outranks the new
`background-position` at 3999. Relative order inside each version is untouched, and everything new
clears everything old that it has to. The direction is "toward stronger", which with a descending
statement (largest count declared first) is minus one; flipping the scale would make it literally
plus one. At a scale of 1000 that is a thousand shifts per unit.

### Shift only when it is needed, and let a gate say when — BUILT

`scripts/check-layer-names.mjs`, in `pnpm check` and in CI, with the counts as of the last release
committed beside it in `packages/css/layer-counts.json`. Three checks, each with a selftest of its
own:

```
covers   inside ONE version: a shorthand is weaker than everything it covers
across   and against the recorded release, BOTH directions — which stylesheet is the older
         one is not ours to decide
range    at most one family past the end of the range, because everything past it shares `a`
```

Today: 143 covering pairs, no violation, and the tightest margin is 4 — `grid` at 7 over
`grid-template` at 3. **Splitting is what widened them.** The prototype below measured the tightest
margin at 2 across 86 pairs, when every longhand had a count of its own; a longhand has none now, so
it left the comparison entirely and only shorthand-over-shorthand remains.

**A selftest that passes for the wrong reason says nothing.** All three passed on the first writing
and all three were caught by `covers`, because widening a narrow family's count breaks that
invariant at the same time — `drift` never reached the cross-version check and `crowd` never reached
the range one. Each finding carries the name of the check that made it now, and a selftest fails
unless its OWN check is the one that fired. `drift` had to be written against the recorded snapshot
rather than the current table for the same reason: editing the current one answers at `covers` first.

### ~~Shift only when it is needed, and let a gate say when~~ — the prototype it was built from

Shifting on every table change is the rule with nothing to remember, and at a scale of 1000 it lasts
about a century. It is also unnecessary: a collision needs a LEAF to grow to exactly the count its
own shorthand used to have, which is a much rarer event than the table changing.

So the shift happens only when a gate says it must, and the gate is what makes that safe — it does
not assume a shift was enough, it checks.

The rule it checks, for every covering pair `S ⊃ L`, against a past table:

```
name_new(L) < name_old(S)      a new longhand still outranks an old shorthand
name_old(L) < name_new(S)      and an old longhand still outranks a new one
```

Both directions, because which stylesheet is the old one is not ours to decide.

Prototyped against the current table, with the event synthesised — `background-position-x` grown
into a shorthand over two sub-properties:

```
control   same table, shift 0:   0 collisions
event     shift 0:               1  background-position-x(new 2000)
                                    does not outrank background-position(old 2000)
event     shift 1:               0  safe
```

The control is the part that matters: with an unchanged table the gate must be silent, or it says
nothing when it fires. **Aliases have to be excluded first** — `gap`/`grid-gap` and the three
`-webkit-` pairs each cover the other, so no ordering can separate them and they produced twelve
collisions against an unchanged table until they were taken out.

What the gate needs:

- **an append-only history of COUNTS**, one entry per release that changed the table. Only the
  counts, not the tables: which property covers which can come from today's, because that relation
  only grows. About a hundred numbers per entry;
- **a comparison against every past entry**, not only the previous one — a package on the page may
  have been built by any release;
- **the current shift, in the source.** When the gate fails, raise it until the gate is clean and
  append the new entry.

Its honest limit: it protects against releases it has an entry for, so the history has to start with
today's table.

So the rule is: **the table may change freely; the gate says when the assignment must shift, and by
how much.**

### Who owns the assignment, and whether a shift ever goes away

`@ramonda/css` owns it, in its own source: a file mapping a property to its layer path, alongside
the generated breadth table. Nobody outside the package writes a layer name — not an application,
not the author of a published package, not someone loading a stylesheet with a `<link>`. Each of
them gets whatever assignment the release they compiled against carried.

**A shift is permanent.** It is a property of the assignment rather than of any one package, so
rebuilding a package emits the same path it did before, and the assignment accumulates nesting over
time. That is a real cost, and a small one: a level is a few bytes, and a shift only happens when
the gate says it must.

The remap does NOT collapse it, and saying otherwise would be the easy mistake. An application
cannot know whether some stylesheet on the page arrived outside its build, so it has to assume one
did: it emits the current assignment, shifts and all, and rewrites foreign sheets into that. What
the remap buys is that the shifts are never CONSULTED across a version boundary in a bundle — not
that they are gone.

### The way out: split every shorthand, and the cascade is never asked

All of the above is arithmetic on layer names, and every variant of it has a residual because a
name or an assignment can drift. There is one move that removes the question instead of answering
it: **if every declaration a block emits is a LONGHAND, no two classes on an element ever set the
same property.** `mergeClassNames` then settles every conflict by key, at runtime, and the cascade
is never consulted — so nothing has to agree across a version boundary.

Measured against hand-written CSS, all six in one layer with no ordering at all:

```
font-weight then font            ISTO   2 classes, 20 B
font then font-weight            ISTO   3 classes, 30 B
background-size then background  ISTO   1 class,    9 B
background then background-size  ISTO   2 classes, 21 B
padding-left then padding        ISTO   4 classes, 39 B
padding then padding-left        ISTO   4 classes, 38 B
```

**A shorthand does not have to expand into everything it resets**, which is where the cost was
first mis-estimated at twenty classes and 199 B for a `font`. The resetting is already
`mergeClassNames`'s job — `shorthands()` knows the family — so only what the author WROTE needs a
class, provided the merge is told the classes arrived as a group. That is a small addition to the
emitted code, not a new mechanism. Faithfully the engine gives 19 longhands for
`font: italic bold 12px/1.5 Arial`; fourteen of them are `normal`/`none`/`auto`, and drop out.

Measured through the engines' own expansion (`element.style`, which gives SPECIFIED values, so no
resolution creeps in):

```
                        faithful   with group clearing
padding: 10px 20px          4             4
grid: "a b" 1fr … / …       6             3
background: … , red         9             6
font: italic bold …        19             5
```

Multi-layer `background` splits cleanly — the commas become lists in each longhand and the second
layer takes `initial`. `grid`'s area templates carry across as a value.

#### The splitter, taught and checked by the engines

`prototype-expand-positional.mjs` builds one for the positional families and verifies it against
Chromium, Firefox and WebKit. Nothing about the rule is written in it: each family is fed distinct
sentinels **per arity**, and whichever longhand comes back holding sentinel *i* is position *i*; one
holding something that is no sentinel has a constant there. Learning per arity is what made the
awkward shapes need no special case — `border-radius`'s `/` pairs the two sides, and
`background-position: 1px` is `x: 1px, y: center` rather than a repeat.

```
94 shorthands, 3 engines
chromium 27   firefox 25   webkit 28
in all three: 25 families, 3545 values checked
```

The corpus is the point, and it found three rules that are about CSS rather than about a family,
plus one bug in the probe itself:

- splitting on every space tore `rgb(1, 1, 1)` into three values. Top-level whitespace only. The
  oracle caught it before a line of the real thing existed;
- a CSS-WIDE KEYWORD alone (`inherit`, `initial`, `unset`, `revert`) is not positional — it goes on
  every longhand. `background-position: inherit` inherits BOTH axes;
- one of those keywords beside another value is invalid CSS, so there is nothing to split;
- **a `var()` in a shorthand cannot be split at all.**

#### `var()`, and the one thing that makes it splittable anyway

The variable's content is unknown until computed-value time and may carry several values. Measured:
`border-color: var(--c)` with `--c: red blue` gives the engine red/blue/red/blue, while putting
`var(--c)` on each longhand gives four invalid declarations and a black border.

But a REGISTERED custom property is a different thing, and this is a guarantee from the browser
rather than a convention. Measured, identical in all three engines:

```
registered <length>, one value     shorthand and split AGREE
registered <length>, TWO values    AGREE — the registration refuses it, both fall back
syntax: "*", two values            DISAGREE
unregistered var(), two values     DISAGREE
```

So: **a shorthand holding a `var()` is splittable exactly when every variable in it is registered
with a single-value `syntax`.** Codegen already emits an `@property` per declared variable, with the
`syntax` taken from its kind — and thirteen of the fifteen kinds are single-valued. Only `any`
(`*`) and `transform-list` are not, and the compiler knows which is which from its own config.

What stays unsplittable: a raw `var()` into a name this compiler did not declare, and the two
list-valued kinds. Those declarations keep their shorthand, and the cascade decides for them alone —
so the layers do not disappear, but what depends on them shrinks from every family to a few
declarations.

#### Five shapes, and every family that expands

`prototype-expand.mjs` learns four, tried in order, and verifies all of them the same way:

```
94 shorthands, 3 engines
chromium 89   firefox 74   webkit 81

covered in every engine that HAS it   89 families, 8763 values checked
present and covered in all three      73
properties not every engine has       16
learned but WRONG                      0
no shape learned                       0
no expansion in this engine            4

positional (53)        padding, margin, inset, overflow, border-radius,
                       border-width/color/style, background-position, mask-position,
                       grid-area/column/row, place-content, place-items, place-self,
                       overscroll-behavior, container, font-variant, marker,
                       the whole corner-*-shape branch, scroll-*, every logical variant
by signature (26)      the whole border branch, border-image, mask-border, outline,
                       column-rule, list-style, text-decoration, offset, flex-flow,
                       text-emphasis, text-wrap, white-space, text-box, font, grid,
                       grid-template
by signature, order (1) flex
comma list (8)         animation, transition, background, mask, position-try,
                       scroll-timeline, view-timeline, timeline-trigger
flags (1)              font-synthesis
```

**FLAGS is the fifth shape, and every other learner was blind to it by construction.**
`font-synthesis: weight style` turns two longhands on and leaves the third off. The keyword is not a
value the longhand can hold — `font-synthesis-weight` takes `auto` and `none` — and all four shapes
above ask exactly one question, *which longhand HOLDS this token*, so all four drew a blank.

What identifies the pair is naming both at once: whatever a longhand is when every keyword is
written is its ON value, and a token owns the longhand that reaches it with this token and not with
the others. A longhand that matches under every token is owned by none of them —
`font-synthesis-small-caps` has no probe word here — and stays off.

**A pair of groups is the unit, not a group.** A group learned on its own cannot answer for a value
holding another group too, and the last two stragglers failed on exactly that: `flex: 3px 7` is
grow 7 and basis 3px, while `flex: 7 7` is grow 7, shrink 7 and basis `0%` — the same number group,
a different answer, because of what sits beside it. `offset: url(a.png) 3px` puts the length on the
DISTANCE where `offset: 3px` puts it on the position. Groups are two to five per family, so every
ordered pair is a handful of probes and each is the engine's own answer for that combination.

And a longhand's value is recorded TOKEN BY TOKEN, because it can hold a slot and a constant side by
side: `offset: 3px url(a.png)` gives `offset-position: 3px center`, the written length and a keyword
the family supplies. All-or-nothing made it a literal, so `9px url(a.png)` emitted the probe's own
`3px center`.

**"Covered in all three" was the wrong bar**, and finding that out is worth more than the number it
gave. `corner-shape` is Chromium-only today, so asking every engine to agree about it refuses a
family two of them have never heard of — a bar nothing can clear rather than a fault found. Absence
is not disagreement: the question is whether a family is covered in every engine that HAS it, and
16 of the 94 are not in all three.

The other half of the jump was the probe's own vocabulary. Four keyword domains — alignment
(`start`, `end`, `stretch`…), corner shapes (`round`, `bevel`, `scoop`…), white-space and
vertical-align — brought in `place-content`, `place-items`, `container`, `font-variant` and the
eleven `corner-*-shape` families. They were never a grammar of their own; they were positional over
keyword sets nothing here offered.

**A group's shape is learned PER ARITY**, and the tokens are grouped before any is placed. Walking
one at a time cannot see how many of a group there are, and the answer depends on it: `flex: 7` and
`flex: 7 7` put the basis at `0%` while `flex: 3px` leaves the grow at `1`. Grouping first also
gives a longhand that consumes SEVERAL tokens — `offset: 3px 3px` is one position, not a position
and a distance — and it settles `animation: ease-in ease-in` with no rule of its own, because the
arity-two probe already watched the engine make the second one a name.

**A slash is not always one value split in half.** `border-radius: 1px / 2px` is a horizontal and a
vertical radius; `grid-area: 1 / 2 / 3 / 4` is four independent slots. So a pattern is the length of
every slash-separated SIDE rather than a flag, and its key is written the way the value is — `2/2`,
`1/1/1/1`.

And the patterns decide which DOMAIN a family takes, not only how it is taught. Asking whether a
family accepts two values side by side read `grid-column` as having no positional shape at all: it
takes `1 / 3` and refuses `1 3`, so the single probe that chose the domain was the one probe it
could never pass. Trying every pattern brought `grid-area`, `grid-column` and `grid-row` in, and
`overscroll-behavior` and `place-self` came with them.

**BY SIGNATURE** is `border: 1px solid red` — which longhand a token goes to depends on WHAT it is
rather than where it sits, and where a type has several slots (`flex: 1 1 0`) their order finishes
the job. **COMMA LIST** is one shape applied per layer and zipped back:
split on top-level commas, run the per-layer splitter on each, join each longhand's answers with a
comma — except the one longhand that is shared rather than per-layer, which the engine identifies
by holding a single part where the others hold two.

Neither needs a component grammar written here, and that is the point: the classifier is the ENGINE.
A token fed to the family alone lands on exactly the longhands its type owns, so splitting is
per-token solo expansion, merged. The real compiler would classify from its own keyword tables; this
measures whether the DECOMPOSITION is sound, which is the question worth answering first.

#### Every family needs an exhaustive test, and that is not optional

A splitter that is wrong changes a style silently, in a project that never touched the code. There
is no symptom to notice and no gate that would see it — so the corpus IS the feature, and a family
is not done when its splitter is written but when its corpus is.

What makes that affordable rather than punishing: **the oracle is free and exact.** `element.style`
expands a shorthand in the engine itself, and comparing the COMPUTED result of the shorthand against
the computed result of our longhands, on two elements, answers for any value worth trying — in three
engines, before anything ships. The cost is writing the values down, not deciding what is right.

Six bugs it has already caught, every one of which would have read as the splitter working:

- splitting on every space tore `rgb(1, 1, 1)` into three values;
- comparing SPECIFIED text called every normalisation a failure — `0` against `0px`, `#abc` against
  `rgb(170, 187, 204)` — and buried the one real finding under a hundred false ones;
- classifying a token against a baseline that already held a value put `border: 3px rgb(1, 2, 3)`'s
  colour into the width slot;
- taking the reset from a probe's leftovers left `animation: 7` with a `dashed` in `animation-name`;
- a slot cannot be seen from ONE token: `animation: 1.5s` sets the duration and leaves the delay at
  zero, so `1.5s 1.5s` lost its delay until the shape was learned from `1.5s 2.5s` instead;
- `initial, initial` is not valid CSS, so a keyword reset collapses inside a comma list — but the
  computed initial is not the reset either (`border-top-width` is `medium`, not the `0px` it
  computes to with no style), and writing that one put every border width at zero and took the
  whole border branch from 13 families to 2. The keyword stays, and is resolved only where a list
  is joined.

So the standard for a family: every arity it accepts, every type its grammar admits in every order,
the CSS-wide keywords, a `var()`, and the values that are valid CSS and unusual — `calc()`, `min()`,
`env()`, percentages, zero, negatives. Checked in Chromium, Firefox and WebKit, because they
disagree: 49, 48 and 51 families pass today, and only 47 pass in all three.

#### The vocabulary of types was the bottleneck, and it is gone

`background` and `mask` need two things the other shapes do not: a SLASH inside a layer (position in
front, size behind), and PER-ARITY CONSTANTS for a type's unfilled slots — `background: 3px` leaves
`background-position-y` at `center`, not at its initial value.

Adding the constants fixed `mask` and took `animation` and `transition` out. Restricting them to
families whose types were disjoint put those back and dropped `mask` again. The two excluded each
other, and that is what a wrong abstraction looks like from the inside:

> **The probe's vocabulary of TYPES conflated things that are not the same.** `dashed` is a line
> style to `border` and a NAME to `animation`. A constant learned through one is a constant for
> neither, and no special case repairs a vocabulary that is wrong per family.

So nothing is named any more. **Two tokens are the same type when they address the same SET of
longhands**, and that set is its own name. Signatures partition by construction, so the overlap that
forced the choice cannot arise, and the classifier used at split time is the same function that did
the learning — there is no table in between to be wrong.

```
                    families in all three   background
named types                    49           84 of 141 wrong
signatures                     50            passes, and so do animation,
                                             transition, mask and column-rule
```

Three bugs stood between the rewrite and that, and each is a rule about CSS that no per-group
mapping can hold:

- **a slot that is another group's SIGNATURE is not this group's to take.** The pair probe writes
  two tokens of one group side by side, and the family may read the second as something else
  entirely: `animation: ease-in ease-out` is valid, and the engine makes the second one a NAME. The
  easing group claimed `animation-name` with a constant of `none`, so the first easing in any value
  wiped a name already placed — `animation: dashed ease-in` came out nameless;
- **a token takes the FIRST free slot that accepts it**, in the order the family declares its
  longhands. `animation: ease-in ease-in` is an easing and then a NAME — the same word twice,
  meaning two different things — and no mapping can say that, because the token's type depends on
  what is still unfilled;
- **a SHARED longhand is invisible in a probe that does not touch it.** `background-color` comes
  from the last layer only, but `background: 3px, 9px` leaves it at `initial`, which reads exactly
  like an untouched per-layer longhand — so `3px, rgb(1, 2, 3)` joined the colour into
  `rgba(0, 0, 0, 0), rgb(1, 2, 3)`, which is not a colour. Every type pair that parses has to be
  probed — and MIXED pairs as well as same-type ones, because a colour is legal only in the last
  layer, so no `colour, colour` probe is valid CSS and none of them ever touched it;
- **a token matches a sentinel as WRITTEN or as the engine reports it, and both halves cost a
  bug.** Matching only through the longhand misses any longhand holding SEVERAL tokens —
  `offset-position: 3px` comes back `3px center`, so `offset: 3px 3px` split into the probe's own
  sentinels, `3px 9px`. Matching only the raw text misses a normalised one — `url(a.png)` comes
  back `url("a.png")`, so `mask: 3px url(b.png)` emitted `url("a.png")`, a different file;
- **a literal that COMPUTES to the untouched value is that probe's reset, not the group's
  constant.** Keeping them let the last group processed clobber the rest: `mask: 3px url(a.png)`
  lost the `center` the length had just put on the y axis.

**Shapes are tried in turn and the first that SURVIVES its corpus wins**, which is not the same as
the first that can be learned. `position-try` is where that shows: the positional learner claims it
because the alignment sentinels happen to parse, and then gets it wrong — `position-try: normal
start` is an order and a fallback, not two values of one thing. It changed no number today, because
that family has no second candidate either; it is here so the next one does not have to be found
the same way.

**Some components cannot stand alone, and probing every token by itself hid three families.**
`scroll-timeline: block` is refused where `scroll-timeline: --one block` is not, because the name is
required; `position-try: normal` is refused where `position-try: normal --fallback` is not. So a
token the family will not take alone is probed beside a CARRIER — the first probe token it does
take. And the family's list of longhands is read through that carrier too: `scroll-timeline`'s
first group is the axis, so the list came back empty and a family with two perfectly good groups was
reported as having no shape at all.

**A token matches a sentinel as WRITTEN or as the engine reports it — and that one rule had to be
put in FOUR separate places**, each time after a family had already been lost to its absence. The
combination learner (`mask: 3px url(b.png)` emitting `url("a.png")`, a different file), the
per-arity learner, the DOMAIN test (`marker: url(a.png)` comes back `url("a.png")`, so the image
domain was judged not to fit and `marker` had no shape at all) and the positional learner's own
slot mapping (`marker: none` emitting the probe's own file). The fourth was hiding behind a
parameter named `held`, shadowing the helper of that name that would have fixed it.

**And nine more came in from the classifier's vocabulary, not from a new shape.** The signature
learner needs two groups in a family before it can say anything, and for `flex-flow`,
`text-emphasis`, `text-wrap` and `white-space` none of the value types ever parsed. Keyword groups
— directions, wrapping, edges, synthesis, emphasis — were all they needed.

#### What is not done

Nothing, within this probe's reach. Every family that expands in an engine is split correctly in
every engine that has it, verified over 8763 values. What remains is not a shape:

**Four never expand in this engine at all** — `all`, `perspective-origin`, `transform-origin`,
`vertical-align`. They are in the shorthand table because SOME engine resets longhands through them.

**Sixteen are not in all three engines**, `corner-*-shape` and `animation-range` among them, so
"covered in all three" is 73 rather than 89. Absence is not disagreement.

#### The classifier cannot come from the tables, and that is not a gap

`prototype-expand.mjs` asks the engine at split time which longhand a token belongs to, and a
compiler has no browser. `prototype-classify-from-tables.mjs` asks whether `KEYWORDS` and
`PRIMITIVE` could answer instead, over every (family, token) pair the engine classifies:

```
the tables agree              63
the tables say something else 45
the tables say nothing       296
```

**63 of 404.** And the 296 are not a table that needs filling: `KEYWORDS` holds only properties
whose grammar is CLOSED, which is exactly right for its own job of reporting a wrong word —
`animation-name` takes a free identifier and can never have a list. The 45 are the other half of the
same fact: `1.5s` matches `animation-duration` and `animation-delay` by primitive, and nothing in a
type says which comes first.

So the learned mapping has to become a generated table of its own, written the way
`build-shorthand-leaves.mjs` writes its one — ask the engines ONCE, when the table is built, and
ship the answer. That is the same method this package already uses for what a shorthand resets, and
it is why the prototype learning from the engines rather than from a written rule was worth the
trouble: the learning IS the generator.

#### REPLACED: split every family, from the published grammar

The plan below — split the positional families and leave the rest — was built, measured and then
rejected by the user on a reading that is correct and worth keeping: *"nesto razbijamo, nesto ne. ko
ce to da pokapira kada otvori devtools. Samo smo ukomplikovali a nismo resili inicijalni problem
layera."* Half is worse than either end. The output stops being a rule and becomes a list of
exceptions, and the problem the whole exercise started from — the breadth layers and what they cost
across a package boundary — shrinks from 94 families to 43 instead of going away.

**What makes all of it reachable is a question asked late and worth asking first:** *"kako to CSS
radi i on mora da zna kako da cita shorthand, zar ne?"* It does, and the answer is published. Every
shorthand has a grammar, and `mdn-data` carries it:

```
border:      <line-width> || <line-style> || <color>
animation:   <single-animation>#
flex:        none | [ <'flex-grow'> <'flex-shrink'>? || <'flex-basis'> ]
```

`||` is "in any order", which IS the type dispatch the prototype spent a day learning from the
engines. And the longhands carry their own grammars, so a component resolves to a longhand by
matching them:

```
border-top-width:  <line-width>      ← what `<line-width>` in `border` means
border-top-style:  <line-style>
border-top-color:  <color>
```

Measured over the 43 families the positional table does not reach:

```
27   the grammar names its longhands directly, as <'border-top-width'>
16   it uses a named type — <single-animation>#, <bg-layer>#?
      and every one of those types IS defined, resolving to the same shape
 0   no grammar at all
```

The named types carry the two things that looked hardest:

```
single-animation:  <'animation-duration'> || <easing-function> || <'animation-delay'> || …
bg-layer:          <bg-image> || <bg-position> [ / <bg-size> ]? || <repeat-style> || …
```

The ORDER of two slots of one type — `animation: 1s 2s` is duration then delay, and both are
`<time>` — and the SLASH structure are both written there. Those are exactly the two shapes the
prototype had to discover by differencing probes.

##### The final state, in full — CORRECTED: it is not two layers

**This said two layers, and it was wrong.** It rested on *after splitting every unconditional
declaration is a LONGHAND*, which the measurement does not support: 33 families have no shape and
reach the sheet whole — `background`, `font`, `grid`, `animation`, `mask` among them — and a family
that DOES split still arrives as a shorthand whenever the split is refused, for a hole, a `var()` or
an arm of a `match`.

Measured, the difference matters. A package writing `background: red` and an application writing
`background-color: blue`, in two stylesheets, all three engines agreeing:

```
one layer for both    app's sheet first     RED — the package's shorthand won
                      package's first       blue
                      the answer depends on which file the bundler put first
two layers            either order          blue
```

That is the package-skew fault the layers exist to prevent, so a shorthand needs a layer of its own
for as long as any family goes unsplit.

**What it is instead:**

```css
@layer ramonda.i, ramonda.a, ramonda.s64, …, ramonda.s01, ramonda.v, ramonda.d8, …, ramonda.d1, ramonda.u, ramonda.c;
```

```
ramonda.a      `all` — it covers every property, so it is weaker than every shorthand there can be
ramonda.s##    a shorthand, named by HOW MANY longhands it covers; weakest (widest) first
ramonda.v      a shorthand holding a `var()`, which can never split — a word, so it never moves
ramonda.d#     a longhand a SPLIT produced, by how many splits it came through
ramonda.u      a longhand somebody TYPED — one name, because every longhand is equally narrow
ramonda.c      every conditional rule, with the digit layers inside it
```

##### The plan: every layer a word, and `s##` deleted — AGREED 2026-09-28, DONE 2026-09-29

**Done, and what changed on the way.** Every shorthand splits but `all` (its own word, `a`) and
`-webkit-mask`, which is refused: WebKit keeps `mask-clip`, `mask-composite` and `mask-mode` where
Chromium and Firefox reset them, so the line renders two ways before anything here touches it.
`v` holds every shorthand that reaches the sheet WHOLE — a `var()`, or a value a split refuses, like
`font: caption` — and the rule is `narrower-after-a-whole-shorthand`. The pieces' layer is `p`,
alone: `d1`…`d8` held seven empty names in reserve, and the guarantee is a test (every split reaches
leaves), not room. `layer-counts.json` and `check-layer-names.mjs` are gone with the counts. The
statement is `i, a, v, p, u, c`, plus the breakpoint digits under `c`.

The text below is the plan as agreed, kept for its reasoning.

The goal was agreed on 2026-09-24: split every shorthand, with no compromise. A word layer means the
same thing in every version, including through a `<link>` from a CDN. A count moves whenever CSS
adds a longhand to a family (`animation` went 11 → 12). So `s##` is not the strategy. It holds what
does not split YET, and it is deleted once nothing lands in it. That has to happen before 1.0.

**When a layer decides at all.** The merge removes an earlier class that a later one covers. A layer
decides only when the merge keeps BOTH classes on one element. For a shorthand that cannot split,
such as `border: var(--x)`, there are three cases:

```
border: var(--x);        then border-top-color: red   both stay; the longhand must win
border: 1px solid red;   then border: var(--x)        merge removes the first; no conflict
border: var(--x);        then border-top: var(--y)    both stay; the NARROWER must win
```

**The plan:**

1. A shorthand whose value holds `var()` or a hole goes into ONE word layer, `ramonda.v`. It is
   declared weaker than `d1…d8` and `u`. That settles the first case, and the name never moves.
2. Two unsplittable shorthands where the narrower comes later (the third case) is an ERROR: "set
   these longhands on their own". It is the only case that would still need a count, so it is not
   allowed. It is reported at compile time inside a block, by the checker across blocks it can see,
   and by `compose` in development for the rest.
3. Everything else splits:
   - the families that do not split yet: 11 that do not open, 8 rejected, `mask`, and the
     `container` slash form (see `CONTRIBUTING.md`);
   - `match` arms, which are known values and are refused today only because nothing splits them.
4. The breadth inside the `c` path (`b${breadth}`) is a count too, and goes the same way.
5. Then the statement is words only: `i, a, v, d1…d8, u, c`. `s##`, `layer-counts.json` and the
   "moved" check in `check-layer-names` are deleted.

**Optional, and not needed for correctness:** a config switch `shorthands: "never"`, enforced by the
types, for projects that want only longhands. The default stays: shorthands are supported.

**Measured 2026-09-29, and two holes found that the plan did not name.** Through the merge, the
three cases above hold as expected: with `v`, only the third follows sheet order. But a package
built by an OLDER release broke three ways, all engines, with or without `v`:

```
A1  app border-top-color, then an old package's border: var(--x)   the longhand survived
A2  app text-decoration-thickness, then an old split of text-decoration   survived
B1  an old package's overflow (a longhand then), then the app's split overflow   the old class won
```

The merge knew only what the OLD module registered. Fixed in two steps, both built: the runtime
carries what every shorthand clears (`clears.generated.ts`, 3.2 KB gzipped — the runtime on a page is
the application's, the newest release present), and a split puts its family's key in front of its
pieces as a class with no rule (`markerFor`), so the merge clears the family before they land.
Merge time measured the same within noise, 13.9 µs against 14.4.

**Measure BEFORE building.** Everything above is reasoned from what the merge does. The first step is
the three cases in all three engines, against the same lines written by hand. If a case
disagrees, the plan changes.

##### `!important` reads the order backwards, and that was wrong for as long as there were layers

Not about splitting, not about packages, not about joining. The ordinary path, one block, one file,
measured in all three engines against the same two lines written by hand:

```
@@( background: red !important; background-color: blue !important; )
ours red, hand-written CSS blue
```

CSS reverses layer order for important declarations — among them the layer declared FIRST wins — so
every important rule left in its ordinary layer came out backwards. A shorthand against its own
longhand, `all` against a shorthand, a `@media` against the unconditional rule it was written to
override, two breakpoints against each other: every boundary, every time.

**What kept it hidden** is that a split against a written longhand AGREES. Splitting gives those two
one key, so `mergeClassNames` settles them before a layer is asked — the same reason they agree
everywhere else. The pairs that disagree are exactly the ones the merge cannot resolve, which is a
smaller set than it sounds and was not in the four cases `flatten.ts` said had been measured.

**The answer is a MIRROR.** An important declaration goes under `ramonda.i`, whose every level is
declared in the reverse order, so the reversal lands on the order that was meant. Where `i` sits
among the others does not matter: importance beats non-importance whatever the layer, so nothing
ordinary is ever compared with anything under it. The subtree is emitted only where an important
declaration exists.

Two things the fix got wrong first, both found by measuring: the level below `i` was given the value
meaning *the top level, already declared*, so nothing inside `i` declared its own names; and `c` was
left out of the mirrored list, so a conditional rule sat in a name its level never declared, was
appended — and under the reversal an appended name is the WEAKEST, which made a `@media` lose to the
rule it came to override.

##### Why a split needs a shelf of its own, and why the room beside it ships now

Asked what happens to *a longhand beats its shorthand* once `padding` is four longhand classes. Through
the merge, nothing: measured in both orders, before and after, the answer is the same and follows
what the author wrote — which is what CSS does, `.k { padding-left: 8px; padding: 10px }` giving
10px in a browser.

One place changed. Two groups of classes joined into a STRING never meet in `mergeClassNames`, so
nothing knows which was written later and the stylesheet decides alone. Before splitting the layer
settled it whatever the load order; after, both were `padding-left` in one shelf and the answer
followed whichever file the bundler put first — 40px one way and 8px the other.

**A layer name cannot be added later, and that is the measurement that shapes the rest.** A
stylesheet built before the name existed does not list it, and CSS appends an unseen name to the END
of the order, which is the strongest position. Two sheets one release apart: the newer one's derived
rules BEAT the older one's written longhands, the exact reverse of what the name means. So every
name this scheme may want ships with the first release that has any of it — eight derived levels
cost 22 gzipped bytes over none.

`d1` is all anything produces. A split always reaches LEAVES: `border` is three levels, and the
engine expands it straight to `border-top-color` and never to `border-width`, because the longhand
list is the engine's. A test asserts the consequence rather than the reason.

**Two alternatives measured and rejected.** Naming the derived shelf by the shorthand's COUNT brings
back exactly the drift this scheme removes — a package built when `padding` covered 10 beat an
application built when it covered 11, in both load orders. Giving derived rules zero specificity
with `:where()` closes the hole and makes them lose to any class the author writes, which a written
`padding` should not.

**And the priority cannot live in the CLASS NAME**, which is worth writing down because it is the
first thing anyone proposes. `padding-left: 8px; padding: 10px` and the reverse need OPPOSITE
answers from the same two classes. What decides is where a declaration was written, and that is not
a fact about the class — it is a fact about the position, which only the merge holds and only where
the merge runs.

**The name is the COUNT, never a position.** That is the whole of why it cannot drift: a position in
the table of distinct breadths moved `padding` from `u09` to `u10` when CSS added a property
anywhere, and took every family below it along. A count moves only when that property's own count
moves. Measured over 1068 covering pairs: if `S` covers `L` then `count(S) > count(L)` in every
version, the six exceptions all being aliases.

**Why the range stops at 64, and what `all` has to do with it.** Every count a shorthand may ever
have must already be in the statement an earlier release emitted, so the range is a declared cost.
`all` clears 559 properties today and gains one with every property CSS adds; giving it a count
would mean pre-declaring 560 names. It needs none — it covers everything, so one fixed word says it
is the weakest. That leaves `mask` at 25 as the widest real count, and 64 gives every family room to
more than double:

```
names      gzipped, once per page
   18      91 B      what this scheme replaces
   32      114 B
   64      168 B     <- this
  560      1158 B
 1024      2158 B
```

**It is still seventeen shelves fewer.** Eighteen breadth names became one `ramonda.u`, because
after splitting there is no wide unconditional declaration left to separate. What remains named is
the shorthands, and they are named by a fact about themselves rather than by where they sit in a
list.

Verified end to end through the real `Sheet` and the real `mergeClassNames`, in Chromium, Firefox
and WebKit, both load orders: 24 of 24.

**And for a family that SPLITS, the layer decides nothing at all.** Both declarations are longhands
with the same key, so `mergeClassNames` settles it before the browser sees a class — the element
never carries two:

```
merge(package, app)   r-pt-8px r-pr-8px r-pb-8px r-pl-40px
merge(app, package)   r-pt-8px r-pr-8px r-pb-8px r-pl-8px
```

The outcome follows the composition order the author wrote, and not which stylesheet loaded first.
A probe that put both classes on the element by hand reported this as a failure, and the probe was
wrong: the system never does that.

**Why the numbers go.** Today a shelf's number says how BROAD a declaration is, so that a narrow one
beats a wide one — `padding` at 9, `padding-left` at 17. After splitting there is no wide one left:
every declaration is a longhand, every longhand is equally narrow, so every declaration would take
the same number. A number that is the same for everybody separates nobody, and seventeen of the
eighteen shelves stand empty forever. They are deleted and the one that is left needs no number.

It is three states, not two, and eliding the middle one is what made this hard to read the first
time it was written down:

```
1. today              eighteen shelves, declarations spread across them
2. after splitting    still eighteen, but everything lands in the last one; seventeen are empty
3. after the cleanup  the empty ones are gone and the survivor is `ramonda.u`
```

##### What the cascade is still asked, and what it is not

```
same property, unconditional      the MERGE, by key — the later one written wins
different properties              nothing to decide; they do not touch
conditional against unconditional `c` comes after `u` in the statement
two breakpoints                   the digits inside `c`
```

The cascade decides only the last two rows. Everything above them is settled in JavaScript, before
the browser sees a class.

**A `match` needs no layer either.** Every arm compiles to its own class and the render picks one,
so an element carries at most one of them — and a `match` on `padding-left` beside a plain
`padding-left` is two declarations with ONE key, which the merge resolves like any other pair. The
same holds for anything written beside them: a different property does not collide, and the same
property is the merge's to answer.

##### What to build

1. **a resolver for the notation** — `<'name'>`, `<type>`, `||`, `[ ]`, `?`, `#`, `/`, and one level
   of indirection through `mdn.css.syntaxes`;
2. **a classification from it** — component to longhand, the order where two slots share a type, and
   which side of a slash a component sits on;
3. **verification against the engines**, over the corpus that already exists. This is not a
   formality: `mdn-data` is the file this repository has already measured lying, and
   `build-shorthand-leaves.mjs` exists because its `initial` field was missing 37 longhands after
   two hand-patches. Take the grammar, then check it;
4. **one generated table**, replacing `shapes.generated.ts` rather than sitting beside it;
5. **the compiler splits every family that verified**, and no others.

##### What it gives

```
every declaration is a longhand         so no two classes set the same property
one unconditional layer, not eighteen   nothing to name, nothing to drift
no marker, no remap, no shift           they answered a question that is gone
`ramonda.c` and the digits stay         for `@media`, and neither comes from the table
```

And the package-skew problem disappears for every family rather than for 51 of them: two builds a
decade apart agree, because there is nothing left in the unconditional path to disagree about.

##### What survives from the branch that built the half

The generator's shape, the merge rule (intersection, because a wrong mapping is silent where a
missing one is loud), the corpus, the gate, the splitter in `flatten.ts`, and the finding that a
shape must be verified inside the generator rather than by a gate beside it. What goes is the
scope: positional only.

##### The recogniser, and the one family the engines cannot agree about

`longhandsFor` answers _component → longhand_. Splitting a written value needs the other direction —
_token → component_ — and that cannot be a lookup, because the tokens are not enumerable. It is a
PREDICATE, derived from the same published grammar: `acceptedBy` resolves a component down to the
words, primitive types and functions it takes, following named types through each other and stopping
on a primitive. `<line-style>` comes back as ten words and no type; `<line-width>` as three words
plus `length`; `<keyframes-name>` as no words at all, only `custom-ident` — which is why `isOpen`
exists and why such a component is asked LAST, after every closed grammar has said no.

Measured over all 80 families mdn-data gives a grammar for, none of which the reader failed to
parse, the components of a family divide like this:

```
59  every component distinguishable by word alone
16  two components take the same WORD
 3  two components take the same primitive TYPE
 2  a component is open — anything is a candidate
```

##### The longhand list is the ENGINE's, because mdn-data's is wrong

The clash list sent the first version of this to the engines, and what came back was not about the
clashes at all. `border-block-end` split into `border-top-width`, `border-top-style` and
`border-top-color` — physical properties, for a logical shorthand. That came straight from
`mdn.css.properties["border-block-end"].computed`, which records exactly those three.
`border-block-start` is worse: `["border-width", "border-style", "border-block-start-color"]`, two
shorthands and one logical longhand in one list.

The engines answer it directly. A shorthand set to `inherit` — legal for every property — expands in
`element.style`, and iterating the declaration lists precisely the longhands it wrote. Asked that
way, all three agree, and they disagree with mdn-data for **18 of 77 families**. `background` comes
back with `background-position-x` and `-y` rather than `background-position`, and `border-block`
flattens to all six. So: the grammar is read from mdn-data, the longhand list is measured. This is
the third time in this branch that mdn-data has been the wrong oracle for something the browser
knows — see `mdn-data-is-not-the-oracle`.

##### What the mechanism covers, and the boundary that is not arbitrary

A value is a BAG OF TOKENS only when the grammar is flat — no comma, no slash, no repetition. Each
token goes to the first slot still empty that accepts it, in three passes: an exact WORD, then a
closed slot by primitive, then an open one. The order of those three is load-bearing.
`list-style-type` is open (it takes a `custom-ident`), so without the word pass first, `list-style:
none` walks past it and lands in `list-style-image`. Longhands no token reached are written
`initial`, which is what a shorthand does to them and needs no table of initial values.

Measured over the flat families, corpus built from each slot's own vocabulary, compared as computed
values against the shorthand on a second element in all three engines:

```
19 families   186 values   186 agree   0 disagree
```

Fifteen families are excluded and each exclusion is a fact, not a gap: `animation`, `background`,
`mask`, `transition`, `grid-area`, `offset`, `scroll-timeline`, `view-timeline`, `border-image`,
`mask-border`, `font`, `grid`, `grid-template`, `timeline-trigger` have a comma, a slash or a
repetition in their grammar, and `columns` is held out by a guard that refuses a family whose slots
claim the same longhand twice — which is how the three-slot reading of a two-component grammar was
caught instead of shipped. Those families keep the conditional layer. They are the next piece of
work, not a hole in this one.

##### Two things the build found that reading the grammar would not have

**The longhand list has an ORDER, and the engines disagree about it.** The merge compares printed
shapes, so `border`, `border-block`, `border-inline`, `outline` and `text-decoration` were all
dropped as disagreements although every engine named the same longhands: Chromium lists `border`
starting at colour, Firefox at width. The order carries nothing — the list only says which longhands
get `initial` when no token reached them — so it is sorted before the comparison, and all nineteen
agree. A comparison by printed form will find differences that are not differences, and the fix is
to make the form canonical rather than to loosen the comparison.

**A guard that decided nothing was deleted, not documented.** The middle pass originally skipped an
open slot, so a closed one could claim a token first. Broken on purpose, every test still passed —
and measured across the whole table, no open slot can win that pass at all: `custom-ident` and
`string` are the only primitives one has, and neither is ever what a token resolves to. The guard
was removed. A family that later brings an open slot with a real primitive is caught by the
generator, which refuses any family it cannot reproduce in all three engines.

##### The one thing that looked like a divergence and was not

Set `list-style: none`, and Chromium writes `list-style-type` alone while Firefox and WebKit write
`list-style-type` AND `list-style-image`. That was recorded here as a genuine three-engine
disagreement needing a refusal. It is not one. `none` is `list-style-image`'s initial value, so the
computed result is identical in all three, and the corpus above — which contains `none` three times
— passes everywhere. The specified value a browser chooses to record is not the thing being
matched; the computed value is. A divergence has to be shown in what the page RENDERS before it is
allowed to shrink the design.

#### The splitter is WIRED IN, and widening one comparison found nine bad rows

The two tables were built and verified and nothing read them: `splitPositional` was called only by
its tests and its gate. Wiring it in is what the whole design is for, and it moved the ground twice.

##### The checker must see what the AUTHOR wrote

The split went into `flatten` first, and `flatten` has exactly one caller: the checker. The emit path
goes through `segments`. So every diagnostic started naming a property nobody had written — `display:
block; gap: 12px` reported twice, about `row-gap` and `column-gap`, on a line that says `gap`.

Splitting is now an option of `segments`, off by default:

```
flatten(block)                     what the author wrote   → the checker
segments(block, { split: true })   the longhands           → the stylesheet
```

The measurement that says the boundary is in the right place: after the move, all 925 of
`rules.test.ts` pass with **no change to any rule**. Had the checker genuinely needed to learn about
splitting, some of them would still be failing.

##### What the compiler refuses to split, and why each refusal is its own

```
a HOLE              `padding: ${gap}` is a value that does not exist yet, and at this point it is a
                    marker in the text rather than a `var()` — the splitter's own guard cannot see
                    it, so `flatten.ts` makes this refusal itself
a `match` ARM       one class, picked at run time. Three longhands per arm made three, and the
                    compiler's own invariant fired: `a block produced 7 piece(s) for 1 hole(s)`.
                    An arm picking SEVERAL classes is worth doing and is not this change
a `var()`           what is inside it is unknown until the browser reads it
a comma or a slash  the token shape does not describe either
a NEGATIVE length   where the family refuses one — see below
```

##### Comparing the WHOLE computed style dropped nine families

Both generators and the gate compared only the longhands the mapping names, which asks whether the
values went where we meant them to — not whether the page is the same. Widened to the whole computed
style, the positional table fell from 51 families to 42, and every row that left was one that had
never been checked at all. Four separate places read silence as agreement:

```
`if (longhands.length === 0) continue`   an engine that does not expand the shorthand skipped the
                                         value, and `sound` stayed true
`saw` = the engines that KEPT a row      an engine that REJECTED it was not counted as disagreeing
verification over `learned` only         a row only ONE engine learns, the others never check
the accumulate rule                      a row nobody rejects survives for ever
```

`transform-origin-x` and `perspective-origin-x` exist **only in WebKit**; `-webkit-border-*-spacing`
is missing from Firefox. Splitting there writes declarations the engine drops, so the origin is never
set at all — and the one engine that has them was the only one checking. The generator now runs in
TWO passes: every engine learns, then every engine answers for everything any of them learned.

##### CSS drops the whole declaration; a split drops only the part

`padding: 10px -5px` leaves no padding at all, because a negative padding is invalid and CSS refuses
the declaration entire. Four longhands would leave 10px on top and bottom — an author's mistake that
stops doing nothing and starts doing half of something.

Where it is cheaply measurable it is refused: the generator asks each family whether it takes a
negative length (all three engines agree exactly — `margin`, `inset` and `scroll-margin` do;
`padding`, `gap`, `border-radius`, `scroll-padding` do not) and `splitPositional` refuses a value
holding one. The check is per TOKEN and not over the text, because over the text it refused
`calc(4px - 9px)`, whose `- 9` is a subtraction inside a call — found by the test written to describe
the boundary rather than to catch anything.

Where it is not cheaply measurable, the family leaves the table: `scroll-margin: 10px 10%`,
`place-items: start space-between` and `contain-intrinsic-size: 0 10%` are all the same fault with a
different invalid value, and answering them needs a per-property value validator that does not exist
here. A family that cannot be split is not a hole in the design; it keeps its shorthand.

##### What it gives, measured rather than argued

`padding: 8px` emits no `shorthands()` registration at all any more — the runtime clear machinery was
not made cleverer, it was made unnecessary, and what keeps it alive is the families no table can
answer. Across modules, a base's `padding-left` is overridden by a modifier's `padding` because the
merge settles it by KEY; nothing consults a registration.

#### ~~DECIDED: the splitter is adopted, in a pull request of its own~~ — superseded by the above

Taken 2026-09-24. What it costs is recorded beside it and neither half was measured, because
neither is a measurement: the class attribute grows — `padding: 10px` becomes four classes, and
every element carrying it pays that in every SSR page — and the docs, the checker's messages and
the reader pages all describe a block as compiling to one class per declaration.

**It does NOT remove the layers, and this note first said something too comfortable about why.**
The claim was that the conditional structure does not move between versions because it is not
derived from the shorthand table. Read out of `layerPathFor`, it is:

```js
const breadth = BREADTHS.indexOf(breadthOf(declaration));
if (slot === 0) return [`u${breadth}`];
return ["c", ...digits, `b${breadth}`];   // the conditional path carries it too
```

The breadth index is in BOTH paths, so both drift with the table.

What is true is narrower and still worth having. After splitting, every declaration of a split
family is a LONGHAND, so its breadth is always zero, the index is always the same, and it does no
ordering work: unconditional rules never collide because no two set the same property; a `@media`
rule beats a plain one because `ramonda.c` is last in the statement whatever `b` says; and two
breakpoints are separated by the DIGITS, which are not derived from the table.

So the splitter closes the version-skew question exactly for the families it splits — 51 today, and
the ones authors write most. For `border`, `background`, `font` and `animation` the breadth still
decides and the skew still can bite, which is what the marker and the remap above are for. Closing
it entirely means splitting those too, and that needs the classifier the measurements say has to
become a generated table of its own.

The order:

1. **the shapes as a generated table** — `build-shorthand-shapes.mjs`, three engines, the same
   merge and `--check` as `build-shorthand-leaves.mjs`. The learner moves out of the prototype and
   into a module both it and the generator use, because two copies of it is the fault this
   repository keeps finding;
2. ~~**the group clear in `mergeClassNames`**~~ — **not needed for the positional families**, and
   that was worth measuring rather than assuming. A positional split emits every longhand the
   engine's own expansion names, so a later shorthand displaces an earlier longhand BY KEY and the
   reset costs nothing extra. End to end, through the real merge and the real key naming:

   ```
   padding: 10px                    →  r-pt-10px r-pr-10px r-pb-10px r-pl-10px
   padding-left: 4px, then padding  →  r-pt r-pr r-pb r-pl-10px    the 4px is displaced
   padding, then padding-left: 4px  →  r-pt r-pr r-pb r-pl-4px     only the left moves
   ```

   Both directions right, with no group clear and the cascade never asked, because every surviving
   class sets a different property. The group clear is still owed by the TYPE-dispatched families,
   whose split emits only what the author wrote;
3. **the corpus as a gate**, over the real splitter rather than a modelled one;
4. **then** the splitter in the compiler, behind the gate.

And it goes in a pull request of its own. This one is already large, it is measurements and rules
and decisions, and the splitter changes what every user's page carries — mixing them makes neither
reviewable.

#### How it got there, round by round

Not a list of what is left — that is above, and it is four families this engine never expands. This
is the log, kept because every entry is a thing that read as the splitter WORKING, and because the
same mistakes are the ones the real implementation will be free to make again.

**A probe token is a COMPONENT, not a word.** `text-box`'s edge is `cap alphabetic`, and `cap`
alone is refused, so no single word ever classified and the family had no shape at all. Multi-word
probe tokens, and a word that classifies as nothing being offered the word after it before the
value is given up on, moved it from *no shape* to *a shape that is wrong in ten of twenty-five
values* — which is a diagnosis rather than a fix, and worth having as one.

**No family is without a shape now**, and the last three came in without a sixth one.

**The carrier can be a PAIR.** `font` accepts no single component at all — a size without a family
is refused and so is a family without a size — so a one-token carrier left every `font` token
unclassifiable and the family shapeless. `font: 3px aaa` is accepted, and that is enough to carry
the rest.

**And the rest was vocabulary, again.** Font keywords (`italic`, `bold`, `condensed`,
`small-caps`) and grid ones (`1fr`, `minmax(0, 1fr)`, `"a"`, `auto-flow`) brought in `font`, `grid`
and `grid-template` — the three families this note called "genuinely a grammar of their own" one
round earlier. They were not. Of the fourteen it has named that way over the whole exercise,
fourteen turned out to be the probe's words missing rather than CSS being irregular.

**Nothing is left wrong.** `position-try` needed its order and tactic words (`most-width`,
`flip-block`) and nothing else. `text-box` needed three things, and the third is the one worth
keeping:

- **constants first, across every group, and only then the slots.** A group's probe leaves values on
  longhands it does not own, and those cannot be told apart from constants it really does set —
  `text-box: cap alphabetic` sets the trim to `trim-both` with no trim word written. Dropping them
  loses that; applying them in ONE pass let the last group processed clobber a slot an earlier one
  had filled. Two passes keeps both, because a constant can be overwritten by a slot and never the
  other way round. **This is the third attempt at that problem**, and the note below records the two
  that failed — the difference is the ordering, not the filtering;
- **the WHOLE value against a sentinel before any word of it**, since a probe token can be several
  words. Word by word matched neither half of `cap alphabetic`, so the mapping became a literal and
  `ex text` came out as the probe's own `cap alphabetic`;
- and the same fix again in the COMBINATION learner, which had missed it in the same way.

**And the two attempts that failed, kept because the third one is only a small step from them.** A constant
for a longhand another group owns is indistinguishable from that probe's leftovers: `text-box: cap
alphabetic` really does set the trim to `trim-both` with no trim word written, and `border: 1px
solid red`'s colour probe really does leave a width behind. Keeping those literals and filtering
them at SPLIT time against the groups actually present is the obvious answer, and it took the count
from 84 to 82 the first time and from 84 to 82 again after the architecture had changed underneath
it. Whatever separates the two, it is not that.

**Four that never expand in the engine at all** — `all`, `perspective-origin`, `transform-origin`,
`vertical-align`. They are in the shorthand table because SOME engine resets longhands through
them, and this one hands back nothing: there is no decomposition to find, and reporting them beside
`font` and `grid` read as thirteen families needing a grammar when it is nine.

## Measurements behind the code

The source keeps a decision's reason and at most one number. The measurements a decision rests on,
where there is more than one, are here; how each was found is in the commit that made it.

### Why the esbuild plugin declines a file it has read, and offers `filter`

esbuild hands a plugin a path, so a file is read to be asked whether it holds a block. Measured on
400 small modules, none holding a block:

| | |
|---|---|
| esbuild alone | 11.4 ms |
| a plugin that is only asked | +12%, 3.4 µs/file |
| …and reads the file | +60%, 17.3 µs/file |
| …and does everything this plugin does | +60%, 17.1 µs/file |

The read is the cost; reading bytes undecoded is no faster (+62%), and a minified build with source
maps pays the same (+61%). Handing the contents back to spare esbuild its read would claim the file
from every other plugin and require naming a loader — returned without one, contents are parsed as
plain JavaScript. So the plugin declines, and `filter` keeps the read to the tree that holds blocks.


### Why `units` is set per family of unit

`units: ["px", "rem"]` once meant *every unit in CSS and nothing else*, so a project stating the one
rule it wanted got four reports on ordinary CSS it had no opinion about:

| declaration | why it was reported |
|---|---|
| `transition: all 200ms ease` | `ms` is a time |
| `width: 50%` | `%` is a percentage |
| `rotate: 45deg` | `deg` is an angle |
| `grid-template-columns: 1fr` | `fr` is a flex |

### Why the editor says when the config did not load

Measured across nine broken configs, with a block breaking two of the project's own settings:

| config | what the editor reported |
|---|---|
| good | `[unit-not-allowed] …` and `[hardcoded-not-allowed] …` |
| a syntax error | nothing |
| `units: "px"` | nothing |
| six more | nothing |

### Why a token of kind `any` is still registered, as `*`

`*` refuses nothing, but `initial-value` is what makes the name resolve when nothing sets it:

| registration, never set | reads |
|---|---|
| `syntax: "*"` with `initial-value: anything at all` | `anything at all` |
| `syntax: "*"` without `initial-value` | `""` |

### Why `ramonda-css check` drops the compiler's repeat of every rule, not only `unknown-property`

Swept across twelve faults, the `//` comment was the one that came out twice:

    line-comment: CSS has no `//` comment — … Write a block comment instead.
    TS2353: … and '"// the palette is in flux\n  gap"' does not exist in type 'CssBlockShape'.

### Why source maps use `hires: "boundary"`

| `hires` | columns | mappings | time |
|---|---|---|---|
| `true` | every column exact | 1393 chars | 22.0 µs/file |
| `"boundary"` | every column exact | 723 chars | 22.2 µs/file |
| `false` | every column → 0 | 97 chars | 16.4 µs/file |

### Why the prefixed half of an alias pair is emitted first

`-webkit-box-shadow: 0 0 1px red; box-shadow: 0 0 9px blue;`, with the alias pair in its written
order:

| where it sits | the shadow |
|---|---|
| alone in the file | blue — CSS's answer |
| after a block naming `box-shadow` first | RED |
| after a block with the same two, reversed | RED |

### Why a near-miss counts a swap of two letters as one edit

| list | typo | Levenshtein | this |
|---|---|---|---|
| properties | swap | right 12978, wrong 88, silent 199 | right 13263, wrong 2, silent 0 |
| properties | drop | right 14223, wrong 63, silent 0 | the same |
| at-rules | swap | 157 right, 25 silent | 182 right, 0 silent |
| selectors | swap | 1210 right, 141 silent | 1353 right, 0 silent |
