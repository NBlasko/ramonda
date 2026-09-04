# A style block that becomes a class before the browser sees it

**Status: a design, not a package.** No `package.json` on purpose — a manifest with no code is a
package claiming to exist. This folder holds the plan and two prototypes that make its two central
claims runnable instead of merely stated.

---

## What is being built

The style is written beside the markup, in CSS:

```tsx
<div css=@(
  display: flex;
  flex-direction: column;
  padding: 24px;
  background-color: #0f172a;
  border-left: {{isOnline ? "4px solid #10b981" : "4px solid #64748b"}};
)>
  <h3 css=@( margin: 0; color: #ffffff; )>Nikola</h3>
</div>
```

The build emits a class for everything that cannot change, and a custom property for everything that
can. Nothing about the style is in the bundle, nothing is rebuilt per render, and the browser caches
the sheet as a file:

```css
.r-8e271c6c { display: flex; flex-direction: column; padding: 24px;
              background-color: #0f172a; border-left: var(--r0); }
```

```tsx
<div className="r-8e271c6c" style={{ "--r0": isOnline ? "4px solid #10b981" : "4px solid #64748b" }}>
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

`{{isOnline ? … }}` is TypeScript and has to be checked as TypeScript, in its real lexical scope,
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
      border-left: {{accent.toUpperCase()}};
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

__block({ display: "flexx" });               // value typo
__block({ dsiplay: "flex" });                // key typo
__block({ padding: nekaFunc() });            // a hole returning the wrong type
__block({ padding: "10px 20px" });           // correct — silent
```

`tsc --strict`, verbatim:

```
TS2820: Type '"flexx"' is not assignable to type '"flex" | "none" | "block" | …'. Did you mean '"flex"'?
TS2561: Object literal may only specify known properties, but 'dsiplay' does not exist
        in type 'Partial<CssProperties>'. Did you mean to write 'display'?
TS2322: Type 'boolean' is not assignable to type 'Length | …'
```

Three things fall out of that one encoding, and they were three separate questions:

- **a typo in the property name**, with TypeScript's own *did you mean* — because an object literal
  gets excess-property checking, which an argument list does not;
- **a typo in an enumerable value**, likewise;
- **a hole checked against the property it belongs to.** `padding: {{nekaFunc()}}` is checked against
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
| enumerable (`display`, `position`, `flex-direction`, …) | a real union | **the types** — with *did you mean* |
| lengths, colours, shorthands | `string \| number` | **our CSS checker**, where we write the message |

The type system takes the half it is good at and stays readable; the checker takes the half where a
grammar is needed and a human-written message is worth more than an expanded union.

### That the emitted CSS survives the pipeline

If the sheet is handed to a post-processor, whatever it does must not break the HTML that already
names the classes — and a minifier is allowed to merge and rename rules.

*Recommended:* a **round-trip assertion** at the end of the build. Every class the transform emitted
must still be present in the final stylesheet, and every `var(--rN)` it promised must still be
referenced. A rule that vanished or was renamed fails the build, instead of shipping markup pointing
at a class that is not there.

---

## The syntax

`@( … )` with `{{ … }}` holes. Kept, because we own the parser and there is no reason to pay a worse
spelling to please a parser we are replacing anyway.

**One collision found, and it is worth knowing before writing the parser.** `@(expr)` is *already*
valid TypeScript in **decorator position** — measured, this compiles:

```ts
class C { @(dec) m() {} }
```

In a JSX attribute value position it is unambiguous (`"`, `{` or nothing are the only things allowed
there), and in expression position it is a syntax error today (`TS1109`), so nothing existing changes
meaning. **But this is a decorator-heavy framework**, so the parser must never look for a style block
in front of a class, a method or a field. That is a one-line rule and a permanent test, not a design
problem — as long as it is written down before rather than discovered after.

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
4. **Bundler adapters.** Vite first — that is where dev and HMR live — then esbuild.

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
   finding `=@(` is not the same as knowing it is an attribute rather than text. Measured at ~450 MB/s,
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

