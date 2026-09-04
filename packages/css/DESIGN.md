# `css` — a style block that becomes a class before the browser sees it

**Status: a design, not a package.** There is no `package.json` here on purpose — a manifest with no
code is a package claiming to exist. This directory holds the plan; the name `@ramonda/css` is
reserved by the folder and nothing else.

---

## The thing being built

An author writes the style beside the markup, and ships a stylesheet.

```tsx
<div css={css`
  display: flex;
  flex-direction: column;
  padding: 24px;
  background-color: #0f172a;
  border-left: ${isOnline ? "4px solid #10b981" : "4px solid #64748b"};
`}>
  <h3 css={css`margin: 0; color: #ffffff;`}>Nikola</h3>
</div>
```

The build emits a class for everything that cannot change, and a custom property for everything that
can:

```css
.r-8e271c6c { display: flex; flex-direction: column; padding: 24px;
              background-color: #0f172a; border-left: var(--r0); }
.r-94dc05ab { margin: 0; color: #ffffff; }
```

```tsx
<div className="r-8e271c6c" style={{ "--r0": isOnline ? "4px solid #10b981" : "4px solid #64748b" }}>
  <h3 className="r-94dc05ab">Nikola</h3>
</div>
```

Nothing about the style is in the bundle, nothing is rebuilt per render, and the browser caches the
sheet as a file. **That split — static structure, dynamic values, never dynamic rules — is the whole
design.** Everything below follows from it.

---

## The syntax, and why it is not `@( … )`

The shape this started from was `css=@( … )` with `{{expr}}` holes. The idea underneath it is right.
The delimiters are the one part worth replacing, and the reason is the same thing that was asked for:
type safety.

**JSX is type-safe because TypeScript's own parser implements JSX.** That is the entire mechanism. A
grammar the compiler does not know is not a grammar it can check.

Measured, both refuse it at the parse step — before any type exists to be checked:

```
esbuild   ✘ [ERROR] Expected "{" but found "@"      a.tsx:3:11
tsc       error TS1145: '{' or JSX element expected.
          error TS1005: ')' expected.            (+ 5 more, cascading)
```

What that costs is not one error message. Everything in this repository that reads source reads it
through the TypeScript parser or esbuild's:

| | what happens to a file with `@( … )` in it |
|---|---|
| `tsc` | does not parse — no types, anywhere in the file |
| esbuild / the Vite and esbuild adapters | does not parse — no build |
| **`ramonda-check`'s 86 rules** | `analyze.ts` builds a `ts.Program`. A file that does not parse has no AST, so **every rule goes blind on it** |
| `biome format` · `oxlint` | no |
| `check-examples.mjs` | the documentation gate type-checks every block in the docs and the READMEs. Blocks using this syntax become unverifiable |
| every editor | no highlighting, no completion, no go-to-definition, no rename |

The framework would be introducing a syntax its own checker cannot see — in a release whose headline
is that every rule fails the run.

### The replacement, measured

A tagged template is valid TypeScript, so all of the above keeps working, and the transform still
sees a literal with its holes in it.

```ts
declare function css(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string & { readonly __cssBlock: true };
```

Planted with two deliberate faults, `tsc --strict` reports exactly those two and nothing else:

```
b.tsx(29,25): error TS2322: Type 'string' is not assignable to type 'string & { __cssBlock: true }'.
b.tsx(30,26): error TS2322: Type '{ display: string; }' is not assignable to …
```

So `css={"display: flex"}` and `css={{ display: "flex" }}` are both refused, and the good form
compiles. **The brand is what does it** — without it the prop is a `string` and any string passes.
Note that `RamondaArgs` carries `[val: Lowercase<string>]: any`, so a `css` prop that is not declared
explicitly is silently `any`. It has to be declared.

The cost is honest and small: ``css={css`…`}`` says `css` twice.

### What was given up, and it is not nothing

`{{isOnline ? … }}` reads better inside CSS than `${isOnline ? … }`. That is a real loss and the only
one. `${…}` is the interpolation every TypeScript reader already knows, and it is the one the
compiler will hand the transform for free.

---

## The transform

A prototype over the TypeScript AST — 30 lines, run against the file above — already produces the
output at the top of this document. It is not the hard part.

1. Find `css` tagged templates. `ts.isTaggedTemplateExpression`, tag resolved to this package's export
   rather than to the name — a local `const css = …` must not be picked up.
2. Split into static chunks and holes. `template.head` + each `templateSpans[i].literal`, with
   `span.expression` the hole.
3. Replace hole *i* with `var(--rN)`, normalise whitespace, hash the result. **The class name is the
   hash of the normalised block**, so two identical blocks anywhere in the app share one class and the
   name does not depend on the file, the order of the build, or how many blocks came before.
4. Emit the rule into the sheet; rewrite the attribute to `className` plus a `style` object of the
   holes.

---

## What "type safe" can mean here, and what it cannot

Worth being exact, because the answer is better than it first looks.

**TypeScript can check the prop and the holes.** That the attribute got a `css` block and not a
string; that the interpolated expression is a `string | number` and not an object or `undefined`.
Both measured above.

**TypeScript cannot check the CSS text.** `dsiplay: flx;` is a valid template literal in every
design considered here, `@( … )` included. No delimiter changes that.

**But this repository already owns the machine that can.** `ramonda-check` runs 86 rules over a
`ts.Program`, and the block is a literal in that program — its text is available statically, in full,
at the exact source position. `@ramonda/dom-facts` is already the package that knows what the DOM
knows. A rule family over the extracted block is the natural place for:

- a property that does not exist, and the near-miss it was meant to be
- a value the property does not take
- **a hole in a position a custom property cannot occupy** — see the next section; this one is not
  cosmetic, it is the rule that keeps the feature honest
- a declaration that will never apply — `display: flex` beside `display: block`

**This is the part other frameworks do not have**, and it is not the interpolation syntax. Styles
written next to markup is a solved, crowded problem. A checker that reads those styles and refuses
the wrong ones — in the same run, at the same severity, with the same escape hatch — is not.

---

## Open decisions

Each needs an answer before code. A recommendation is given for every one; none is settled.

**1. Where a hole may appear.** A custom property holds a *value*. It cannot hold a property name, a
selector, or a whole declaration:

```
border-left: ${…};              ✓  becomes  border-left: var(--r0)
${cond ? "display:flex" : ""}   ✗  a declaration — there is nothing to put a variable in
${name}: 24px;                  ✗  a property name
&:${state} { … }                ✗  a selector
```
*Recommended:* value position only in v1, and the transform refuses the rest with the source position
— an error at build time, plus a rule so the checker says it first.

**2. What an `undefined` hole does.** An unset custom property makes the declaration invalid at
computed-value time, which is a silent nothing rather than an error. *Recommended:* emit
`var(--r0, initial)` so it falls back explicitly, and let the type refuse `undefined` in the first
place — that is what the `string | number` signature above is doing.

**3. Merging with an author-written `style`.** `<div css={…} style={…}>` — the generated properties
and the written ones must both survive. *Recommended:* merge, generated first, author last, and a
rule if the author writes `--rN` themselves.

**4. Ordering and specificity.** Two classes setting the same property are decided by their order in
the sheet, and that order comes from module graph order. *Recommended:* one block emits exactly one
class holding all its declarations — so the ordering question only arises *between* elements, where it
is rare — and put the sheet in a named `@layer` beneath author stylesheets, so a hand-written rule
predictably wins.

**5. Nesting, `&:hover`, `@media`.** The feature is not usable without them. *Recommended:* `&`,
pseudo-classes and `@media` in v1; anything deeper waits for a use.

**6. Where the emitted CSS goes.** Both adapters already exist in `@ramonda/build`. Under Vite, a
virtual module plus an injected import, which is what makes HMR work. Under esbuild, a plugin
collecting into one output file. *Recommended:* same path in dev and production — a dev-only `<style>`
injection is how dev and prod come to disagree.

**7. SSR.** Build-time extraction means the class is already in the server-rendered HTML and the sheet
is a `<link>`; `renderDocument`'s `styles` option takes the hrefs today. No injection, no flash, no
runtime. *Recommended:* nothing new — but confirm against `@ramonda/server` before believing it.

**8. The runtime half.** The idea was to call this syntax elsewhere later. *Recommended, and this is
an opinion worth arguing about:* the only thing that may ever happen at runtime is **setting a custom
property**. Injecting a rule at runtime gives up SSR determinism, the cached sheet, and the checker's
view of the styles — every property this design has. Outside JSX, ``const panel = css`…``` returning a
class name is free and needs no runtime at all.

**9. The name.** `css` over `sx`: it says what it is, and it is what the tag is called.

**10. A generated object in the markup.** The transform emits `style={{ "--r0": … }}` — an object
built in the markup on every render, which is a shape the framework's own diagnostics have opinions
about. **Not measured yet.** Find out whether `RMD020` or `fresh-object-in-props` reports generated
output before writing a transform that emits it.

---

## What this contradicts today

`apps/docs/content/styling.md` currently says, under *What the framework does not do*: **no scoping,
no generated class names, no CSS-in-JS.** Its stated reasons are that a style built in JavaScript
ships in the bundle, is rebuilt on every render, and cannot be cached as a file of its own.

**All three reasons are satisfied by build-time extraction rather than contradicted by it** — which is
the strongest argument that this design is the right one, and also a page that has to be rewritten
rather than quietly amended when it lands.

---

## Phases

1. **This document, agreed.** Especially decisions 1, 8 and 10.
2. **The extractor alone**, as a pure function: source text in, `{ class, css, holes }` out. Testable
   with no bundler, and the prototype already exists.
3. **The types** — the `css` tag, the branded block, the `css` prop declared explicitly on
   `RamondaArgs` so the `Lowercase<string>` index signature does not swallow it.
4. **The Vite adapter**, because that is where dev, HMR and the docs app are.
5. **The checker rules**, over the extracted block.
6. **esbuild**, SSR verification, and the `styling.md` rewrite.

Nothing here is started.
