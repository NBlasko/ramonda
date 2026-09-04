# Building `@ramonda/css` — the plan

**Read `DESIGN.md` first, then `CONTRACT.md`.** `DESIGN.md` carries the reasoning and every
measurement; `CONTRACT.md` carries the four decisions both halves are written against, and its code
is in `src/`; this file carries only the order of work, what blocks what, and what may run beside
what. Where they disagree, `CONTRACT.md` wins on the shapes and `DESIGN.md` on the reasons — this
file is the one that goes stale.

**Phase 0 and track B are done.** `CONTRACT.md` is written and every decision in it is implemented
and tested in `src/`; the package is real, private, and every gate in this repository sees it. The
framework takes a `css` prop and applies it, with the SSR and hydration directions measured rather
than assumed. **Everything else is unstarted** — the next work is track C, or A1, the parser.

---

## What is being built, in three sentences

A `css` block written in real CSS beside the markup, with `{{expr}}` holes. At build time the static
declarations become a class in a stylesheet and each hole becomes a CSS custom property carried on
the element. The syntax is not TypeScript, so the package owns a parser and a virtual-file layer —
the same way JSX is usable because somebody wrote the parser for it.

```
<div css=@(
  display: flex;
  border-left: {{isOnline ? "4px solid #10b981" : "4px solid #64748b"}};
)>
```

---

## Phase 0 — freeze the contract. Everything parallel depends on this and nothing else

**This is the only truly sequential-first step, and it is small.** Four decisions, written down as a
file the other tracks can code against without waiting for the parser to exist.

1. **The compiled value.** A block becomes a hoisted descriptor plus a call:
   ```tsx
   const _s0 = block("r-<16 hex>", ["--r-<16 hex>-0"]);   // module scope, once per block
   <div css={_s0(isOnline ? "…" : "…")}>                  // expressions transplanted verbatim
   ```
   A block with no holes compiles to the bare descriptor — `css={_s0}` — and costs one allocation for
   the life of the program.
2. **What `block()` returns and what the `css` prop accepts.** One shape, and the framework and the
   compiler must agree on it before either is written. It must also be turnable into
   `{ className, style }` by a single exported function, which is what a wrapper on another JSX
   framework uses.
3. **Names.** Class: `r-` + 16 hex of the hash. Variable: `--<class>-<n>`, scoped to the block —
   see `DESIGN.md` for the nested-selector collision this prevents. Never positional `--r0`.
4. **Normalisation, exactly.** The hash is taken over the normalised block, so **normalisation is
   the definition of identity**: it decides which blocks dedupe, and it must produce byte-identical
   results in the server build and the client build. Write the rules down and test them before
   anything hashes.

**Done when** a `CONTRACT.md` exists that someone can implement either side against without reading
the other side.

**DONE.** `CONTRACT.md`, plus the code it describes:

| | where |
|---|---|
| the compiled value, and `block()`'s return | `src/types.ts`, `src/value.ts` |
| the names, and the hash | `src/compiler/names.ts` |
| normalisation, and the block the parser has to produce | `src/compiler/normalise.ts`, `src/compiler/ast.ts` |
| the rules, as a table of what may and may not merge | `src/__tests__/normalise.test.ts` |

Three things were settled in the writing rather than carried over:

- **Normalisation runs on the PARSED block, not on the text.** Nothing that reads characters can tell
  the meaningless space before a declaration's colon from the combinator in `& :first-child`, so a
  text normaliser has to keep both — and `color : red` would never share a class with `color:red`.
  This also fixes what A1 owes the rest of the work: a `Block`, not a string.
- **The names are circular, so a hole hashes as a placeholder.** The variable name comes from the
  class, the class from the hash, the hash from the text. `U+0000` is the delimiter because CSS
  preprocessing replaces it with `U+FFFD`, so no author can forge one.