**The compiler would be building strings.** `style={\`--r0:${expr}\`}` means the transform
concatenates author code into attribute text, which drags in escaping — a `"` or a `;` out of a hole
must not be able to end the declaration or the attribute — for a problem that need not exist.

**It assumes the block is a JSX attribute.** It is not, necessarily. `@( … )` is an expression, and
where it is written is not the transform's business: it may be assigned to a variable, returned from
a method, held in a field, or passed to something. A transform that only knows how to rewrite a
`<div>` has decided the feature is narrower than the syntax.

**It solved the double-render report in the wrong place.** See below.

### The shape instead: a value, and the compiler never builds a string

A block compiles to a **value**, and the expressions are transplanted verbatim into value positions.
Nothing is concatenated, so nothing has to be escaped.

```tsx
// static only — hoisted to module scope, built once for the life of the program
const _s1 = block("r-94dc05ab");
…
<h3 css={_s1}>

// with holes — the descriptor is still hoisted; only the values are per-render
const _s2 = block("r-8e271c6c", ["--r0"]);
…
<div css={_s2(this.open ? "4px solid " + this.accent : "4px solid #64748b")}>
```

The expression is an argument, copied across untouched. The custom property reaches the DOM through
`setProperty("--r0", value)`, which takes a raw string — so **the escaping problem the string form
created simply does not arise**.

And a block with no holes is a module constant: it costs one allocation for the life of the program,
not one per render. That is the common case.

### The prop is Ramonda's, and so is the exemption

The value needs somewhere to land, and that is a real `css` prop maintained in the framework — which
is also what makes the double-render question somebody's to answer rather than something to design
around.

**Measured: the object form is reported.** Rendering `style={{ "--r0": this.accent }}` in a
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

Because the compiled form is a value, `@( … )` outside JSX is the same feature with no special case.
The package exports one function that turns a compiled value into `{ className, style }`, which is
what a wrapper on another JSX framework spreads. Ramonda applies it natively through the prop; nobody
else has to.

---

## Open decisions

**1. Where a hole may appear.** A custom property holds a *value*. It cannot hold a property name, a
selector, or a whole declaration:

```
border-left: {{…}};                ✓   becomes  border-left: var(--r0)
{{cond ? "display:flex" : ""}}     ✗   a declaration — nothing to put a variable in
{{name}}: 24px;                    ✗   a property name
&:{{state}} { … }                  ✗   a selector
```
*Recommended:* value position only, refused at build time with the source position, and reported by
the checker first.

**2. ~~What an `undefined` hole does.~~ DECIDED by the server-rendering measurement below: the type
refuses `undefined`.** It was a preference; the four hydration directions make it a requirement. Emit
`var(--r0, initial)` as the floor anyway, for the value that arrives from outside the types.

**3. Merging with a written `style`.** *Recommended:* merge, generated first, author last.

**4. Ordering and specificity.** Two classes setting the same property are decided by their order in
the sheet, which comes from module graph order. *Recommended:* one block emits one class holding all
its declarations, and the sheet sits in a named `@layer` beneath author stylesheets.

**5. Nesting, `&:hover`, `@media`.** Unusable without them. *Recommended:* those three in v1.

**6. ~~The compiled value's exact shape.~~ DECIDED: a call, `_s2(value)`.** It reads better and
allocates the same as an array. The compiler still concatenates nothing — the expression is an
argument, transplanted verbatim.

**7. May anything happen at runtime?** **DECIDED — no.** Custom properties only, never an injected
rule. Injecting would give up server-render determinism, the cached sheet and the checker's view of
the styles, which is every property this design has. Written down so it is not reopened by
convenience later: a feature that "just needs a rule at runtime" is a feature that belongs somewhere
else.

**8. The name, and where it lives.** Not `@ramonda/*`, by constraint 3. Living in this monorepo is
fine — one gate, one release pipeline — but nothing in it may import from the framework.
**Recommended: `stilo`**, free on npm as of 2026-09-04. Short, says *style* without saying *CSS in
JS*, and carries no framework in it, which matters for a package whose whole pitch is that it works
anywhere. Checked and free alongside it: `cssat`, `at-block`, `blockcss`, `styleblock`, `kalem`.
Taken: `cssx`, `atcss`. **Still the user's call.**

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
<div class="r-8e271c6c" style="--r0: #10b981; --r1: 24px;"></div>
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
Card's block:    & .title { color: {{this.accent}} }
Title's block:   padding: {{this.pad}}
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

