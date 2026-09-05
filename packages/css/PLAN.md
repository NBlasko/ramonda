# Building `@ramonda/css` — the plan

**Read `DESIGN.md` first, then `CONTRACT.md`.** `DESIGN.md` carries the reasoning and every
measurement; `CONTRACT.md` carries the four decisions both halves are written against, and its code
is in `src/`; this file carries only the order of work, what blocks what, and what may run beside
what. Where they disagree, `CONTRACT.md` wins on the shapes and `DESIGN.md` on the reasons — this
file is the one that goes stale.

**Phase 0, track B, A1, A2, track C, D, G, A3, E, H, I, I2 and K are done.** The contract is written and implemented; the framework
takes a `css` prop and applies it; the parser and transform turn a file into valid TSX with a source
map that lands on the author's own line and column; the virtual file gets that file type-checked
by `tsc` with every diagnostic mapped home; and the property map is generated from MDN's data, so a
property name and 123 properties' values are checked for real; and `ramonda-css` runs all of that
over a whole project and exits non-zero; and the Vite plugin plus the sheet turn a block into a
class in a real stylesheet, proved by real builds; and the language service plugin gives an editor
completion, hover and the right squiggles inside a block that is still being typed; and both tools
that read the author's source — `ramonda-check` and the docs example gate — read it through the
virtual file, each with the blindness reproduced first and a floor asserted after; and the CSS
checker owns the faults the types deliberately cannot catch, with every boundary measured against
them first; and the formatter and the linter read a file with a block through wrappers over the
project's own tools. **Everything else is unstarted** — and the next thing is not a track: **put a
block in `apps/playground-core` and point its scripts at the wrappers**, so `pnpm check` passes with
one in the tree. Measured before K: `ramonda-css` and `vite build` already handle it, and biome,
oxlint and `tsc` were the three that refused. After that, **F** and **J** — esbuild and per-route
splitting, which A3 made nearly free.

---

## What is being built, in three sentences

A `css` block written in real CSS beside the markup, with `{{expr}}` holes. At build time the static
declarations become a class in a stylesheet and each hole becomes a CSS custom property carried on
the element. The syntax is not TypeScript, so the package owns a parser and a virtual-file layer —
the same way JSX is usable because somebody wrote the parser for it.

```
<div css=@@(
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

### Track C — the property types. **DONE.**

`scripts/build-css-properties.mjs` writes `packages/css/src/properties.generated.ts` from MDN's own
CSS data — `mdn-data`, **CC0-1.0**, public domain with no condition attached. `pnpm check` runs it
with `--check`, so the map cannot drift from the data it came from.

**551 non-prefixed properties, 123 of them a closed keyword set.** The other 428 are
`string | number` and their typos are track D's.

**`display` is one of the 428, and DESIGN.md said it was an example of the other kind.** Its grammar
allows `inline flow-root`, so a union of its single keywords would reject valid CSS. That is the line
this holds and it is not negotiable: **rejecting valid CSS is the one failure a type map may not
have**, so a union goes only where the grammar is genuinely closed — measured, not felt. `position`,
`flex-direction`, `text-align`, `float`, `object-fit`, `mix-blend-mode`, `visibility`, `user-select`
and 115 others are; `display`, `align-items`, `overflow`, `cursor` and `white-space` are not, because
each genuinely takes combinations.

**Three things every union also has to allow**, each a false error before it was added and each
measured: the CSS-wide keywords (`inherit`, `initial`, `unset`, `revert`, `revert-layer`), `var(…)`
with or without a fallback, and `!important`. They are folded into one named alias, `Keyword<…>`, and
the NAME is what keeps the message readable — TypeScript prints the alias instead of expanding the
union:

```
TS2820: Type '"statik"' is not assignable to type
  'Keyword<"fixed" | "absolute" | "static" | "relative" | "sticky"> | undefined'. Did you mean '"static"'?