- **Arity is typed.** `block()` takes the property names as a tuple, so emitting two names and one
  argument is a type error. The compiler writes both halves — this is it checking itself.

---

## The dependency graph

```
                        ┌── B  framework side ──────────────┐
   0  contract ─────────┼── C  property types ──────────────┤
                        └── A1 parser + transform           │
                                 │                          │
                    ┌────────────┼─────────────┐            │
                    │            │             │            │
              A2 virtual     A3 Vite       D  CSS checker    │
                 file         plugin           rules        │
                    │            │                          │
     ┌──────────┬───┴────┐      ├── E  sheet assembly       │
     │          │        │      ├── F  esbuild              │
   G check   H  LS   I  ramonda-check        └── J splitting │
   command   plugin   I2 docs example gate                   │
     │                   (both MANDATORY)                    │
   K  format/lint wrapper        M  TextMate grammar          │
                                 L  runtime diagnostic ── LAST
```

**Primary path — the spine, and it is one person's work at a time:**
`0 → A1 → A2 → G` gets you a feature that compiles and type-checks.
`0 → A1 → A3 → E` gets you a feature that runs in a browser.

**Everything else is parallel to it.**

---

## Tracks that can start on day one, beside the spine

### Track B — the framework side. **DONE.**

Nothing here imported the parser, and none of it existed — which was the point of doing it beside
Phase 0. `packages/core`: `types/cssBlock.ts` declares the shape, `core/cssBlock.ts` applies it,
three touches in `core/Attribute.ts` and one line in `debug/renderStability.ts`. Tests in
`__tests__/CssBlock.test.tsx` and `__tests__/hydration/CssBlockSsr.test.tsx`.

**What it found, and neither was predicted:**

1. **A hostile hole value injects declarations through a SERVER render.** `setProperty` writes one
   declaration whatever it is handed, which closes it on the client — but a server render is
   serialized to HTML and the browser parses the style attribute back, and the parse applies the CSS
   grammar to whatever the serializer wrote. Measured through `renderToString` + `innerHTML`:
   `position: fixed; width: 100vw; z-index: 9999`, real and applied. **The value is now refused if it
   carries a `;`**, in both consumers — `applyCssBlock` and `toStyleObject`. This is a rule in
   `CONTRACT.md`, not an implementation detail.
2. **A hole that differs across the hydration boundary is silent, and the client's value wins.** That
   supersedes the design's measured row: written as an object style the same divergence was reported
   as `RMD007`, because the value was part of an attribute the comparator reads. It is the better of
   the two failing directions — the one that was reported was the one that was not repaired.

`scripts/check-css-contract.mjs` is new and is in `pnpm check`: neither package may import the other,
so the shape is declared twice and this reads both with the TypeScript AST and fails when they
disagree. Proved by planting a renamed field.

The original list, kept because it is what was built:

1. **Declare the `css` prop** on `RamondaArgs` and `SVGArgs` in
   `packages/core/src/types/commonTypes.ts`. **It must be explicit**: those types carry
   `[val: Lowercase<string>]: any`, so an undeclared lowercase prop is silently `any`.
2. **Apply it**: `className` plus `setProperty(name, value)` per hole. `setProperty` takes a raw
   string, which is why nothing has to be escaped.
3. **Exempt it from the double-render check.** `compareAttributes` in
   `packages/core/src/debug/renderStability.ts` already skips keys at depth 0:
   ```ts
   if (depth === 0 && key === "children") continue;
   if (depth === 0 && declared !== undefined && declared.includes(key)) continue;
   ```
   `css` joins those two. **Without this the framework reports its own generated output on every
   render** — measured, see `DESIGN.md`.
4. **Tests, and the four that matter are already written out**: the SSR/hydration directions in
   `DESIGN.md`. Server and client agreeing; disagreeing; `undefined` on one side and a value on the
   other, both ways.

*Size: small. Risk: low. The one thing to get right is that the prop must never be `undefined`.*