The obvious guess is that a file with `@( … )` in it fails to parse and the run stops. **Measured,
and it is worse than that: TypeScript error-recovers, so the run looks completely normal.**

The same component, twice, differing only in where the block sits in the attribute list:

```tsx
<div onclick={this.go} role="button" tabindex={5} css=@( display: flex; )>   // block last
<div css=@( display: flex; ) onclick={this.go} role="button" tabindex={5}>   // block first
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
`@( … )` cannot honestly certify until the checker reads through the transform.** The certificate is
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
| a hole typed by its property | `TS2322` on `padding: {{nekaFunc()}}` |
| dev speed | +2.6% over esbuild; 15–22 µs per file, linear |
| values crossing to the client | in the markup; no channel, no registry |
| instances do not multiply rules | one rule at any N; 0.10 KB either way |
| a longer hash is free | 8, 12 and 16 hex all gzip to 46.7 KB |
| the generated object is reported | `RMD020`, every render |
| the checker goes quietly blind | three rules become one, silently |

### Answered by a decision, with the mechanism verified but not yet built

The `RMD020` exemption — the place exists and already skips two other keys, but the line is not
written. Scoped variable names — the cost is measured, the failure they prevent is read from the
specification, because jsdom cannot resolve an inherited custom property. The assembly-time collision
assertion, the round-trip assertion after post-processing, and the checker reading the virtual file:
all three are ordinary work in places that already exist, and none is proved.

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

### The one real risk, and it is not technical

**Every tool that parses a `.tsx` file has to be taught, and we can only teach some of them.**

| | can it be taught? |
|---|---|
| `tsc` | yes — the virtual file, proved |
| the editor | yes — a language-service plugin serving the same virtual file |
| the bundler | yes — it is our plugin |
| `ramonda-check` | yes — the same virtual file |
| **the formatter** | **no** — measured: biome cannot read the file and has no plugin surface |
| **the linter** | **no** — measured: `oxlint: Unexpected token`; its "plugins" are built-in rule sets, not a parser extension point |

So a file that uses this feature is, today, a file that cannot be formatted or linted. That is not a
flaw in the design — it is the price of a syntax the ecosystem does not know, and it is the same
price JSX paid before the ecosystem learned it. **It should be a decision somebody makes on purpose,
not something discovered by the first person who runs the formatter.**

The fallback that costs nothing here is the object form — `css={{ display: "flex" }}` — which every
tool already reads and which the type system checks natively. It was rejected for good reason: it is
not CSS, and *cleaner code* was the point. Recorded so the trade is visible, not to reopen it.

### The verdict

**No blocker.** Every problem found has an answer, and the load-bearing ones are proved by running
code rather than argued: that a syntax `tsc` cannot parse can still be type-checked, that the
transform is cheap, that the maps compose, and that the test runner is covered. The remaining work is
large but ordinary.

The two candidates for a blocker were the two nobody had looked at, and both came back clean. What
remains is not a risk to the design but a cost to its users: **the formatter and the linter cannot
read the file**, and that is a decision to take deliberately rather than a problem to solve.

---

## What this contradicts today

`apps/docs/content/styling.md` says, under *What the framework does not do*: **no scoping, no
generated class names, no CSS-in-JS.** Its three stated reasons are that such a style ships in the
bundle, is rebuilt every render, and cannot be cached as a file.

**Build-time extraction satisfies all three rather than contradicting them.** That is the strongest
argument the design is right — and a page to rewrite rather than quietly amend when it lands.

---

## The prototypes

```
node packages/css/prototype-typecheck.mjs packages/css/example.tsx.txt
```

Proves the claim everything else depends on: a `tsc` diagnostic from inside a `{{ … }}` hole,
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
