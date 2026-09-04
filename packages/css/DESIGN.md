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

**3. It does not know Ramonda exists.** No import from the framework, no dependency, nothing in the
output that names it. What it emits is `className` and `style`, which are DOM-level. Somebody using
another JSX framework needs a wrapper for the prop and nothing else.

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
4. **Bundler adapters.** Vite first — that is where dev and HMR live — then esbuild.

---

## Speed, and why the dev path is cheap

The requirement is that a dev build stay as fast as one without this. The reason it can is a split
that already exists in every TypeScript project:

| path | what runs | does it type-check? |
|---|---|---|
| dev server, and the production build | scan → parse the block → emit class and variables | **no** |
| the check command, and the editor | virtual file → `tsc` → map diagnostics back | yes, in its own process |

That is exactly how types are handled today: esbuild strips them without checking them, and `tsc`
runs beside it. **Type checking never sits on the hot path**, so the dev cost is the transform alone.

Four things keep the transform cheap, in order of how much they matter:

1. **The bail-out, and it is nearly free.** A file with no sigil is never parsed. Measured over this
   repository — 1,268 source files, 10.61 MB — a substring scan finds them all in **1.33 ms**, about
   1.0 µs per file at ~8 GB/s. A codebase that never uses the feature pays that and nothing else.
2. **No cross-file analysis, ever.** A class name is the hash of its own normalised text, so a block
   can be compiled knowing nothing about the rest of the app. That is what makes files independently
   cacheable, transformable in parallel, and re-transformable one at a time.
3. **Incremental by construction.** One file changes, one file is re-transformed, and its chunk of
   the stylesheet is replaced. A style-only edit is a CSS hot update with no JavaScript reload.
4. **Cached on content hash**, across restarts, because the transform is a pure function of the
   file's text.

**The cost that has to be measured rather than promised** is the parse of a file that *does* contain
a block: finding `=@(` is not the same as knowing it is a JSX attribute rather than text inside a
string or a comment. That needs lexical context, and how much is the open question. Nothing above
depends on the answer; the bail-out is what protects the other 99% of files.

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

**2. What an `undefined` hole does.** An unset custom property makes the declaration invalid at
computed-value time — silent, not an error. *Recommended:* emit `var(--r0, initial)`, and let the
type refuse `undefined` before that ever matters.

**3. Merging with a written `style`.** *Recommended:* merge, generated first, author last.

**4. Ordering and specificity.** Two classes setting the same property are decided by their order in
the sheet, which comes from module graph order. *Recommended:* one block emits one class holding all
its declarations, and the sheet sits in a named `@layer` beneath author stylesheets.

**5. Nesting, `&:hover`, `@media`.** Unusable without them. *Recommended:* those three in v1.

**6. What the standalone form returns.** Outside JSX — `const panel = @( … )`. *Recommended:* an
object `{ className, style }`, because that is what makes constraint 3 true: any framework can spread
it, and nothing about it is JSX-specific.

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

**9. Does the framework report the generated `style={{ … }}`?** The transform emits an object in the
markup, which is a shape Ramonda's diagnostics have opinions about. **Not measured.** Measure before
writing a transform that emits it.

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