### Track C — the property types. Needs the contract, not the compiler

Generate the `CssProperties` map. **The shape is decided and the reasoning is measured** — see
*The honest limit, and it is a dial rather than a switch* in `DESIGN.md`:

- enumerable properties (`display`, `position`, `flex-direction`, …) → a real union, so TypeScript's
  own *did you mean* fires;
- lengths, colours, shorthands → `string | number`, because a template-literal union produces an
  unreadable diagnostic that grows combinatorially. Those typos belong to the CSS checker (track D),
  where the message is one we write.

Then the `block()` and `css` declarations from the contract.

*Size: medium, mostly data. Risk: low. Proof: the three fixtures in `prototype-typed-css.tsx.txt`
become tests.*

---

## The spine, in order

### A1 — the parser and the transform

The single most important piece, and everything except B and C waits on it.

**Input** a source file, **output** the transformed code, a source map, and the blocks it found.

Requirements, each of which came out of a measurement rather than a preference:

- **Bail out on a substring scan** before parsing anything. Measured: 1,268 files and 10.61 MB in
  1.33 ms. A codebase using none of this must pay nothing.
- **The scan is lexically aware** — strings, templates, comments — because finding `=@(` is not the
  same as knowing it is a JSX attribute. Measured at ~450 MB/s, a fifth of the total cost.
- **Never look for a block in decorator position.** `@(expr)` is *already* valid TypeScript there:
  `class C { @(dec) m() {} }` compiles. This is a decorator-heavy framework, so this is a permanent
  test, not a note.
- **Replace only the CSS BETWEEN the expressions, never the expressions themselves.** Found by
  getting it wrong: overwriting a block in one span made a hole report line 8 instead of line 13.
  Writing the gaps out one at a time costs nothing and keeps every expression's own bytes.
- **Refuse a hole outside a value position** — a property name, a selector, a whole declaration —
  with the source position.

*Size: large. Risk: medium, and it is the parser rather than the transform.
Start from `prototype-transform-cost.mjs` and `prototype-sourcemap.mjs`.*

### A2 — the virtual file, and mapping back

Turn a source file into valid TSX that `tsc` can check, keeping a record of where every carried
expression landed, and map diagnostics home.

**Two things go into the virtual file, and the second is what makes CSS type-safe at all:**

- each hole's expression, in its real lexical scope;
- each block as an **object literal** typed `Partial<CssProperties>` — an object literal, because
  that is what gets excess-property checking and therefore TypeScript's own *did you mean*.

*Size: medium. Risk: low — `prototype-typecheck.mjs` already does the mapping, and
`prototype-sourcemap.mjs` proves it survives esbuild underneath (5 of 5 positions).*

### A3 — the Vite plugin

- **`enforce: "pre"` is a requirement, not a preference.** Measured: without it the plugin runs after
  Vite's own esbuild step, which has already refused the file. The same ordering applies to the dev
  server, the build, and the test runner.
- Serve the stylesheet as a virtual module so HMR can replace one file's chunk without touching
  JavaScript.
- Cache on content hash; the transform is a pure function of the text.

*Size: medium. Risk: low. `prototype-testrunner.mjs` runs the ordering test both ways.*

---

## What unblocks after the spine

### D — the CSS checker rules. Starts as soon as A1 produces a block

Independent of everything downstream, so it can run beside A2 and A3.

Unknown property with its near-miss; a value the property does not take; a declaration that can never
apply; **a hole in a position a custom property cannot occupy**, which is the rule that keeps the
design honest. **It may not import `@ramonda/check`** — the technique is shared, the code is not.

*Follow `.claude/skills/writing-a-static-rule/SKILL.md`, and plant the shape before writing the rule.*

### E — sheet assembly. The place every global question belongs

The transform is deliberately local — no cross-file analysis — which is what makes it cacheable and
incremental. **Assembly is where the whole picture exists**, so three things live here and nowhere
else:

