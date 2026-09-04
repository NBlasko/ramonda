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
   chunk** — which is what track J needs and is now free. Dedupe survives it: the first file to claim
   a class owns the rule, and a second file naming the same block emits nothing for it.
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

`shape()` turns a block holding `@( … )` into its virtual reading before it tries any wrapper, and
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
fixture: a `.tsx` holding `@( … )` cannot be read by this repository's formatter or linter, and there
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
`@( … )` cannot honestly certify until this is done.

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
| bail-out on an unused codebase | 1,290 files, 10.73 MB, **0.84 ms**, scan included |
| the generated `style={{…}}` object | `RMD020` on every render |
| the same as a string / prop | silent |
| SSR values | travel in the markup; no channel, no registry |
| hydration, four directions | two fail, and both are the `undefined` rows |
| N instances | **one rule at any N**; 30–73 B per instance |
| hash length | 8/12/16 hex all gzip to **46.7 KB** — length is free |
| `@(expr)` in decorator position | **already valid TypeScript** |
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