```

**Vendor prefixes are an index signature, not a list.** A hundred prefixed names are in MDN's data
and more are not, so `` `-${string}` `` accepts all of them — and the same signature is what lets an
author declare `--brand`. It costs nothing that matters: a key NOT starting with `-` still has to be
a real property, so `dsiplay` is still an excess property with a suggestion beside it.

**What it costs to check.** Measured against the same program without blocks: 200 files each carrying
one block is **+22%** (347 ms against 284 ms, most of which is `lib.d.ts` either way); 50 files is
+3%. The suggestion survives 551 keys, which a five-property fixture could never have shown.

The original description, kept because it is what was built:

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

### A1 — the parser and the transform. **DONE.**

`src/compiler/`: `scan.ts` finds the blocks, `read.ts` parses one into a `Block` and records where each
expression's bytes are, `transform.ts` emits, and `errors.ts` refuses with a position. Exported from
`@ramonda/css/compiler` at two levels — `transform` for a bundler plugin, and `findBlocks`/`readBlock`
for the virtual-file layer, which produces a different file from the same reading.

**What it measured, and one number in the table below was wrong:**

- **The bail-out is free**, as promised: 1,290 files and 10.73 MB of this repository in **0.84 ms**,
  scan included. Eight files say maybe — the ones that document the syntax — and none holds a block.
- **The whole transform is +9.7% on top of esbuild**, 58.8 µs/file, on a corpus where every component
  carries four blocks. The prototype's **+2.6%** was measured on a transform that built no AST, did
  not normalise, did not hash and produced no source map; it is replaced below rather than kept.
- **The map's resolution is not the obvious setting.** Generating it is about half the transform's
  cost. All three settings get every LINE right, including inside an expression spanning four of
  them. `hires: false` is 26% cheaper and collapses every COLUMN to the start of its line — for the
  whole file, not only near a block, because this map sits above the bundler's. `hires: "boundary"`
  costs what `true` costs and carries half the mappings, and is what is used. There is a test.

**Two things the writing found that the requirements list did not have:**

- **A closing paren has to be handled to the end, not fallen through.** `url(a.png)` decrements the
  depth to zero and the next test then reads the `)` as the block's own closer — measured,
  `background: url(a.png) no-repeat` came out as `background:url(a.png;`, and
  `@media (min-width: 40rem) { … }` stopped being a rule at all.
- **A shebang is not JavaScript and is not a comment.** Nothing in the language skips one, so `@(`
  written in a shebang line would be read as a block on a line the engine never parses. The scan
  skips it, and so does the place the hoisted prologue goes.

The original requirements, kept because they are what was built:

**Input** a source file, **output** the transformed code, a source map, and the blocks it found.

Requirements, each of which came out of a measurement rather than a preference:

- **Bail out on a substring scan** before parsing anything. Measured: 1,268 files and 10.61 MB in
  1.33 ms. A codebase using none of this must pay nothing.
- **The scan is lexically aware** — strings, templates, comments — because finding `=@@(` is not the
  same as knowing it is a JSX attribute. Measured at ~450 MB/s, a fifth of the total cost.
- **The opening is `@@(`, and the second `@` was bought.** `@(expr)` is *already* valid TypeScript in
  decorator position — `class C { @(dec) m() {} }` compiles, and so does
  `constructor(@(inject()) private x: number)`. This is a decorator-heavy framework, so this is a permanent
  test, not a note.
- **Replace only the CSS BETWEEN the expressions, never the expressions themselves.** Found by
  getting it wrong: overwriting a block in one span made a hole report line 8 instead of line 13.
  Writing the gaps out one at a time costs nothing and keeps every expression's own bytes.
- **Refuse a hole outside a value position** — a property name, a selector, a whole declaration —
  with the source position.

*Size: large. Risk: medium, and it is the parser rather than the transform.
Start from `prototype-transform-cost.mjs` and `prototype-sourcemap.mjs`.*

### A2 — the virtual file, and mapping back. **DONE.**

`src/compiler/virtual.ts`, plus a new entry `@ramonda/css/properties` holding the shape a block is
checked against — `CssBlockShape`, whose three template-literal index signatures let a nested rule,
an at-rule and a custom property through while a key matching none of them is still an EXCESS
property, which is the whole point. `CssProperties` inside it is a placeholder and is track C.

Proved by a real `ts.Program` in `src/__tests__/virtual.test.ts`, not by argument: a property typo,
a value typo, a hole typed by its property, a typo inside a nested rule, and a name that does not
exist — each with the diagnostic mapped back to the author's own line and column, and a control that
a correct block reports nothing at all.

**Two things the measurements found, and the first changes the headline.**

1. **A quoted key gets no *did you mean*.** The same typo against the same type:

   ```
   { dsiplay: "flex" }     TS2561 … Did you mean to write 'display'?
   { "dsiplay": "flex" }   TS2353 … and '"dsiplay"' does not exist in type
   ```

   TypeScript's own suggestion — the headline of the type-safety claim — hangs on whether the emitted
   key needed quotes. So a name that is a valid identifier is now written bare, and `display`,
   `color`, `padding` and every other single-word property get the good message. **A dashed name
   cannot be written bare, so `flex-direction` and `border-left` get the plain message.** The
   alternative is camelCase keys, which would suggest `flexDirection` to somebody writing CSS and
   would need a rewritten compiler message to be usable — rejected. **Naming the near miss for a
   dashed property is track D's**, where the message is one we write.

2. **Where a diagnostic lands depends on its kind.** TypeScript reports an object literal's
   assignability errors at the property assignment, whose start is the key; an error about a name
   inside an expression is reported on the name.

   | written | reported | lands on |
   |---|---|---|
   | `dsiplay: flex` | `TS2561` | the property |
   | `display: flexx` | `TS2820` | the property |
   | `padding: {{this.size}}` | `TS2322` | the property |
   | `color: {{missing}}` | `TS2304` | the **expression** |

   Nothing to fix in either — but a caller printing a caret has to know that a value error points at
   its declaration.

Two spans were added to the parsed block to make any of this possible: where a property name starts
and where its value does. They are provenance, normalisation never reads them, and a block built by
hand has none.

The original description, kept because it is what was built:

**Two things go into the virtual file, and the second is what makes CSS type-safe at all:**

- each hole's expression, in its real lexical scope;
- each block as an **object literal** typed `Partial<CssProperties>` — an object literal, because
  that is what gets excess-property checking and therefore TypeScript's own *did you mean*.

*Size: medium. Risk: low — `prototype-typecheck.mjs` already does the mapping, and
`prototype-sourcemap.mjs` proves it survives esbuild underneath (5 of 5 positions).*

### A3 — the Vite plugin. **DONE.**

`@ramonda/css/vite`, and an app writes one line: `plugins: [ramondaCss()]`. **Nothing else — there is
no stylesheet to import**, and that is a measurement rather than a convenience.

Proved by three real Vite builds in `src/__tests__/viteBuild.test.ts`, not only by calling the hooks:
the class in the emitted JavaScript is the class in the emitted CSS, a `.css` asset exists at all,
and an unreadable block fails the build at the author's own line and column.

**What the real builds found, and the first one is a design change.**

1. **One stylesheet for the whole app shipped NO CSS.** The entry imported it, Rollup loaded that
   module before the styled file had been transformed, the sheet was empty — a green build with an
   unstyled page. **A bundler does not wait for the transform to finish.** So each file gets its own:
   the plugin appends `import "<file>?ramonda-css.css"` to the file whose blocks produced the rules,
   the ordering problem cannot arise, an app imports nothing, and **the CSS follows the JavaScript
   chunk** — which is what track J needs and is now free. **Dedupe is the CLASS, not one copy of the
   rule**, and that was a correction: an owner-per-rule shipped one lazily-loaded route naming a class
   no stylesheet in the build contained. Each file serves every rule it names; measured, that is 3.5x
   the bytes and 1.1x gzipped on a corpus built to duplicate every rule three times.
2. **Vite's `loc.column` is 0-based**, and the type says `column: number` and nothing else. Vite
   echoes whatever it is given, so a wrong base is a caret one character off and no error anywhere
   to find it. Measured against a real parse error at a known position: `@` on 1-based column 20 came
   back as `1:19`, caret under it.
3. **A file that loses its LAST block must still be told to the sheet.** Returning early left its
   rules in place for the life of the dev server, and left the class name claimed — so re-adding an
   edited block collided with what it used to be. Found by a failing test.
4. **Ownership moves, and nothing in the module graph says so.** When a file stops using a shared
   block, another file gains the rule — and that file never changed, so only the plugin can invalidate
   its stylesheet.

The original requirements:

- **`enforce: "pre"` is a requirement, not a preference.** Measured: without it the plugin runs after
  Vite's own esbuild step, which has already refused the file. The same ordering applies to the dev
  server, the build, and the test runner.
- Serve the stylesheet as a virtual module so HMR can replace one file's chunk without touching
  JavaScript.
- Cache on content hash; the transform is a pure function of the text.

*Size: medium. Risk: low. `prototype-testrunner.mjs` runs the ordering test both ways.*

---

## What unblocks after the spine

### D — the CSS checker rules. **DONE.**

`src/compiler/rules.ts`, four rules, run from `ramonda-css` and from the editor plugin. It imports
nothing from `@ramonda/check`: a rule here reads a parsed `Block`, not a `ts.Program`, so there is no
value to follow and no declaration to resolve.

**Every boundary was measured against the real type check before a rule was written**, so nothing
here repeats a diagnostic somebody already gets:

| written | the types | the rules |
|---|---|---|
| `dsiplay: flex` | `TS2561`, **with** *did you mean* | — |
| `flex-dirction: row` | `TS2353`, **no suggestion** | `unknown-property` |
| `position: statik` | `TS2820`, with *did you mean* | — |
| `display: flexx` | **silent** | `unknown-value` |
| `border-left: 4px sollid red` | **silent** | `unknown-value` |
| `color: red; color: red` | **silent** | `repeated-declaration` |
| a hole in a property name or selector | the build refuses | `hole-out-of-place` |

**Two narrowings, and each is the whole rule.**

`repeated-declaration` fires only when the VALUE matches too. Two declarations of one property with
different values is a deliberate idiom — `width: 100px; width: fit-content;` is a fallback for an
engine that will drop the second — and reporting a technique is how a checker earns being switched
off.

`unknown-value` reads only BARE WORDS, and only for properties whose grammar admits no arbitrary
identifier. That classification was got wrong first: "is the grammar closed" left `border-left`
alone, because `<length>` and the colour functions do not resolve to keywords — yet neither can ever
BE a bare word, so `sollid` was provably wrong and was being missed. The question that matters is
whether an arbitrary identifier is admitted, which is what makes `animation-name: slidein` and
`font-family: Helvetica` untouchable.

**One sweep writes both generated files now.** The checker needs the bare words each property
accepts AND needs to know which properties the types already cover — the same classification asked
twice, and two scripts computing it would be a place to drift. `build-css-keywords.mjs` is gone;
`build-css-properties.mjs` writes both and `--check` compares both. **551 properties, 123 typed as a
union, 276 value-checkable by the rules.**

**`PROPERTIES` is not the keys of `KEYWORDS`, and the difference is load-bearing** — asked in review.
The first is all 551 names, because the near-miss search is about the NAME; the second is the 276
whose values may be judged. `flex-direction` is absent from the second and must be in the first, or
`flex-dirction` could never be suggested, which is the rule's headline case. There is a test.

**And one report per fault.** `ramonda-css` drops a `TS2353` at a position `unknown-property` also
names: same fault, and the rule says it with the suggestion the compiler cannot offer. Measured
before it existed — `flex-dirction` came back twice, once usefully.

Run over a block of twenty ordinary declarations — shorthands, functions, a font stack, an animation
name, a nested rule, an at-rule, a custom property, a vendor prefix: **zero findings**.

### E — sheet assembly. **DONE.**

`src/compiler/sheet.ts`, exported as `Sheet` from `@ramonda/css/compiler`. All three assertions are
implemented and tested, and one thing about the shape changed: **the sheet is asked per FILE**, for
the ordering reason in A3 above, and dedupe is preserved by ownership rather than by a single output.

`verify` is written and tested and **nothing calls it yet**. It is the round-trip assertion, and it
belongs wherever the final stylesheet is available after post-processing — which for a Vite build is
a `generateBundle` hook that does not exist yet. Written now because the reasoning was fresh; wiring
it is the next thing on this track.

The original description:

The transform is deliberately local — no cross-file analysis — which is what makes it cacheable and
incremental. **Assembly is where the whole picture exists**, so three things live here and nowhere
else:

1. **Dedupe.** Identical blocks are one rule, by hash.
2. **The collision assertion.** No two distinct blocks may share a class. This is the *guarantee*;
   the 16-hex name only decides that it never fires.
3. **The round-trip assertion.** After any post-processing, every emitted class must still be present
   and every `var(--…)` still referenced — a minifier is allowed to merge and rename.

Plus `@layer`, so a hand-written stylesheet predictably wins.

### G — the check command. **DONE.**

`ramonda-css [tsconfig.json]`. `src/check.ts` is the testable half — a real tsconfig, the virtual
files overlaid on the ones on disk, one `ts.Program`, every diagnostic mapped home — and `src/cli.ts`
is the shell that prints and exits. `bin.mjs` is committed for the reason `@ramonda/check`'s is: a
bin that IS a build output cannot be linked before it is built.

**It reports everything, not only the blocks.** A project using this syntax cannot run plain `tsc`,
so this IS its `tsc`; a report that dropped ordinary type errors would look like a passing check on a
program nothing checked.

**Three things came out of writing it, and two changed the virtual file.**

1. **TypeScript reports one failure per object literal and stops.** Measured: a block with a name
   typo, a value typo and a wrong hole reported ONE of them, and the author would meet the next on
   the next run — worse, which one it reported depended on the kind, not the order. So the virtual
   file now writes **one literal per declaration, gathered in an array**, and a nested rule holds an
   array of its own. Every fault in a block arrives at once, each with its own position and its own
   suggestion. It costs: the type check goes from **+22% to +37%** over the same program without
   blocks, at 200 files each carrying one. Worth it — 118 ms in CI against three round trips for a
   person.
2. **A block shape that does not resolve would have passed silently.** If `@ramonda/css/properties`
   cannot be found — not installed, `paths` unset, the export renamed — every block is `any`, nothing
   is checked, and the diagnostic saying so lands in the preamble, which is scaffolding, which is
   dropped. So the preamble is the one scaffolding a caller may not drop: a diagnostic inside it is
   reported once, whatever the project's size. Found by chasing an uncovered line.
3. **A refusal stops everything.** A compiler does not type-check a program it could not parse, and
   carrying on would mean serving `tsc` either the unreadable file — a cascade of parse errors nobody
   wrote — or a stub, which turns one real fault into a screen of "has no exported member".

The original description:

`tsc` over the virtual file, diagnostics mapped home, a non-zero exit. **Without this, type safety is
a claim about editors rather than about CI.**

### H — the language-service plugin. **DONE.**

`@ramonda/css/plugin`, added to a tsconfig's `plugins`. Tested against a real `ts.LanguageService`
with the proxy in front of it — the arrangement `tsserver` builds — and every question asked at a
position in the AUTHOR's file.

**Four things this needed that the one-line description did not have, and each was measured.**

1. **The parser had to learn to read a HALF-WRITTEN block.** Strict refuses `disp`, and `disp` is the
   state you are in while typing `display`; `&:hover { col }` refuses too. A refusal means no virtual
   file, which means no completions exactly when they are wanted. So `tolerant` is a second MODE of
   one parser — strict stays the default, and the build still refuses, because a block it cannot read
   has no correct compilation.
2. **Completion needs the caret INSIDE the token.** Measured on a plain object literal: inside a
   half-typed key gives the property names, inside a half-typed value gives the value union, and
   immediately after a complete key gives one useless entry. So the author→virtual mapping lands
   inside rather than at an edge.
3. **A caret that has typed nothing belonged nowhere.** Three of the four "nothing typed yet"
   positions got zero completions — an empty block, a blank line after a declaration, the position
   after a semicolon — because no run of text claimed the caret. An empty object literal per block
   gives it somewhere to be. All nine caret states are now tests.
4. **A virtual SPAN needs one lookup, not two.** A span over a rewritten run ends exactly at that
   run's edge, where the next virtual text is punctuation this file invented — so the end mapped
   nowhere and a `dsiplay` diagnostic highlighted nothing. `spanOf` asks the run how much of the
   author's text it stands for.

**And the plugin is CommonJS, which is measured rather than conventional.** `tsserver` requires a
plugin synchronously and then checks `typeof factory === "function"`. On Node 24 `require()` of an
ESM module works — and returns the module NAMESPACE, an object — so an ESM-only plugin is **silently
skipped**, logged at info level where nobody reads it. Hence `dist/plugin.cjs`, with the default
export hoisted to be `module.exports` itself.

Both diagnostic kinds come from the virtual file, and the syntactic one has to: the author's file does
not parse as TypeScript, so the real service reports the block itself as a syntax error — a red
squiggle on correct code, which is the loudest way for a tool to be wrong. There is a test that the
real service does report it and the plugin does not.

The original description:

Serve the virtual file as the script snapshot, map back. Completion inside a block then *is*
object-literal completion. Without this the feature is technically safe and practically unusable.

### I2 — the docs example gate reads through the virtual file too. **DONE.**

`shape()` turns a block holding `@@( … )` into its virtual reading before it tries any wrapper, and
`SELFTEST=block` plants a wrong example so the floor is asserted rather than assumed — proved to fail
by removing the fix. It runs in `pnpm check` and in CI, beside the ordinary run.

**Reproduced first with the real script**, on a wrong example planted into a real README: skipped in
silence, exit 0. The reading here is STRICT, not tolerant — a documented example of a syntax is
exactly the place a malformed block must be caught.

**And it needed the virtual file to preserve LINES**, which it did not. The gate reports by line and
has no source map to consult; a multi-line block collapsed to one line, so everything below it moved
up, and the preamble added one more. Measured: a nine-line file became seven. The first fix put the
newlines after the block and was measured wrong too — every declaration then sat on the block's
opening line, so a typo on 187 was reported on 185. They go BETWEEN the items, and now every line is
the author's own line, inside a block as well as outside.

**This makes the docs gate the sixth consumer of the transform** — after the build, `tsc`, the
editor, `ramonda-check` and the test runner.

### I — `ramonda-check` reads through the virtual file. **DONE.**

A compiler host in `analyze.ts` serves the virtual reading of any file holding a block, under the
file's own name — so module resolution does not move. The reading is TOLERANT: a checker reports what
it can see, and a half-written block in somebody's buffer is not a reason to stop analysing the file
it is in. Whether the block is well formed is `ramonda-css`'s answer, and that is the one that fails
a build.

**Reproduced with this package's own CLI before the fix**, exactly as predicted — three findings
became one, exit code unchanged. The test writes its project to a temp directory rather than adding a
fixture: a `.tsx` holding `@@( … )` cannot be read by this repository's formatter or linter, and there
is no reason to make that the repository's problem.

`@ramonda/css` is a devDependency of `@ramonda/check`, bundled the way `@ramonda/dom-facts` is — so
the checker still publishes with **no runtime dependency at all**, which is the property that lets it
run first in a build. Verified: `magic-string` is tree-shaken out, because the virtual file needs no
emitter.

The original description:

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
`@@( … )` cannot honestly certify until this is done.

`@ramonda/check` **may** depend on `@ramonda/css`. The forbidden direction is the other one.

### K — the format and lint wrapper. **DONE.**

```
ramonda-css format <paths…>   # --check to report instead of writing
ramonda-css lint <paths…>
```

Neither is a reimplementation: the project's own biome and oxlint do the work, with their own
configuration, and this only decides what text they are shown.

**Both find their configuration from the working directory, and that is what makes it possible.**
Measured, because a wrapper that quietly lost a project's rules would be worse than none: `oxlint`
given a file OUTSIDE the repository, run with the repository as its cwd, applied the same **93
rules** and reported the same findings as for one inside it. `biome` takes text on stdin with
`--stdin-file-path` and answers with the project's own `lineWidth` and indentation — so the formatter
writes no temp file at all.

**Two answers, because the tools want different things.** The linter gets the virtual file, the same
one `tsc` gets, and its diagnostics are mapped home. A formatter cannot work that way — it rewrites
text rather than reporting positions in it — so the block is replaced by something that parses, the
file is formatted, and the block goes back at the indentation the formatter chose. Copied, never
counted: a block re-laid with spaces inside a tabbed file is one the formatter disagrees with on the
next run, an edit that never settles. There is a test in a tabbed project.

**What the writing found, and one was the silence this package keeps meeting.**

- **A decorator file linted CLEAN, silently.** `mayHoldABlock` says maybe — `@(` is also a decorator
  — and a file that turned out to hold no block returned no findings at all instead of being linted
  as it is. Found by a test that expected one finding and got none.
- **A tool that fails answered with our call stack.** A formatter can refuse for reasons that have
  nothing to do with a block, and the only useful sentence is its own. It is caught and printed now.
- **A broken `biome.json` is not a way to make it fail**, which had to be measured: biome reads its
  config where it can and formats with its defaults otherwise — same text back, exit 0. So that claim
  is asked of a tool that really does refuse.
- **The two `.bin` shims cannot be symlinked on their own.** Each resolves its own package relative
  to itself. A fixture linking them alone got `Cannot find module`; a real project has the tree.

*A suppression comment cannot substitute for any of it: `biome-ignore` is read BY the parser, which
has already failed. Measured — biome answers "Code formatting aborted due to parsing errors" with the
comments in place. That is also what makes the comparison with a CSS-in-a-backtick library
misleading: a tagged template is already valid TypeScript, so the tool parses the file, sees a string
and looks no further. Here there is no region to ignore, because there is no region at all.*

### F — the esbuild adapter — DONE

`@ramonda/css/esbuild`, and nearly all of it is the same: one `Sheet`, one stylesheet module per
source file, the class named after the hash. What changes is only how a plugin is told about a file
and how a virtual module is spelled.

**esbuild hands a plugin a PATH, not the code**, and that is the whole cost. Measured on 400 tiny
modules, none holding a block:

| | |
|---|---|
| esbuild alone | 11.4 ms |
| a plugin that does nothing but be asked | +12%, 3.4 µs/file |
| …and reads the file | **+60%, 17.3 µs/file** |
| …and does everything this one does | +60%, 17.1 µs/file |

**The read is the whole cost.** This package's own work on top of it is 0.3 µs/file — the cheap
substring is as free here as everywhere else. Reading bytes without decoding them is not faster
(+62%), so it is the syscall rather than the UTF-8, and minifying with source maps does not dilute it
(+61%), because esbuild's minifier is that fast.

**The obvious fix is worse than the cost**, and that was measured too. Handing the contents back so
esbuild does not read again means CLAIMING the file: no other `onLoad` plugin is offered it, and the
loader has to be named. Contents returned with no loader are parsed as plain JavaScript — *"The JSX
syntax extension is not currently enabled"*, on every file. So it declines, and `filter` is the lever
a project has.

**Two things had to be got right that Vite never asks about.** A transformed file needs its loader
named — and a value block can live in a `.ts` file, where there is no JSX at all, so it cannot simply
be "the JSX one". And `onEnd` sees the output only if the build was asked in a way that keeps it:
`write: false` hands back the text, `metafile: true` names the files on disk, and with neither there
is nothing to check — the same answer the Vite plugin gives a build that emitted no stylesheet.

**The declared shape has to fit through esbuild's, not merely resemble it.** A plugin whose `loader`
is typed `string` is not assignable to esbuild's own `Plugin`, and a user passing it in gets a type
error about a variance three levels down.

### J — per-route splitting — DONE, and nothing was written for it

**The CSS follows the JavaScript chunk**, because each module imports its OWN stylesheet. That was
A3's design decision and this is the measurement that it does what it promised. A block was put in
`apps/playground-core`'s lazily-loaded module and the app built:

```
dist/assets/HeavyPanel-DFc0Nv7V.css    0.08 kB
dist/assets/index-FR6XzZLB.css         1.13 kB
```

Two stylesheets, and **disjoint**: the lazy module's rule is in its own sheet and not in the entry's,
and the entry's rule is not in the lazy one. Nothing in this package splits anything — the bundler
already decides which modules land in which chunk, and the per-file stylesheet is what lets that
decision carry the CSS with it.

**It is a gate rather than a note**, `scripts/check-css-splitting.mjs`, because the failure mode is
silent in the wrong direction: going back to ONE sheet would look like a simplification, the app
would still work, and every route would carry every rule. The gate asks the two things that can only
be true if the split happened — no class in two sheets, and no class in a sheet that no chunk names.

### M — a TextMate grammar, for every tool that only colours — DONE

A third category of tool neither works nor stops: **highlighters render the wrong colours.** Measured
on the tsx grammar alone, every token of a block came back with the theme's INVALID colour — and so
did every line BELOW it, to the end of the file. A block on line 243 made `const after = 1;` on line
259 look broken.

**Two injections, in `packages/css/vscode/grammar/`.** One is aimed at a JSX tag and scopes
`name=@@( … )` as embedded CSS; the other is aimed at the CSS a block scopes, and gives `{{ … }}` back
to TypeScript. **The hole has to be a SEPARATE injection**, because `{{` in ordinary JSX is
`style={{…}}` — a pattern in the tag-level grammar would colour every inline style object as CSS.

**A grammar does not have to be judged by screenshot.** It is a function from text to scopes, and
shiki carries the same engine an editor does, so every claim is a test —
`src/__tests__/grammar.test.ts` asserts the scope of the opening, the property, the value, the hole,
the close, and that everything below a block is ordinary TSX again.

**The trap that cost three wrong readings:** `codeToTokensBase` merges adjacent tokens that share a
colour, and reading `explanation[0]` of a merged run reports one scope for all of them. The grammar
was working while I read it as broken, twice. Every explanation has to be walked.

**The site loads it** — the earlier note that one injection attempt "changed nothing" was wrong, and
the wiring is now in `apps/docs/scripts/highlighter.mjs` with the SAME two files the editor gets.
`apps/docs/src/__tests__/highlight.test.ts` holds the claim a reader can check: a declaration is the
same colour inside a block as it is in a `css` fence. Verified by unwiring it — three of its claims
fail. A hole is not among them: it comes out the theme's plain text colour either way, so its scope
is asserted in this package instead, where scopes are visible.

**The extension is `packages/css/vscode/`**, linked into an editor by `node vscode/install.mjs`
rather than copied, so the grammars the tests read are the grammars the editor loads. Its manifest is
gated too — a `scopeName` is written twice, once in the grammar and once in the contribution, and a
typo in either installs cleanly, activates cleanly and colours nothing.

**Three faults the first sample did not have, all found on the REAL file:**

- **prose that mentions the syntax opened a block.** `<p>a `css=@@( … )` block</p>` matched in JSX
  TEXT, and the block it opened never closed — the rest of the file was CSS. The injection selector
  excludes `meta.jsx.children`, strings and comments now.
- **a block is not always the last attribute.** The first `end` required the closing paren to be
  followed by `>` or `/`, so `css=@@( … ) id="x"` never closed. A bare `)` is right, and safe: a paren
  inside a block is always inside something — `calc(…)`, `url(…)`, a hole's own call — and a child
  construct is consumed before an end is tried.
- **the language service was painting the file too, and nobody had mapped it.** Not a grammar fault
  at all — see below.

**The boundary, and it is the ENGINE's:** an injection is only consulted while the tsx grammar is
still in the tag itself. The moment it enters `meta.tag.attributes.tsx` — which a second attribute
does, and so does a newline after the tag name — NO injection fires. Proved with a grammar that does
nothing but match one word: it colours a first attribute and is never asked about a second. So a
block is coloured when it is the **first attribute, on the tag name's own line**. Outside that, the
file reads exactly as it would with nothing installed, which is what the tests assert — sameness
against a control, because what the tsx grammar makes of a syntax it was never told about is its own
affair.

**Nesting is the block's own, because the editors' CSS grammar does not have it.** Measured on a plain
`.css` file, `a { &:hover { color: red; } }` comes back with `&` as a PROPERTY, `hover {` as its
VALUE, and `color` inside coloured as a value rather than a property — one construct in two colours,
inside every block that hovers. The block grammar carries a `nested` rule and its own `&`, and the
negative lookahead in it is the hole: `{{` opens an expression, never a rule list.

**GitHub and npm cannot be taught without upstreaming a grammar**, so a fence there stays plain,
which is an acceptable end state.

### M2 — the OTHER half of the colours: the language service paints too

An editor paints twice — a TextMate grammar first, then semantic tokens from the language service on
top — and the plugin serves the VIRTUAL file to that service. Every span it reported was an offset
into text nobody wrote, and the preamble alone is hundreds of characters. Measured on a four-line
file, the spans sliced out `\nconst `, ` = <div css=` and `before, a, af`.

**It is worst ABOVE a block**, which is what made it look like a grammar bug: the shift is the same
for the whole file, so code with nothing to do with a block is painted just as wrongly. And it is
invisible to every test the plugin had, because a diagnostic is mapped and a colour is not.

**The belief that caused it is worth keeping**, because it was written down as a comment and it was
wrong: *what is not overridden falls through to the real service, which is reading the author's own
file.* It is not — the host is patched IN PLACE, so the service reads the virtual text for every
question anyone asks. Measured, the whole position surface was wrong at once: folding spans that
sliced nothing, an outline listing `__block` beside the author's own names, go-to-definition landing
on the empty string, a document highlight covering half the file.

**And mapping them was not enough — inside a block they had to be DROPPED.** Reported from a real
editor: `display` came out white and `flex-direction` blue, in the same block, and the two have
identical TextMate scopes. The difference was the semantic layer. `display` is a bare key in the
virtual file and gets a token; `flex-direction` has to be quoted and gets none — so a CSS property
was painted as a TypeScript property, at random, and a value was painted or not depending on its
spelling. **Inside a block the grammar is the authority**, and the exception is the hole, which
really is TypeScript: `this.weight` inside one reads the way it reads anywhere else.

Now mapped: semantic classifications, outlining, both outlines, definition / type definition /
implementation, references, the bound span, document highlights, signature help. **Mapped by FILE
NAME**, not across the board — an entry in another file already holds the position it should.

**And the edits are refused rather than mapped:** formatting, code fixes and refactors are computed
against the virtual text, so applying one would write scaffolding into the author's file. Refusing is
the honest answer, and `ramonda-css format` is what formats these files anyway.

### N — a block in expression position, which is two spellings and one case

**A defect first.** `DESIGN.md` had promised from the start that "because the compiled form is a
value, `@@( … )` outside JSX is the same feature with no special case", and the code did not do it: the
writer emitted the attribute form everywhere, so `const panel = @@( display: flex; )` compiled to
`const panel={_s0}` — an **object literal**, valid code meaning the wrong thing, with the type error
landing wherever the value was eventually used.

**And a second spelling that exists because of M's boundary**, not because two ways to write a thing
are nice: `css={@@( … )}`, a value in the braces JSX already has for one. Measured with the same
one-word grammar that found the boundary — an injection is consulted inside a braced attribute at
**every** position tried: second attribute, fourth line of a tag, even a value on its own line. So the
limit that no bare attribute can be coloured past the first one has a way round it that costs the
author two characters.

Both are the same case downstream: **replace the block, touch nothing to its left.** A bare attribute
is the odd one out — it is rewritten from its NAME, because the braces are ours to add.

**Telling them apart is a backwards walk, and its direction is chosen.** `css=@@( … )` and
`const panel = @@( … )` are the same three tokens to the scanner — whitespace, a name, `=` — so
`isAttribute` consumes attributes backwards (bare, quoted, braced, spreads, namespaced tag names)
until it reaches the `<` that opens a tag, and answers NO when it cannot prove otherwise. An attribute
mistaken for a value emits `css=_s0`, a syntax error the build reports at once; a value mistaken for
an attribute emits an object literal, which is the quiet kind of wrong.

**The grammar's lookbehind requires the `=`, and that is measured too.** Permitting a bare `{` before
the block colours more cases but swallows a parenthesised decorator written on the same line as a
class's opening brace — `class C { @(dec) m() {} }` lost `dec` entirely. Requiring `=`, `={` or `= {`
mirrors the compiler's own scanner and leaves every decorator alone.

### O — Prettier, the third tool that cannot read the file

Measured before anything was built: `prettier --parser typescript` answers *"SyntaxError: ')'
expected."* and refuses. Refusing is the safe half — nothing is mangled — but it breaks the gesture
every editor offers, and an editor whose default formatter is Prettier gives that answer on save.

**A printer, not a preprocessor.** Replacing every block with something that parses is easy; putting
them back is the problem, because **Prettier has no hook that sees the printed text.** A plugin gets
an AST and returns a document, and the core turns that into a string. So the placeholder has to be a
NODE, and `embed` — Prettier's own way of printing a node in another language — is what prints the
block where the node was.

**Three placeholder shapes were measured, and only the third works:**

| shape | what happened |
|---|---|
| a comment and a zero, `/*m0*/ 0` | the comment is printed by the comment machinery, not by `embed` |
| a plain string, `css="m0"` | Prettier prints a quoted attribute value ITSELF and never asks `embed` |
| a template literal, ``css={`m0`}`` | asked, and it hugs its braces — only a few node types may |

**The cost is one rewrite:** a bare `css=@@( … )` comes back as `css={@@( … )}`, because the
placeholder has to be braced for Prettier to ask about it at all. The two compile to the same class,
and the braced spelling is the one to reach for anyway.

**And the layout is relative, never absolute.** `literalline` keeps the author's columns, which is
wrong the moment the printer moves the block — measured, every format pushed it one step further in.
The block's inside is not re-laid: that is `ramonda-css format`'s business, not a JavaScript
printer's. The test that matters is that formatting twice changes nothing the second time.

### P — the check that was written and never called

`Sheet.verify` existed, was tested, and **nothing in the pipeline called it**. A safety net that looks
like it is there and is not is worse than none, and this one guards a failure that is invisible by
construction: the class name is written into the emitted JavaScript, so a minifier that renames or
drops a rule ships a page pointing at a class the stylesheet does not have. Nothing throws. The page
renders, unstyled, with nothing to blame.

It runs in `generateBundle` now, over the concatenation of every CSS asset — a rule may land in any
chunk. **A build with no CSS asset is not a failure**: an SSR build is the ordinary case, where the
client build is what writes the stylesheet, so there is nothing to check rather than everything to
report.

**Measured against a real minifier rather than an imitation of one**, because a check that cried wolf
on ordinary minification would be turned off within a day. esbuild's CSS minifier over a real sheet:
smaller, and every class and `var()` still named. And on a real `vite build` of `playground-core` the
hook runs and passes, with the same class in both the stylesheet and the JavaScript.

### Q — the editor says what only the editor knows

A bare block that is not the first attribute on the tag name's own line still compiles and is still
checked, and looks like an error — with nothing on the screen to say why, because what failed is a
grammar nobody can see. `uncolourable-block` is the plugin telling them, on the attribute name,
pointing at `css={@@( … )}`.

**A SUGGESTION, and the weight was the whole decision.** Every finding `checkBlock` produces makes
`ramonda-css` exit non-zero, and stopping a build because an editor will not colour something would
be wrong by a mile. So this rule is not in that path at all: it is computed from the SITE rather than
from the block's contents, it reaches only the plugin, and TypeScript's suggestion category is what
draws it as a hint rather than a squiggle.

### R — a missing semicolon, which nothing was reporting

Reported from a real editor, and the report was right: a `;` deleted mid-file and **nothing said
anything**. Measured, and it depended on the property:

| what was written | what an editor said |
|---|---|
| `dsiplay: flex` | an ERROR, TypeScript's own *did you mean* |
| `dis@play: flex` | an ERROR |
| `display: fl@ex` | two warnings — `display` accepts neither `fl` nor `ex` |
| `display: flex` with no `;`, `gap: 8px` under it | a warning — `display` does not accept `gap` |
| **`padding: 4px 0` with no `;`** | **nothing at all** |

`padding: 4px 0 border-left: 1px solid red` is ONE value to the parser, and `padding` is not among
the 123 properties whose values are a closed union — so the type layer has no grounds and
`unknown-value` has nothing to check against. The browser drops both declarations and the page
renders without the style.

**A colon inside a value is the tell**, and a good one: CSS values do not contain bare colons. The
three places one legitimately appears — inside a string, inside `url( … )`, inside any other function
— are exactly where the rule does not look, and a hole is skipped too, because what is inside one is
TypeScript.

### S — format on save, which is the fourth tool that cannot read the file

Reported: the Biome extension was installed and did nothing. Measured, twice over — a file holding a
block is EXCLUDED from `biome.json`, so the extension never looks at it; and with the exclusion
lifted, biome answers *"Code formatting aborted due to parsing errors"*. Prettier refuses the same
way, which is what its plugin exists for.

**`ramonda-css format --stdin-file-path <path>`**, spelled the way biome spells its own, because that
is what the wrapper reaches for underneath. An editor asks a formatter about the BUFFER, not the
file: a provider pointed at a path would format what was last saved and hand back edits computed
against text the author has since changed, which is how a formatter deletes work.

**The extension shells out to the PROJECT's own command.** Not a copy of the compiler: what runs on
save has to be what `pnpm format` runs, with the same biome and the same config, or a file formatted
on save is one two commands disagree about. `locate.js` is the walk up to `node_modules/.bin`, and it
is its own file so it can be measured without an editor — everything else in `formatter.js` needs
`vscode` to be loadable.

**A file outside a project that installed the package gets no edits and no complaint.** Refusing
loudly on every save of every file would be worse than doing nothing, and the tool's own words go to
an output channel rather than a modal.

### T — the OTHER TypeScript server, which no plugin can reach

Found in a real editor's log rather than reasoned about:

```
[error] [vscode.typescript-language-features] provider FAILED
[error] Error: <syntax> TypeScript Server Error (5.9.3)
Debug Failure. False expression: Token end is child end
```

An editor runs **two** servers, `<syntax>` and `<semantic>`, and **only the semantic one loads
tsserver plugins**. So the syntax server reads the author's own file — which is not TypeScript — and
its classifier walks into an internal assertion. There is nothing a plugin can do about it, because
it is not there.

`"typescript.tsserver.useSyntaxServer": "never"` is the answer, and it is in this repository's
`.vscode/settings.json` now. It belongs in the extension's README too, because a project using the
package needs it whether or not it has this repository.

**And the reason nothing appeared to change for an hour:** an editor reads an extension's manifest
when the extensions FOLDER changes, not when a file inside a linked one does. A manifest that gained
a `main` was invisible until the link was replaced, with nothing logged — as far as the editor knew,
the extension had never declared a formatter. `vscode/install.mjs` re-links, which is why re-running
it is the fix; it also had a bug of its own, `rmSync` on a link to a directory, which throws.

### V — `//`, which does not fail quietly

CSS has no line comment, and a person arriving from TypeScript writes one. It is not silent, it is
worse: measured end to end, `// why` is written into the stylesheet verbatim —
`.r-x{// why\n  color:red;gap:8px;}` — and a real CSS compiler then refuses the WHOLE file with
`SyntaxError: Unexpected token Semicolon`, naming nothing about the block, the file or the line. A
build that fails somewhere else entirely, for a comment.

**It needs the TEXT, not the parse**, which is why `checkText` exists beside `checkBlock`: the parser
has no idea what a line comment is, so it reads the characters as part of a property name and hands
them on. A `//` inside a string or a function is text rather than a comment — `url(https://…)` is the
case that matters, and `url(//cdn/…)` is the same without a scheme — so both are stepped over whole,
the discipline every scanner here uses.

`/* … */` is the one CSS has, and it is stripped from the emitted rule, which is right: a note
explaining a decision to the next person does not need to reach a browser.

### W — a value that has to be a property NAME

Reported, and measured: `transition-property: bordr-left-width` and `will-change: trnasform` said
nothing. Both grammars admit a free identifier, and the honest exclusion for a free identifier is to
check nothing — a name somebody invented cannot be told from a name somebody mistyped.

**Except here the identifier is not free.** It is a property name, and that is a closed set this
package already generates.

**`mdn-data` does not say so, and that is why it is a LIST.** Measured: `transition-property` is
`none | <single-transition-property>#` and `<single-transition-property>` is `all | <custom-ident>` —
nothing in the machine-readable grammar marks the identifier as a property name. The prose in the
specification says it; the JSON does not. So two properties are named in the generator with that
note, rather than inferred from something that does not exist.

**The `transition` SHORTHAND is deliberately not among them.** Its value mixes a property, two times
and an easing function in one list, and telling which word is which needs a model of the grammar
rather than a set of names — which is the open question about porting one from elsewhere.

**Three things that are not typos**, each a test: a vendor-prefixed property is not in the generated
list, which holds only unprefixed names; a custom property is animatable and is the author's own
word; and a CSS-wide keyword is accepted everywhere. The first two needed a fix one level down —
`words()` did not let a `-` start a word, so `-webkit-transform` was read as `webkit-transform` and
`--brand` as `brand`, and both were reported as typos of something they are not. A leading `-`
belongs to the word when a letter or another `-` follows it, which is CSS's own identifier rule, and
`-8px` stays a number.

### X — a unit that is nearly one

Reported after the words: `150oms`, `10pxx`. The type layer was tried and rejected for this long ago
— a template-literal length type catches `10pxx` and prints an unreadable expanded union.

**A near miss, not a membership test, and that is the whole design.** The obvious rule is "the unit
must be one CSS has", and it is the one failure a checker does not survive. Measured: `mdn-data`'s
`units.json` holds **thirty** and is missing `%`, the line-height units, every container-query unit
and every viewport variant — so a rule built from it would report `height: 100dvh` and
`padding: 1cqw`, which are correct CSS.

The known set is mdn-data's thirty plus a supplement written down family by family, sixty-three in
all. Even then the rule only speaks when the unit is within `nearest()`'s bound of a known one, so a
unit invented after this was written stays silent: `10zzzz` says nothing, `150oms` says `ms`.

### Y — an at-rule that belongs in a stylesheet

A block is ONE element's rule. `@keyframes`, `@font-face` and `@property` are not that — each names
something the whole stylesheet uses — and written inside a block they compile, nest inside the class
rule and do nothing. Measured: `@keyframes slide { … }` came out as `.r-…{@keyframes slide{…}}`,
which no browser resolves and nothing reported.

**A deny-list, not an allow-list, and that choice is the interesting part.** The at-rules that DO nest
are a growing set — `@scope` and `@starting-style` are recent — so an allow-list would have reported
both as faults on the day they arrived. This way a new top-level at-rule is missed in silence, which a
checker survives; laying on correct CSS is what it does not.

Thirteen names, generated, and each one asserted against `mdn-data`'s own at-rule list so a typo
cannot sit in it.

### L — the runtime diagnostic. Deliberately last — DONE

**The user's reasoning for putting it last was right:** diagnostics are this framework's signature,
and this one is written against a feature that has stopped moving. It turned out to be THREE, and the
third was not silence at all.

Measured, in core's own harness, before anything was written:

| given | what happened |
|---|---|
| a descriptor read without being called | the class applied, NO custom property set, silence |
| a value holding a `;` | the declaration dropped, silence |
| a plain object, or a string | **threw** `Cannot read properties of undefined (reading 'length')` |

`RMD062`, `RMD063`, `RMD064` — all `error`, because in every one of them the page is wrong rather
than merely slower. The third is the one worth remembering: it took the render down and named nothing
about `css`, so the fix is a report AND a shape guard. A value that is not a block is now ignored
**whole**, class included, which is what `formatAttributes` had to be taught too — it asks the same
question, and the report is raised in one place because two for one element would read as two faults.

The fixtures are built by hand rather than by `block()`: core may not depend on the compiler at any
depth, and what is asserted is what the RUNTIME does with a shape, so the shape is the fixture.

### U — one page, because it was in five

The syntax, the three spellings, the build plugins, the language-service plugin, the extension, the
Prettier plugin, the wrappers, the `useSyntaxServer` setting and the colour limits were spread across
`packages/css/README.md`, `packages/css/vscode/README.md`, `DESIGN.md`, this file and a docs page that
covered only the syntax. Nobody setting up an editor would have found four of those.

`apps/docs/content/style-blocks.md` carries all of it now, and the two READMEs point at it rather than
repeating it — the extension's keeps its own half, because it is read on a marketplace where the site
is not at hand.

---

## The next build — composition, and why it is a rewrite of three files rather than a feature

**The gap, in the user's own framing:** with MUI's `sx` a developer toggles whole GROUPS of keys and
merges one block into another; StyleX does the same and resolves it at build time. This has neither.
A block is one hash and one class, and holes carry values, so `disabled` cannot turn off a group.

**Why a second class cannot answer it, measured in Chromium:** the order of classes in the `class`
attribute decides *nothing*. `class="base active"` and `class="active base"` both take whichever rule
is later **in the stylesheet**, and with layers the layer decides. So two whole-block classes cannot
express "this one wins" from the call site — which is exactly why StyleX is atomic. One class per
declaration means the merge picks WHICH classes land, so there is never a tie to break.

### What the author writes — decided with the user, 2026-09-05

Composition goes INSIDE the block, because that is what a person reads. **Later wins**, which is the
rule a CSS reader already has — no array index to map onto precedence, and the override sits under
the thing it overrides.

```tsx
const variants = {
  primary:   @@( background: #10b981; color: #fff; &:hover { background: #0e9f6e; } ),
  secondary: @@( background: transparent; color: #10b981; ),
};

<button css=@@(
  ...button;                                 // merge another block's map, across files
  ...variants[this.variant];                 // exhaustive — TypeScript checks the key

  @@if {{this.disabled}} {
    opacity: 0.5;
    cursor: not-allowed;                     // beats `cursor: pointer` above, because it is BELOW
  }

  width: {{this.full ? "100%" : "auto"}};    // a VALUE choice is still a hole
)>
```

The array form — `css={[a, b && c]}` — keeps working and becomes the rare one.

**`@@if`, and no `@else`.** The user refused any spelling CSS might one day claim. Measured, written
inside a nested rule: `#if`, `>if`, `~if`, `+if` are **already parsed as selectors**; `:if` is the
likeliest future collision, since CSS keeps adding pseudo-classes; `?`, `!`, `$` and `@if` are free
*today* and that is all. **`@@anything` is structurally impossible in CSS** — an at-keyword is `@`
followed by an ident-token and an ident cannot begin with `@` — so it is a grammar guarantee rather
than a bet, and `@@` is already this language's own marker. `@else` is dropped because CSS drafts it
(Conditional Rules 5) for environment conditions; a spread of a lookup object replaces it and gives
exhaustiveness `@else` never had.

### The compiled shape, which is the whole design

A block compiles to a MAP from what a declaration SETS to the class that sets it. Static entries are
a class name; a hole's entry is a pair, because the value travels with it:

```js
const _s0 = { display: "r-a1", cursor: "r-b2", "&:hover|filter": "r-c3" };
const _s1 = { background: "r-d4", color: "r-e5" };
const _s3 = { opacity: "r-f6", cursor: "r-g7" };
const _s4 = { width: ["r-h8", this.full ? "100%" : "auto"] };

<button className={_m(_s0, variants[this.variant], this.disabled && _s3, _s4)} />
```

**Reachability does not matter, and that is the point.** Every `@@( … )` is a literal in the source,
so the compiler sees all of them whether or not a branch ever runs. A block behind `variants[name]`,
in an object, in a ternary, in a `map` — the transform never has to resolve which one is chosen.

**Nesting works, and it is not a coincidence — it is measured.** `@@if` inside `@@if`, `&:hover`
inside `@@if`, `@@if` inside `&:hover`: the parser already reads all four combinations as ordinary
nested rules (measured, one site). A nested condition is a CONJUNCTION, so it compiles either way —
as a nested merge or flattened into `a && b && map` — and the two agree because **the merge is
associative**: 50,309 random groupings of random maps drawn from a pool of shorthands and their
longhands, **zero disagreements** between `_m(a, _m(b, c))` and `_m(a, b, c)`. That is the property
the shorthand-clearing rule could have broken, and it does not. Nesting is therefore free to allow.

Three more properties fall out for free and are worth knowing before the work starts:

- **`&:hover` inside `@@if` and `@@if` inside `&:hover` mean the same thing**, because the key is
  `selector|property` and both flatten to it.
- **`@media` is another key**, so it composes through the merge; which one wins is then the SHEET's
  emission order — see below.
- **Two blocks writing the same hole shape share a class and a variable name.** The merge keeps the
  later entry whole, pair and all, so the right value is the one that is set. No collision.

### Shorthands, which is the one hard problem — and it is NOT solved by expanding values

A shorthand and its longhand are DIFFERENT properties, so a merge keeps both and the sheet breaks the
tie — silently, and possibly against the call site. Measured: `.a{padding:8px}` with
`.b{padding-left:40px}` gives 40px whichever order the classes are written in, and 8px if the longhand
is emitted first.

**Expansion was the obvious answer and the corpus killed it.** mdn-data names 78 shorthands and says
what each expands to, but only **10 split by a mechanical rule** (`padding`, `margin`, `inset` by the
1-to-4 box rule, plus seven logical pairs); the other 68 need per-property grammar. Measured on every
declaration written in a block in this repository: **50 of 108 are shorthands, and only 7 of those
split mechanically** — `border-left` (18x), `gap` (9x), `transition`, `border-radius`, `background`
dominate. Expanding values would buy almost nothing for most of the work.

**The answer is a shorthand-aware MERGE, and it needs no value parsing at all.** The table is
generated from mdn-data by the sweep that already writes the property map, and the merge implements
CSS's own cascade in one line: *a later shorthand clears its own longhands.*

| merged | kept | what CSS says |
|---|---|---|
| `padding` then `padding-left` | both — sheet emits the longhand later | 40px ✓ |
| `padding-left` then `padding` | the shorthand clears it | 8px ✓ |
| `border-left` then `border-left-color` | both | ✓ |
| `border-left-color` then `border-left` | the shorthand clears it | ✓ |

So the sheet gains one ordering rule: **longhands are emitted after shorthands**, and conditional
at-rules after both.

### The tracks, in order

**AC0 — the contract. DONE 2026-09-05, and it turned out to be half the job it looked like.**

The plan assumed the cross-package contract changes. **It does not, and that was measured rather than
hoped:** a merge produces exactly today's `StyleValue` — a class string, property names, values — and
the only difference is that the string holds several classes. `classNameWithBlock` already joins that
with the author's own, and its own comment already said why order there is meaningless. Asserted end
to end in core's `CssBlock.test.tsx`: every class arrives, the author's survives, the properties land,
and swapping the value leaves none of the first behind. **Nothing in `@ramonda/core` changes**, so
`check-css-contract.mjs` keeps passing untouched and the whole build is contained in one package.

Frozen in `CONTRACT.md` §1b: the map, the entry (a class, or a class and its values), the canonical
KEY — at-rules sorted because they commute (measured in Chromium), selector parts composed in order
because they do not — the variable name, the merge rule, and the sheet's emission order.

**AC1 — the shorthand table. DONE 2026-09-05.** `SHORTHANDS` out of the same sweep as `PROPERTIES`,
`KEYWORDS` and `UNITS`: 78 entries, pure addition, no behaviour change.

**It is NOT the list mdn-data writes, and finding that out took two rounds of measuring.** That list
misses a shorthand two ways, each of which leaves a rule alive that a later declaration replaces:

1. **It stops at sub-shorthands.** `border` sets `border-width`, which is itself a shorthand for four
   — so a table taken as written lets `border` fail to clear `border-left-width`.
2. **It names no shorthand at all**, so `border` would not clear `border-left` either. Measured with
   the real table: `border-left` then `border` left BOTH classes on the element.

So the entry for a property is **every other property whose leaves are a SUBSET of its own**, which
is what "sets everything that one sets" means and is computable from the same data. A longhand's leaf
set is itself alone, so nothing is a subset of it and it clears nothing — which is right.

Verified against CSS's own answer in eight directions, and **associativity re-measured on the real
table** — 50,301 groupings from a pool drawn from one family, so shorthands and longhands collide
constantly: zero disagreements. That mattered, because clearing REMOVES keys rather than replacing
them, and the earlier measurement had used a four-entry synthetic table. Both are tests now.

**AC2 — the sheet emits declarations. DONE 2026-09-05.** An atomic rule is an `EmittedBlock` with
three fields a whole-block one does not have: the `property` it sets, the `selector` appended to its
class, and the `conditions` written around it. Everything else — dedupe, the collision assertion, the
round trip, per-file serving — is unchanged in kind, and a whole block still emits exactly as before.

A whole-block rule keeps its nesting INSIDE it and lets CSS resolve it. An atomic one cannot: each
declaration is its own rule with its own class, so `&:hover` becomes `.r-…:hover` and a `@media`
becomes a wrapper.

**The order is now a rule rather than an accident**, and it is two numbers and a STABLE sort — so
anything neither separates keeps the order it arrived in, and a file's rules stay in source order.
Conditional rules after unconditional ones; within each, the broadest property first, measured by how
many other properties it clears. Verified end to end in Chromium, with the rules ADDED in the wrong
order on purpose:

| viewport | computed |
|---|---|
| wide, so the `@media` applies | `padding-left: 24px`, `padding-top: 24px` — the media rule wins, because it is emitted last |
| narrow, so it does not | `padding-left: 40px`, `padding-top: 8px` — the longhand wins, because it is emitted after the shorthand |

Both are CSS's own answer, from a sheet the author never ordered.

**AC3 — the transform emits maps.** Split in two, because the emission cannot change before the
thing being emitted exists.

**AC3a — the flattening. DONE 2026-09-05.** `flatten(block)` turns a parse into the declarations it
makes, each with its canonical KEY, the text it hashes as, its selector suffix, its conditions and
the block's hole indices it uses. A pure function over the AST: nothing emits differently, nothing
breaks.

Three things it decides, and each was a way to be silently wrong:

- **at-rules sorted, selector parts composed in order** — the contract's rule, and the reason is that
  the first commutes and the second does not. Keyed as written, `@media X { &:hover { … } }` and
  `&:hover { @media X { … } }` would be two keys for one thing set, and a modifier would fail to
  override a base written the other way round.
- **holes renumbered per declaration.** A hole's index belongs to the block, so `color: {{x}}` is
  hole 0 alone and hole 1 under another declaration — the same declaration, two canonical texts, two
  classes, and the dedupe that pays for the whole design gone.
- **a bare nested selector is a descendant**, which is what CSS nesting says it means.

**Correctness is a browser, and it was measured before the code was written.** A realistic block —
nesting, a descendant, a combined `&:hover .title`, a `@media` override and a `@media` around a
`&:hover` — emitted as ONE whole-block rule and as **14 atomic rules**, read hovered on a narrow
viewport and a wide one: **byte-identical computed style** both times. Display, alignment, gap,
padding, both colours, radius, the descendant's weight and its decoration.

**AC3b — the emission. DONE 2026-09-05, and the question below is answered by measurement.**

A block compiles to a map: one entry per declaration, from what it sets to the class that sets it,
plus a `~` clear-list for each shorthand it writes. **A block with no holes is hoisted; one with
holes is built where it is written.**

The measurement that decided it: **71% of the blocks written to be read in this repository carry no
hole**, and for those the merged value cannot change — merging at the site would allocate per element
per render for a constant. `merge` of one map is **0.86 µs** against **0.001 µs** for reading a
hoisted value; on 800 elements that is 0.69 ms of nothing.

**The author's expressions never move**, which is what keeps the source map landing on their line:
`flatten` walks depth-first, so the declarations and their holes come out in source order — and the
transform still rewrites only the text BETWEEN expressions, now into an object literal instead of a
call.

**24 assertions across two files changed and nothing else did.** Vite, esbuild, the real build, the
check command, the language service and the tooling wrappers all pass untouched, which is the
evidence that the shape of this change was contained where AC0 said it would be.

**The old question, kept because the answer is the design:**

Every site becomes a `merge( … )` call, because the framework takes a VALUE and a block now compiles
to a map. That is right for a composed site and for one with holes — both already allocate per
render, because both depend on something only the render knows.

**It is wrong for the common case, and this design deliberately removed that cost once already.** A
block with no holes and no composition is a module constant today: `css={_s0}`, one allocation for
the life of the program however many elements carry it. Naively, atomic makes it `merge(_s0)` — an
allocation per element per render, for a value that cannot change.

The answer is presumably to hoist the merged value where every argument is static —
`const _v0 = merge(_s0);` at module scope — and to emit a call only where something is conditional.
**That is a decision with a measurement behind it, not a detail**, so it is written down here rather
than made in passing:

- what fraction of real sites are fully static (this repository's own blocks are a corpus);
- what `merge` costs per element against the allocation it replaces — 0.64 µs was measured for four
  maps and 24 declarations, and a one-map merge is the case that matters here;
- whether a hoisted static value and a per-render composed one can share one spelling at the site, or
  whether the transform emits two shapes.

The rest of AC3b is mechanical: one hash per declaration, the map, the `~` clear-lists for the
shorthands a block writes, and the site rewrite. It changes the emitted code, so it lands with every
transform, Vite, esbuild and docs assertion in one commit — which is why it is worth having the
question settled before it starts.

**AC4 — the runtime merge. DONE 2026-09-05.** Two functions, because one shape cannot do both jobs:

- **`compose(...maps) → map`** is the primitive and is closed over its own output, which is what a
  nested group needs. Clear-lists are carried into the result, or `compose(compose(a, b), c)` would
  stop clearing halfway.
- **`merge(...maps) → value`** is the boundary, and produces exactly what the framework already
  takes. A falsy argument is a group switched off, which is what `disabled && block` compiles to.

**The shorthand clear-list travels with the block that needs it**, under a `~` key — no CSS property
may begin with one. That is what keeps a table of 78 shorthands out of every page: a block pays for
the shorthands it actually writes, and nothing else. The other direction needs no list at all,
because the sheet already emits longhands after shorthands.

**Measured end to end, through `flatten` + the sheet + `merge`, in Chromium:**

| the call site | computed |
|---|---|
| `merge(base)` | `cursor: pointer`, `padding-left: 40px` |
| `merge(base, off)` | **`cursor: not-allowed`** — the modifier beat the base because it is LATER IN THE CALL |
| `merge(base, roomy)` | **`padding-left: 8px`** — the later shorthand cleared the base's longhand |
| `merge(base, off, roomy)` | both, composed |

The second row is the thing that was impossible before this: precedence decided at the call site
rather than by the stylesheet.

**AC5 — `...{{expr}};` inside a block. DONE 2026-09-05.** It becomes an argument of the merge, in the
position it was written, so what is above it merges first — which is what *later wins* means.

**The operand is inside `{{ }}` like every other expression in a block**, for the reason the user gave
when they chose `@@if {{expr}}`: TypeScript appears there and nowhere else. `...base;` would have
been prettier and would have been a second spelling for the same thing.

**One fault it exposed, and it failed in the worst way — quietly and only sometimes.** A spread hands
`merge` whatever the binding holds, and `const base = @@( … )` compiles to a VALUE, not a map. A
value has none of the keys a map has, so composing one lost everything: measured, a base spread into
a modifier still produced a plausible class string, because iterating a value's own keys happens to
yield its `className` — and nothing could be overridden or cleared. `padding: 8px` in the modifier
left the base's `padding-left: 40px` standing. **A value now carries the map it came from**, under a
non-enumerable symbol, and `compose` reads it back.

The type for the operand is still to write — see AC7.

**AC6 — `@@if {{ … }} { }`.** The parser already reads it as a nested rule with that prelude, and the
scanner does NOT mistake it for a second block site (measured: one site, not two). Needs the condition
type-checked in the author's scope, and exemption from `at-rule-out-of-place`.

**The condition is written `{{ … }}`, decided by the user 2026-09-05**, against `@@if (expr)` which is
what everyone expects. Consistency won, and it is this language's one standing rule: **TypeScript
appears inside `{{ }}` and nowhere else.** A second spelling for "here is an expression" would be a
second thing to teach and a second thing for every tool to know.

**DONE 2026-09-05.** A group becomes an argument guarded by its condition — `c && { … }` — and a
nested one a conjunction, `a && b && { … }`, which is only correct because the merge is associative.
Declarations around a group keep their place, and a selector inside a group means what a group inside
a selector means: the key is canonical, so both give the same class.

Two parser changes, both narrow: a head that is exactly the marker and one hole records that hole
rather than refusing it, and a spread is a declaration with no value rather than a declaration
missing one. Everything else about a head is unchanged, so `@@iffy {{c}}` is still a selector and
still refused.

**Measured end to end** — compiled, run, and rendered in Chromium, across a spread, two guards and a
shorthand:

| | computed |
|---|---|
| neither | `cursor: pointer`, `padding-left: 40px` |
| `off` | **`cursor: not-allowed`** — the guard beat the base, decided at the call site |
| `roomy` | **`padding-left: 8px`** — a shorthand inside a GUARD cleared a longhand that arrived through a SPREAD |
| both | composed |

**AC7 — the checks. The TYPES are DONE 2026-09-05; one rule is left.**

Both new ways to be wrong are caught by a type, so it is TypeScript's own message at the author's own
position and there is no diagnostic of ours to write. Asserted through a real program:

| written | answer |
|---|---|
| `@@if {{this.off}}`, `@@if {{maybe}}` where `maybe` may be `undefined` | silent |
| `@@if {{this.method}}` (not called), `@@if {{o}}`, `@@if {{p}}` (a promise) | *always truthy* |
| `...{{base}}` where `base` is a block | silent |
| `...{{plain}}`, `...{{text}}` | *only a style block can be spread*, at the author's line |
| a typo inside a group | the same `TS2561` and the same *did you mean* it is outside one |

**The encoding is the measured one:** the condition and the spread are their own array ELEMENTS,
beside the declarations rather than around them — writing a group as `__when(condition, [ … ])` meant
a wrong condition hid every fault under it. Asserted directly: a bad condition with two typos under
it comes back as three findings, on lines 3, 4 and 5.

**Left:** a shorthand meeting one of its own longhands in a merge the author wrote INLINE is visible
to the checker, which could never be reported before; across files it needs a runtime diagnostic.

**AC8 — the page.** `style-blocks.md` gains composition; every example in it is already gated.

### Type safety, measured before it was promised

The condition and the spread are both new places for the author to be wrong, and both are checkable
by a TYPE rather than by a rule of ours — which means TypeScript's own message, at the author's own
position, with no diagnostic to write. Both were put through a real `tsc` first.

**A condition that can never be false** is a group that can never be off. The message IS the type, so
TypeScript prints it as the expected parameter:

```ts
type Condition<T> =
  [T] extends [(...args: never[]) => unknown] ? "a function is always truthy — call it, or test a value" :
  [T] extends [Promise<unknown>]              ? "a promise is always truthy — await it, or test a value" :
  [null] extends [T] ? T : [undefined] extends [T] ? T :
  [T] extends [object]                        ? "this is always truthy, so the group can never be off" :
  T;
```

Measured, 14 conditions through `tsc`:

| written | answer |
|---|---|
| `boolean`, `number`, `string`, `count > 0`, `text.length`, `union === "sm"` | silent |
| `{ a: 1 } \| undefined`, `{ a: 1 } \| null` | silent — the legitimate case, and it must stay silent |
| **`any`, `unknown`** | **silent** — the edge that would have made this unusable |
| `{ a: 1 }`, `string[]` | reported: *this is always truthy, so the group can never be off* |
| `() => void` | reported: *a function is always truthy — call it, or test a value* |
| `Promise<number>` | reported: *a promise is always truthy — await it, or test a value* |

**Nothing the block already had is lost, and that was the question worth asking.** Measured: a typo
inside `@@if` reports with the SAME code and the SAME *did you mean* as the identical typo outside it
— `TS2561` for a bare property, `TS2820` for a value in a closed union, `TS2353` for a dashed one —
and so does one inside `&:hover` inside `@@if`, inside `@@if` inside `&:hover`, and inside `@@if`
inside `@@if`. Three faults in one group come back as three, which is the property this package fought
for with one literal per declaration.

**One encoding fails that, and it is the obvious one.** Writing the group as
`__when(condition, [ … ])` — the condition as an ARGUMENT wrapping the declarations — means a wrong
condition **hides every fault in the body**: measured, the condition was reported and the two typos
under it were not, because the failed inference degrades the whole call. So **the condition is its own
array element**, `__cond(expr)` beside the declarations rather than around them:

```ts
__block([{ display: "flex" }, __cond(this.disabled), { opacity: "0.5" }, { colr: "red" }]);
```

Measured that way, a bad condition and both typos come back together, each at its own position. The
group's nesting is not needed in the virtual file at all — that file exists only to be type-checked,
and a declaration inside a group is checked exactly like one outside it.

**A spread of something that is not a block** is refused the same way, with a branded map type a
hand-written object cannot forge:

| written | answer |
|---|---|
| `...button`, `...variants.primary`, `...variants[this.variant]` | silent — and the lookup is what replaces `@else` |
| `...plain` (a plain object), `...text` | reported: *only a style block can be spread* |
| `...partial[this.variant]` (possibly missing) | reported — spreading something that may not exist |

A cast still beats both, as it beats every type in this repository; that is what the CHECKER is for.
Worth refining when AC6 is built: a possibly-`undefined` spread should say so rather than say it is
not a block.

### What does NOT change, and it is most of the package

The scanner, the tolerant parser, the virtual file's mapping, the tooling wrappers, the CLI, the
language-service plugin, the TextMate grammars (beyond colouring two new spellings), the property
types, and every rule that is about one declaration. **Atomic is a rewrite of the sheet, the
transform's emission and the runtime — three files — plus the two authoring forms.**

### The cost, measured rather than argued

| | rules | CSS | markup | together gz |
|---|---|---|---|---|
| 40 components, 800 elements, whole blocks | 140 | 26.8 KB (2.4 gz) | 21.1 KB (1.7 gz) | **3.5 KB** |
| the same, atomic | 38 | 1.5 KB (0.7 gz) | 157.7 KB (2.6 gz) | **3.1 KB** |

**Bytes do not decide it.** Atomic moves weight out of the CSS and into the markup — 7x the raw
markup, which gzip very nearly erases. What atomic really costs is style recalculation: measured in
Chromium, an element carrying 13 atomic classes against one carrying a single class,
**2.5x–2.8x per recalc** — 7.3 ms for 2000 elements against 2.6 ms. Under a frame either way, and it
is the number to watch if a page ever feels slow.

## Do not re-measure these

Every row was run, not reasoned. Re-deriving them is the main way to waste a week.

| | result |
|---|---|
| the syntax vs `tsc` / esbuild | both refuse it at the PARSE step |
| a hole type-checked in its real scope | a real `TS2339` at the author's line and column |
| a property-name typo, key written bare | `TS2561 … Did you mean to write 'display'?` |
| the same typo, key in quotes | `TS2353`, and **no suggestion at all** — so a dashed property gets no *did you mean* |
| a value typo | `TS2820 … Did you mean '"flex"'?`, reported on the property |
| where a diagnostic lands | on the property, except a name error, which lands on the expression |
| how many properties have a closed grammar | **123 of 551**; `display`, `align-items`, `overflow` and `cursor` do NOT |
| a union without `inherit`, `var()` and `!important` | reports valid CSS — all three are required |
| a named alias in a union | TypeScript prints the NAME, so the message stays one line |
| checking 200 files that each carry a block | **+37%** over the same program without them |
| one object literal per block | TypeScript reports ONE failure and stops — so a block reports one fault per run |
| one literal per declaration, in an array | every fault at once; +15 points of check time |
| a block shape that does not resolve | everything becomes `any` and the diagnostic is scaffolding — reported now, or it passes silently |
| a hole typed by its property | `TS2322` on `padding: {{nekaFunc()}}` |
| a template-literal length type | catches `10pxx`, prints an unreadable expanded union |
| transform cost, the PROTOTYPE | +2.6% over esbuild — superseded, it built no AST and no map |
| transform cost, the REAL one | **+9.7%** over esbuild; 58.8 µs/file, every component carrying four blocks |
| an esbuild plugin that is merely ASKED about a file | +12%, 3.4 µs/file |
| the same plugin READING the file | **+60%**, 17.3 µs/file — the read is the whole cost |
| reading bytes instead of text | not faster (+62%): the syscall, not the UTF-8 |
| esbuild contents returned with NO loader | parsed as plain JavaScript, JSX refused on every file |
| bail-out on an unused codebase | 1,290 files, 10.73 MB, **0.84 ms**, scan included |
| the generated `style={{…}}` object | `RMD020` on every render |
| the same as a string / prop | silent |
| a block in a lazily-loaded module | its OWN stylesheet asset, disjoint from the entry's — splitting is free |
| a `;` deleted after a CLOSED-grammar property | reported: the next name is a value it does not accept |
| a `;` deleted after an OPEN one (`padding`) | **silent** — one value, and nothing to check it against |
| a block in a `tsx` fence, no grammar | the theme's INVALID colour, to the end of the fence |
| shiki's `codeToTokensBase` | MERGES adjacent same-colour tokens — `explanation[0]` lies about a run |
| SSR values | travel in the markup; no channel, no registry |
| hydration, four directions | two fail, and both are the `undefined` rows |
| N instances | **one rule at any N**; 30–73 B per instance |
| hash length | 8/12/16 hex all gzip to **46.7 KB** — length is free |
| `@(expr)` in decorator position | **already valid TypeScript**, on a member AND on a parameter |
| `@@(` in all five positions | a syntax error everywhere — nothing to disambiguate against |
| the substring `@(` on this repository | **2 of 1,093** files, both regexes — a named decorator is `@name(` |
| `@keyframes`, `@font-face`, `@property` inside `@layer` | all three take effect — animation runs, face parses, `--angle` registers |
| `@property` with no `inherits` | **dropped entirely** — not in `cssRules`, and the name takes any junk |
| `@property` with `syntax: "*"` and no `initial-value` | registers fine, so required-ness there would report valid CSS |
| a generated `@property` animated by a generated `@keyframes` | **interpolates** — exactly 90° at half time, which only a registered property does |
| the order of classes in the `class` attribute | decides **nothing** — the sheet's order does, and with layers the layer does |
| `@media` against a base rule for one property | the media rule wins **only if emitted after** it |
| a shorthand and its longhand on one element | different properties, both land, the SHEET breaks the tie |
| shorthands that split by a mechanical rule | **10 of 78**, and on this repo's own blocks 7 uses of 50 |
| the runtime merge, 4 maps and 24 declarations | 0.64 µs per element — 0.5 ms for 800 of them |
| 13 atomic classes per element vs one whole class | **2.5–2.8x** the style recalculation; 7.3 ms for 2000 elements |
| atomic vs whole blocks, 800 elements | CSS 1.5 KB vs 26.8 KB, markup 157.7 KB vs 21.1 KB — **3.1 vs 3.5 KB gzipped together** |
| `@@if` inside a block body | the scanner does not read it as a second site; the parser gives a nested rule |
| `@@if` nested in `@@if`, and either way round with `&:hover` | all four already parse, as ordinary nested rules |
| the sheet's emission order, end to end | gives CSS's own answer on both sides of a `@media`, from rules added in the wrong order |
| one block as 1 whole rule vs its 14 atomic ones | **identical computed style**, hovered, narrow and wide |
| `merge(base, modifier)` end to end | the CALL SITE decides — `cursor` and a shorthand override both land right |
| the shorthand-aware merge, 50,309 random groupings | **associative** — nesting and flattening never disagree |
| an always-truthy `@@if` condition, as a TYPE | reportable — and `any`/`unknown`/`T \| undefined` stay silent |
| a spread of a non-block, as a TYPE | reportable; a lookup with a union key passes |
| a typo inside `@@if`, and in every nesting of it | same code, same *did you mean*, as outside — nothing lost |
| the condition as an ARGUMENT wrapping the group | **hides every fault in the body** — so it is its own array element |
| `var(var(--x))` | resolves to nothing — a `var()` name must be literal, so a reference cannot be a hole |
| one rule per OWNER, through a real build | a sibling lazy route named a class **no stylesheet contained** |
| every file serving what it names | 3.5x the CSS bytes, **1.1x gzipped**, on a corpus that duplicates every rule 3x |
| two identical per-file sheets | Vite dedupes the ASSET by content — both routes point at one file, for nothing |
| `ramonda-check` on the raw source | error-recovers; 3 rules become 1, silently |
| source maps through both transforms | **5 of 5** positions land on the author's line |
| the map's `hires` setting | all three get every line right; only `false` loses columns, everywhere |
| the test runner | reached, and `enforce: "pre"` is required |
| `biome-ignore` / `oxlint-disable` | useless — read BY the parser, which already failed |
| lint through the virtual file | real diagnostics, author's lines |
| format through a placeholder | whole file formatted, block restored |
| the docs example gate | **skips silently** — "not standalone code", exit 0 |
| a `tsx` fence containing the syntax | mis-highlighted everywhere; unknown languages fall back to plain |
| ONE stylesheet for the whole app | ships **no CSS**: the bundler loads it before the transform has run |
| one stylesheet per file | correct, and the CSS follows the chunk — splitting comes free |
| Vite's `loc.column` | **0-based**; the type does not say, and Vite echoes what it is given |
| an ESM language service plugin | **silently skipped** — `tsserver` checks `typeof factory === "function"` and `require(esm)` gives an object |
| a caret right after a complete key | one useless entry; **inside** the key gives every property name |
| a caret where nothing is typed yet | belongs to no run of text — needs an empty object literal to be inside |
| the strict parser on a half-typed property | refuses, so an editor gets nothing exactly when it matters |
| a multi-line block in the virtual file | collapses to ONE line — everything below it moves up, and a line-reporting consumer is wrong |
| the block's newlines put back AFTER it | every declaration lands on the block's opening line; they go between the items |
| "is the grammar closed" as the value test | leaves `border-left: sollid` alone — a length can never BE a bare word |
| a duplicate declaration with a different value | a deliberate fallback idiom; only the SAME value is reportable |
| `biome` and `oxlint` on a file outside the project | the project's own config, read from the CWD — 93 rules either way |
| a broken `biome.json` | ignored; it formats with its defaults and exits 0 |
| a `node_modules/.bin` shim, symlinked alone | `Cannot find module` — each resolves its package relative to itself |
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