1. **Dedupe.** Identical blocks are one rule, by hash.
2. **The collision assertion.** No two distinct blocks may share a class. This is the *guarantee*;
   the 16-hex name only decides that it never fires.
3. **The round-trip assertion.** After any post-processing, every emitted class must still be present
   and every `var(--…)` still referenced — a minifier is allowed to merge and rename.

Plus `@layer`, so a hand-written stylesheet predictably wins.

### G — the check command

`tsc` over the virtual file, diagnostics mapped home, a non-zero exit. **Without this, type safety is
a claim about editors rather than about CI.**

### H — the language-service plugin

Serve the virtual file as the script snapshot, map back. Completion inside a block then *is*
object-literal completion. Without this the feature is technically safe and practically unusable.

### I2 — the docs example gate reads through the virtual file too

`scripts/check-examples.mjs` type-checks every code block in the documentation and the READMEs.
**Measured, planted into a real page: it does not fail — it files the block under "not standalone
code and skipped" and exits 0.** It cannot tell pseudo-code from a syntax it cannot parse, so every
documented example of this feature would be unverified, in a repository that has already shipped
three wrong examples exactly that way.

Same fix, same layer. **This makes the docs gate the sixth consumer of the transform** — after the
build, `tsc`, the editor, `ramonda-check` and the test runner.

### I — `ramonda-check` reads through the virtual file. MANDATORY

**Not optional, and it was missing from the first version of this list.** `ramonda-check` builds a
`ts.Program` from the project's tsconfig, so it reads the author's source.

Measured, and this is why it cannot be left for later: **it does not fail. TypeScript error-recovers,
so the run looks completely normal while checking less.** The same component, differing only in where
the block sits among the attributes:

```
block LAST  :  half-built-keyboard-path  positive-tabindex  unnamed-image
block FIRST :  unnamed-image
```

Two accessibility faults vanish, exit code 1 either way. **And the certificate lands on the same
requirement**: `complete` fails on a reference the parser threw away, `plain` fails the moment
somebody papers over the blindness with a `ramonda-check-ignore`. A package whose source uses
`@( … )` cannot honestly certify until this is done.

`@ramonda/check` **may** depend on `@ramonda/css`. The forbidden direction is the other one.

### K — the format and lint wrapper

Two different answers, both proved in `prototype-tooling.mjs`:

- **Lint**: run on the virtual file and map back. `oxlint --format=json` gives offset, line, column.
- **Format**: a placeholder, not a map — a formatter rewrites text rather than reporting positions.
  Replace the block with something that parses, format, put the block back. **Copy the formatter's
  own indentation rather than counting columns**, or it returns with spaces inside a tabbed file.

*A suppression comment cannot substitute for this: `biome-ignore` is read BY the parser, which has
already failed.*

### F — the esbuild adapter, and J — per-route splitting

**J is high priority rather than someday**, by the user's call, and it is cheaper than it sounds:
**the CSS follows the JavaScript chunk.** A block belongs to the module it was written in, the
bundler already decides which modules land in which chunk, and `AsyncLoad`'s dynamic import is what
creates one. A route that is already code-split gets its own stylesheet from a decision the bundler
makes anyway. `ramonda-check --split` already reports the same `its own` / `shared` division — 266
split points on `apps/docs` — which is not a dependency this package may take, but does mean the
shape is understood.

Starting with one sheet is safe because **no syntax, type or compiled value changes when splitting
lands.**

### M — a TextMate grammar, for every tool that only colours

A third category of tool neither works nor stops: **highlighters render the wrong colours.** A `.tsx`
fence containing `@( … )` is read by the documentation site, editors' markdown previews, npm's README
rendering and GitHub's diff view.

**Available today at no cost: do not label the fence `tsx`** — the code is not TypeScript, and both
this repository's site and GitHub fall back to plain text for a language they do not know. Plain
beats wrong.

**The real answer is a TextMate grammar, which is the same grammar the editor plugin needs** — one
piece of work seen from two sides. Whether the site can load it is untried: one Shiki injection
attempt here changed nothing about the output. **GitHub and npm cannot be taught without upstreaming
a grammar**, so a fence there stays plain, which is an acceptable end state.

### L — the runtime diagnostic. Deliberately last

A `css` value reaching the runtime that no transform produced must be reported rather than silently
doing nothing. **The user's reasoning for putting it last is worth keeping:** diagnostics are this
framework's signature, which is exactly why this one should be written against a feature that has
stopped moving.

---

## Do not re-measure these

Every row was run, not reasoned. Re-deriving them is the main way to waste a week.

| | result |
|---|---|
| the syntax vs `tsc` / esbuild | both refuse it at the PARSE step |
| a hole type-checked in its real scope | a real `TS2339` at the author's line and column |
| a property-name typo | `TS2561 … Did you mean to write 'display'?` |
| a value typo | `TS2820 … Did you mean '"flex"'?` |
| a hole typed by its property | `TS2322` on `padding: {{nekaFunc()}}` |
| a template-literal length type | catches `10pxx`, prints an unreadable expanded union |
| transform cost | **+2.6%** over esbuild; 15–22 µs/file, linear |
| bail-out on an unused codebase | 1,268 files, 10.61 MB, **1.33 ms** |
| the generated `style={{…}}` object | `RMD020` on every render |
| the same as a string / prop | silent |
| SSR values | travel in the markup; no channel, no registry |
| hydration, four directions | two fail, and both are the `undefined` rows |
| N instances | **one rule at any N**; 30–73 B per instance |
| hash length | 8/12/16 hex all gzip to **46.7 KB** — length is free |
| `@(expr)` in decorator position | **already valid TypeScript** |
| `ramonda-check` on the raw source | error-recovers; 3 rules become 1, silently |
| source maps through both transforms | **5 of 5** positions land on the author's line |
| the test runner | reached, and `enforce: "pre"` is required |
| `biome-ignore` / `oxlint-disable` | useless — read BY the parser, which already failed |
| lint through the virtual file | real diagnostics, author's lines |
| format through a placeholder | whole file formatted, block restored |
| the docs example gate | **skips silently** — "not standalone code", exit 0 |
| a `tsx` fence containing the syntax | mis-highlighted everywhere; unknown languages fall back to plain |
| a hostile hole value through `cssText` | injects — `position: fixed`, `width: 100vw`, real and applied |
| the same through `setProperty` | no second declaration, on the client |
| the same through a SERVER render and back | **injects** — the parse re-reads the style attribute. Refused at the value now |
| a hole differing across hydration | **silent**, and the client's value wins — supersedes the object-style reading |

## Still open

- **The tooling decision.** A file using this cannot be read by biome or oxlint directly. Track K
  turns that into "our tooling" rather than "no tooling", but it stays a deliberate choice.
- **Nesting depth in v1** — `&`, pseudo-classes and `@media` are recommended; anything deeper waits.

## How to work here

- **Plant the shape, then measure.** Never read the code and reason about it. Every number in this
  file came from a run, and several contradicted what reading suggested.
- **A failing test first, then the fix.** No exceptions.
- **`@ramonda/css` may not import the framework**, in any direction, at any depth. The precedent is
  `@ramonda/lens`: zero dependencies, not even a peer.
- The prototypes are runnable and each proves one claim:
  ```
  node packages/css/prototype-typecheck.mjs packages/css/example.tsx.txt
  node packages/css/prototype-transform-cost.mjs [files] [blocksPerFile]
  node packages/css/prototype-sourcemap.mjs
  node packages/css/prototype-testrunner.mjs
  node packages/css/prototype-tooling.mjs
  node packages/css/prototype-scale.mjs [instances]
  node packages/css/prototype-bailout.mjs
  ```
