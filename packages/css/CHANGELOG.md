# @ramonda/css

## 0.7.0

### Minor Changes

- ac0b94f: **`styleOtherElements: false` keeps a block to its own element.** A selector whose subject is another
  element — a child (`.title`, `& > img`, `&:hover .icon`) or a sibling (`& + .card`) — is refused
  (`styles-another-element`); `&:hover`, `&::before`, `&.active`, `&:has(…)` and `[data-theme] &` still
  style the element itself. Left out, nothing changes.
- 7240c60: **Breaking: a project's tokens are called tokens.** CSS calls a custom property a "variable", so a
  config holding `variables` beside settings about custom properties read as one thing said twice.
  Every old name is refused with the new one in the message.

  | Was                                                 | Is                                                             |
  | --------------------------------------------------- | -------------------------------------------------------------- |
  | `variables: { $color: kind(…) }`                    | `tokens: { $color: kind(…) }`                                  |
  | `alsoSets: ["--x"]`                                 | `externalCustomProperties: ["--x"]`                            |
  | `"<color>": { variablesOnly: true }`                | `"<color>": { hardcoded: false }` — the value turns over       |
  | rule `literal-not-allowed`                          | `hardcoded-not-allowed`                                        |
  | rule `unknown-variable`                             | `unknown-token`                                                |
  | rule `variable-by-hand`                             | `token-by-hand`                                                |
  | rule `variable-set-against-its-declaration`         | `token-set-against-its-declaration`                            |
  | rule `variable-set-by-another-name`                 | `custom-property-set-by-another-name`                          |
  | rule `hole-as-a-variable-name`                      | `hole-as-a-custom-property-name`                               |
  | `css-system/variables.css`                          | `css-system/tokens.css`                                        |
  | `ColorVar`, `LengthVar`, … · `Var<K>` · `VarByKind` | `ColorToken`, `LengthToken`, … · `AnyToken<K>` · `TokenByKind` |
  | `Variable` from `@ramonda/css/config`               | `TokenDeclaration`                                             |

  Run `ramonda-css codegen` once after updating: it writes `tokens.css` and removes the old
  `variables.css` it wrote (one somebody wrote by hand is left alone). An import of
  `css-system/variables.css` in your own code becomes `css-system/tokens.css`. The docs page moved to
  `/style-blocks/tokens`; the old address redirects.

- c5aa404: **`unknownCustomProperties: "same-block"` allows a made-up name as a local.** One block may set a
  name and read it — `--gap: 4px; padding: var(--gap);` — and nothing else may: a read the block does
  not set is refused, and so is a setting it does not read. A `style` attribute counts as one block.
- 03ea4ff: **`unknownCustomProperties: false` refuses a custom property made up on the spot.** With it, a block
  or a `style` attribute may only set or read a token, a `@@property( … )` through its binding, or a
  name listed in `externalCustomProperties`; `--brand: red;` and `var(--brand)` anywhere else are
  refused (`unknown-custom-property`) in the build, the editor and `ramonda-check`. Left out, nothing
  changes.

### Patch Changes

- 510a06e: **A condition written at the wrong level names the spelling that level takes.** `color: when $(a) red;`
  says _`when` chooses a group — for a value, write `$(c) ? a : b`_, and `$(a) ? ( … ) : ( … );` says
  _a choice picks a value — for a group, write `when $(c) { … } else { … }`_. Both were refused before,
  with a sentence about something else; the editor and the build now say the same one.
- a6487d6: **A `@@font-face` binding is the family it declares.** `font-family: $(brand)` compiled to a hash
  the `@font-face` rule never declared, so the font silently never loaded. `$(brand)` — and `brand` in
  code — is now the family exactly as written, `"Brand"`: a reference, so a typo is an error and a
  rename is one edit. Two faces of one family (two weights) are still two rules.
- 7517eaf: **Setting a token is not a hardcoded value.** Under `hardcoded: false` (`variablesOnly` before),
  `--color-surface: #111827;` — a token set to a value its `range` permits — was refused as a colour
  written out, while the range said it may be. Setting a token is where a theme writes its colours; the
  value is judged against the token's range instead, and an ordinary property is refused as before.
- f70dc8f: - **A registered property only an animation sets is no longer reported as set by nothing.** A
  `@@keyframes` frame writing `$(angle): 90deg` sets it on the element it animates, and
  `registered-never-set` now counts that — it reported the very pattern the docs show for animating
  a registered property.
  - **A relative `url( … )` in a block builds through esbuild.** It failed with _Could not resolve_
    with the file right beside the source: the block's stylesheet had no folder to read the path from.
    It is read from the folder of the file that holds the block, as Vite reads it.
- cd735eb: **A `match` over a number or a boolean says what to write instead.** It was refused with a raw
  `Type 'string' is not assignable to type '2 | 1'`, once per key, naming neither `match` nor the fix.
  It is now refused once, on the subject: `match takes a string — for a boolean, write $(on) ? a : b`,
  or `— name the cases in code, $(n > 2 ? 'large' : 'small')`. An arm's key is a written word, so
  `match` takes a string; nothing that worked before changes.
- 0b2b887: **The build refuses a `@@property` with no `syntax` or no `inherits`** (`property-descriptor-missing`).
  CSS requires both, and the browser drops a registration missing either, in silence. The editor
  already said so through the type; the build, which does not run the type check, compiled it.
- 4ac3e87: **A token group written without `kind( … )` is refused.** `tokens: { $color: { accent: "#10b981" } }`
  loaded, declared nothing and wrote an empty sheet — the first `$color.accent` was then told the
  project declares no tokens. The config's type now takes only what `kind( … )` makes, and loading the
  config names the group: _declares `tokens.$color` without `kind( … )`_.
- 9fb2922: **A hover on a token says what it is.** `$color.accent.quiet`, in a block or in code, now shows its
  kind, the custom property it is written as (`var(--color-accent-quiet)` — the name a browser's style
  panel shows), what it starts as, and whether it may change. Codegen writes it as a doc comment above
  each token, so run `ramonda-css codegen` once after updating.
- 7240c60: **A token set anywhere is checked against its declaration** (`token-set-against-its-declaration`).
  One declared without a `range` never changes — its type says `Fixed<…>` and `toStyle` already
  refused to set it — so `--color-surface-sunken: red;` in a block is refused too, naming the token and
  how to give it a range. One with a `range` may only be set to a value in it, branch by branch for a
  choice or a match.

  The same check covers the two other places a theme sets a token: **a project stylesheet** — the Vite
  and esbuild plugins stop the build at the file and line — and **a `style` attribute**, in the editor
  and `ramonda-check`. The generated `tokens.css` is left alone.

- 4710ebd: **A relative `url( … )` that points at no file is refused** (`url-not-found`). `url("./img/hero.png")`
  with no such file built without a word and shipped a 404 — a moved image, or a component moved away
  from its image, broke nothing anyone saw. The file is now looked for beside the source file, in the
  build, the editor and `ramonda-check`, and `@@font-face`'s `src` with it. A path from the site's
  root (`/hero.png`), another site and `data:` are left alone.

## 0.6.0

### Minor Changes

- e06b0f7: **Breaking: a block's logic has a new spelling, and the old one is refused.** Each old form is
  refused with an error that names its replacement.

  - **Code goes into a block as `$( … )`**, wherever it stands: `...$(base)`, `var($(width))`,
    `$(angle): 45deg`, and every condition and subject below. `{ … }` is CSS's own again.
  - **A theme variable is `$group.path`** — `$color.primary.main`, the group right after the `$` (it
    was `$.color.primary.main`). In code, the generated `css-system` exports one name per group:
    `import { $color, $space } from "./css-system"`, so a variable is spelled the same in a block and
    in TypeScript. There is no `$` export any more, and a group's name must be an identifier.
  - **A group is declared with its `$` too**: `variables: { $color: kind("color", { … }) }`. One
    spelling in the config, in a block and in code. `color: kind(…)` is refused — by the config's type
    in the editor, and when the config loads, with the message writing `$color`. The CSS names do not
    change: `$color.accent` is still `var(--color-accent)`.
  - **A condition is `when $( … ) { … }`**, and it gains `else when $( … ) { … }` and `else { … }`.
    The first condition that holds brings its group.
  - **`match $( … ) { … }` works at both levels**: `color: match $(t) { a => red; _ => blue; };` picks a
    value, and `match $(t) { a => ( color: red; padding: 4px; ); }` picks a whole group.
  - **A value may be a choice**: `border: $(error) ? 2px solid red : 1px solid #ccc;`, and choices
    chain. Both values become classes; the condition picks one.
  - The formatter writes `} else {` on one line, lines match arms up on their `=>`, lays a chain of
    choices out as a table, and takes parens off a branch.
  - `var(--color-accent)` written by hand for a variable the project declares is reported
    (`variable-by-hand`), naming `$color.accent`. A `$` naming a group the project does not have says
    which groups it has.
  - The checker now reads the value in every match arm and every branch of a choice, which it did not
    before: `color: match $(t) { a => redd; }` is reported like `color: redd`.
  - **What the build refuses, the editor now shows**, in the build's own words (`block-refused`):
    an `else` out of place, `when $(a) $(b)`, a condition inside a match arm, a choice with no `:`.
    It cannot be switched off, and neither can `block-in-a-template`, since the build refuses both.
  - **The Prettier plugin lays out a block's inside** as `ramonda-css format` does — it used to hand
    the CSS back as written — and the editor's hover explains `else`, `else when` and `match` too.
  - **`glued-hole` is gone.** It fired only beside `hole-not-allowed`, about a value that is refused
    anyway, and its advice led to that same refusal. A `rules` entry naming it is now refused as not a
    rule; take it out.
  - **A `match` with no `_` must name every value its subject can be** — `match $(size) { small => … }`
    over `"small" | "large"` is reported on `match`, naming `large`. The docs said this was checked;
    it was not, at either level.
  - A condition holding operators — `when $(p ? q : r)` — compiled to the wrong expression. It is one
    condition now.

  Update the VS Code extension to 0.3.0 with it: the colours follow the new spelling.

### Patch Changes

- 6ee19af: `@@property` with no `initial-value` is reported, unless its `syntax` is `"*"`. Every browser drops
  such a registration whole, so the property was silently unregistered.

## 0.5.0

### Minor Changes

- e98151a: **A block is a string.** `CssBlock` is the classes it compiled to, branded so a plain `string` cannot
  stand in for one — and `mergeClassNames` composes strings rather than maps.

  ```tsx
  const panel = @@( display: flex; gap: 8px; );

  <div className={panel} />                        // the classes it compiled to
  <div className={mergeClassNames("lead", panel)} />  // beside a class of your own
  ```

  **This is what `RMD020` was about.** A block used to be `{ <what it sets>: <the class> }`, because
  that was where _the thing set_ was written down — and a map is an object, so a block written in the
  markup was a new object on every render and a child receiving it re-rendered for nothing. The key is
  in the class name now, so two merges with the same contents are the same value, compared the way
  every other prop is compared. The one-slot cache that existed to paper over it is gone, and so is
  the question.

  What went with it:

  - **`compose`** — it was the primitive `mergeClassNames` was the boundary of, and with strings they
    are one thing.
  - **`block()` and `toStyleObject`** — a descriptor a call filled with a hole's values, and the
    `{ className, style }` a renderer with no `css` prop of its own spread. `className={panel}` is
    what that is now.
  - **`StyleMap`, `StyleEntry`, `StyleBlock`, `HoleValues`, `StyleVarValue`** — the shapes of a value
    that carried values.
  - In `@ramonda/core`: `applyCssBlock` and everything it did with custom properties, and the three
    runtime diagnostics about them — **`RMD062`**, **`RMD063`** and **`RMD064`**. A block is a string
    on `className` now, so there is nothing left for any of them to be about.

  **Two things a class string cannot carry, and each module registers what its own blocks need.** A
  table of all 98 shorthand families is 23 KB, 3.7 KB gzipped — larger than this whole runtime, and a
  page writing three shorthands would pay for ninety-five it does not. So a module registers the
  shorthands it writes, which is what a `padding` needs to clear a caller's `padding-left`. It also
  registers the conditions and property names the development order-warning reads, inside a
  `process.env.NODE_ENV` guard a production bundler drops.

  **The `;` rule moved with its hazard.** A value holding a `;` becomes a second declaration when a
  server-rendered `style` attribute is parsed back out of HTML — measured, `red; position: fixed;
width: 100vw` came out applied. That was `toStyleObject`'s and the framework's; a block sets nothing
  on an element now, and `toStyle` is how a value reaches one, so it is `toStyle` that refuses it.

  **A class this compiler did not write keys on itself**, which matters because
  `mergeClassNames("lead", @@( … ))` is how a block sits beside a class of your own. `keyIn` reads a
  key out of OUR spelling, and on a name that is not ours it reads letters — measured, `lead` and
  `head` both come to `ad`, so one would have displaced the other, and a class literally named `pl`
  was cleared by a `padding` beside it. A foreign class is keyed behind a space, which no key of ours
  can hold.

  `scripts/check-css-contract.mjs` is gone with the shape it compared: both packages say `string`.

- e98151a: **Every class name now says what its declaration sets**, and no name is only a hash.

  ```
  padding: 12px                  r-p-12px
  outline-offset: 4px            r-outline_offset-4px       (was r-outline-offset-4px)
  &:hover { color: red }         r-:hover.c-red             (was r-:hover-c-red)
  content: "a b"                 r-content-5dEHlFqj2        (was r-5dEHlFqj2)
  &[data-on] { color: red }      r-0W6pfz.c-red             (was r-QbofRLj5j)
  ```

  A class is two halves with a `-` between them: **what the declaration sets** — its context and its
  property — and the value. The first `-` is the boundary, so nothing in the first half may be one: a
  property's own dashes are written `_`, and the context joins the property with a `.`.

  **Why it has to be in the name.** Composing two blocks keeps, per thing set, the one written later.
  A block handed to another component arrives as classes and nothing else, so what a class sets has to
  be readable out of the class itself or a merge has nothing to decide with.

  Each half falls back on its own now, and the other one still reads. A hashed context is marked by a
  leading `0`, which nothing an author wrote can start with — no CSS property may begin with a digit,
  and every context begins with `:`, `.`, `_`, `@` or `[`. What still hashes a context is a selector
  list, a quote, and a `-`, which is what `[data-on]` and every `@media (min-width: …)` cost.

  Measured on this repository: 23 of 91 class names had nothing readable in them, and none do now. The
  class attribute grew 17% for it.

  **A key collision is a build failure**, asserted where the sheet is assembled, with both texts and
  both files named. Two hashed keys colliding would look to a merge like one thing set twice, and the
  earlier rule would be dropped from a page that renders — the one failure mode that is silent.

- e98151a: `@@property( … )` binds a TYPED name, and a property nothing sets is reported.

  ```tsx
  const angle = @@property( syntax: "<angle>"; inherits: false; initial-value: 0deg; );
  const dial = @@( transform: rotate(var({angle})); );

  <div className={dial} style={toStyle([[angle, "45deg"]])} />
  ```

  The binding's type is `CssVar<"angle">`, read from the `syntax` the declaration wrote, so `toStyle`
  refuses a length where an angle was declared — the same check a declared `$` variable already got,
  now answering for a registered property too. A `syntax` with no kind behind it — `"*"`, or a
  compound grammar — binds `CssVar<"any">`, which takes what CSS itself would.

  **`registered-never-set`** is the other half. `initial-value` is required, so a property nothing
  ever sets still renders: every element gets the initial, the page looks right, and nothing says the
  value meant to vary never arrives. It is reported on the declaration.

  Anything that mentions the binding in TypeScript counts as setting it — `style`, `toStyle`, a helper
  it is passed to — so the rule fires only when the name is written in exactly one place and read from
  blocks. A library exporting a property for its consumers to set is the one shape it is wrong about,
  and both escapes are asserted: a `ramonda-css-ignore` above the declaration, or the id turned off in
  `ramonda.css.ts`.

- a3973bb: **A shorthand now reaches the stylesheet as the longhands it sets**, and the eighteen numbered
  cascade layers become one.

  ```
  padding: 12px          r-pt-12px r-pr-12px r-pb-12px r-pl-12px   (was r-p-12px)
  border-top: 1px solid red
                         r-border_top_color-red r-border_top_style-solid r-border_top_width-1px
  background: red        r-bg-red                                  (unchanged — see below)
  ```

  ```css
  @layer ramonda.i, ramonda.a, ramonda.s64, …, ramonda.s01, ramonda.d8, …, ramonda.d1, ramonda.u, ramonda.c;
  /* was: @layer ramonda.u00, …, ramonda.u17, ramonda.c; */
  ```

  **Why.** Two classes on one element could set the same property — a `padding` and a `padding-left` —
  and only the stylesheet's order could decide between them. That is what the numbered layers were
  for. Split the shorthand and the question disappears: every declaration is a longhand, no two
  classes collide, and the merge settles everything by key where you wrote it. A `padding-left` after a
  `padding` simply replaces it.

  **Which families split.** 42 positional ones, answered by how many values were written, and 19
  bag-of-tokens ones answered by what each token IS — the whole `border` family, `outline`,
  `column-rule`, `flex-flow`, `list-style`, `text-decoration`. Both tables are measured in Chromium,
  Firefox and WebKit and a family is written only where all three agree and it reproduces its own
  corpus.

  **Which do not, and it is a fact rather than a shortfall.** A grammar with a comma, a slash or a
  repetition cannot say which part goes where, so `background`, `font`, `grid`, `animation`,
  `transition` and `mask` keep their shorthand. So does any value the compiler cannot vouch for: one
  holding a `var()`, a runtime value, an arm of a `match`, or a negative length where the family
  refuses one — because CSS drops a whole declaration when any part of it is invalid while a split
  would drop only the part.

  **The layer names are counts now, not positions.** `ramonda.s10` holds shorthands that set ten
  longhands, and `ramonda.d1` holds a longhand the compiler DERIVED by splitting one — weaker than a
  `padding-left` you typed, stronger than the `padding` it came from. That last shelf matters where
  two blocks are joined into a string instead of merged: nothing there knows which you wrote later,
  so the stylesheet decides alone, and without it a caller's `padding` could beat your own
  `padding-left` depending on which file the bundler put first. A position moved every family below it whenever CSS gained a property, so two stylesheets
  built a year apart disagreed about which layer `padding` was in; a count is a fact about the
  property and does not move. That is what makes a published package safe to drop into an application,
  and `scripts/check-layer-skew.mjs` holds it: the real compiler, the real sheet and the real merge, in
  all three engines and both load orders.

  **`!important` behaves like CSS now, and did not before.** Two important declarations on opposite
  sides of a layer boundary came out reversed — `background: red !important; background-color: blue
!important` gave red where the same two lines in one hand-written rule give blue, in all three
  engines. CSS reads layer order backwards for important declarations, so they go under a mirrored
  set of layers and land on the order you meant. It cost nothing you can see: the mirrored subtree is
  only emitted where an important declaration exists.

  **If you wrote CSS against these class names, it will need updating** — a rule targeting `.r-p-12px`
  has four classes to match now. Nothing else changes: the same declarations reach the page, and
  `@layer ramonda` is still the name to put in your own statement.

- 23840c8: A split shorthand now puts one more class in front of its pieces: the family's own key with an empty value,
  and no rule behind it. `padding: 8px` is `r-p- r-pt-8px r-pr-8px r-pb-8px r-pl-8px`.

  It tells the merge that a whole `padding` was written there, so everything `padding` covers, written
  earlier, is cleared before the pieces land. Two cases were wrong without it, both against a package
  built by an older release:

  - a longhand CSS added to a family after that release — its split has no piece for it, so nothing
    cleared it;
  - a property that was one longhand then and is a shorthand now, like `overflow` — the old class for
    the whole property survived a split written after it, and won.

- e98151a: **`state-is-a-tuple` — a state in an allow-list written `[{ … }]` is reported.** A nested rule in a
  style prop's allow-list is a LIST of declarations, and a one-element tuple constrains only the first
  of them.

  ```diff
   type CardStyle = {
     color?: Var<"color">;
  -  "&:hover"?: [{ color?: Var<"color"> }];
  +  "&:hover"?: { color?: Var<"color"> }[];
   };
  ```

  **The fault is silent, which is why it needs a rule rather than a line in the docs.** The tuple
  type-checks, the build passes, and the slot keeps working — for the first declaration inside the
  state. Everything under that one is accepted whatever it sets, and the caller who writes a property
  the component never offered is told nothing.

  Measured on this repository's own playground, the same `float: left` inside a `Chip`'s `&:hover`:

  | position in the state |            |
  | --------------------- | ---------- |
  | first declaration     | `TS2353`   |
  | second                | **silent** |

  A block compiles to one object literal per declaration, and a one-element tuple gives element 0 a
  contextual type and nothing else. `{ … }[]` gives every element one. Nothing else changes: the
  compiler already emits an array, and `CssBlockShape` already says `CssBlockShape[]`.

  The spelling this package shipped and documented was the tuple. It is corrected on
  [the reader page](/style-blocks/prop), in the playground, and in the design record.

  A tuple of more than one element is left alone — measured, every element has a contextual type
  there, so the slot does hold.

  **And the key is what decides whether a type is an allow-list at all.** A `&` has to continue as a
  selector does and an `@` has to name an at-rule that may nest, so a JSON-LD `"@type"` and a `"&ref"`
  of your own are not touched. The element cannot carry that test: of 34 ordinary field names tried —
  `x`, `y`, `content`, `order`, `filter`, `all`, `width`, `color` — all 34 are also CSS property
  names.

- 0bf9fb8: A shorthand whose value holds a `var()` now goes in its own layer, `ramonda.v`, instead of a layer
  named by how many longhands it covers. Such a shorthand can never split, and a count can move when
  CSS adds a longhand to the family — so a package built before that would have named a different
  layer. A word does not move.

  `v` sits above the counted shorthands and below the split pieces and the longhands you write. One
  order it cannot keep, and the build now refuses it as `narrower-after-a-whole-shorthand`: a narrower
  shorthand written after a wider one holding a `var()`, like `border: var(--x)` then
  `border-top: var(--y)`. Across two blocks, where the compiler cannot see both, the merge says so in
  development.

- eb52434: **A word one longhand of a shorthand has no place for is reported, and `!important` stopped being
  counted as a value.**

  CSS drops a whole declaration when any part of it is invalid; a split drops only the part. That rule
  was already here for negatives — `padding: 10px -5px` sets nothing in a browser and would have set
  the top and bottom. It is the same rule for WORDS, and nothing was checking them.

  Two things changed together, because the answer is one measurement:

  - the splitter refuses such a value, so a family keeps its shorthand rather than writing half of it.
    **`place-items` and `place-self` split for the first time** because of it — they had never been in
    the table, `place-items: start space-between` being a value no engine accepts and nothing
    refusing it.
  - the checker names it. `word-out-of-its-longhand` says which word, which longhand, and that the
    browser drops the whole line. It stays quiet where `unknown-value` already names the word, which
    is most of them; what is left is the word the property DOES take and the longhand it lands on does
    not — five values across the table, `place-items: left anchor-center` among them.

  **And a bug it uncovered.** `too-many-values` counted `!important` as a value, so
  `padding: 4px 0 0 0 !important` — four values and a flag — was reported as five, and every finding
  these rules produce refuses the BUILD. A page every browser renders did not compile. It had been
  invisible because the families whose maximum is four had room for the flag underneath it;
  `place-items`, which takes two, showed it the day it entered the table. All three spellings the
  engines honour are handled: `!important`, `! important`, `!IMPORTANT`.

  Run over `apps/docs`, both playgrounds, `packages/router`, `packages/query` and `packages/form`:
  no findings.

- fbbd064: `ramonda-css check` and the editor report a value in an allow-list that is not CSS, as
  `allow-list-not-css`. A slot typed `"font-weight"?: "notexisting"` refused every caller while the
  component that declared it said nothing; the value is now judged by the same rules as a declaration
  in a block, and reported where it is written.
- e98151a: **`allow-list-is-an-interface` — an `interface` handed to `CssBlock` is reported in those words.**

  ```diff
  -export interface CardStyle { color?: Var<"color"> }
  +export type CardStyle = { color?: Var<"color"> };
  ```

  TypeScript gives an interface no implicit index signature, so it satisfies no shape built out of
  one — and a block shape is. Measured: refused with the correct array spelling, refused with no state
  at all, and the identical `type` beside it clean. There is nothing to fix inside the interface.

  **This is the first rule here that REPLACES a compiler diagnostic instead of speaking past it.**
  `TS2344` already reports the fault, as *Type `CardStyle` is not assignable to type
  `{ [nested: \`&${string}\`]: CssBlockShape[] }`* — an index signature the author never wrote, and it
never says the word `interface`. So the one word that fixes it is the one word missing, and a reader
  goes looking inside the interface where there is nothing to find.

  The rule is reported on the same node the compiler used, and the `TS2344` there is dropped — in the
  build and in the editor, on both of the editor's paths. The path that matters is the one for a file
  with no block in it, which is what a file declaring a component's props usually is.

- c7ae55e: `background` now splits into its longhands, layer by layer: `url(a.png) center / cover no-repeat, red`
  is a list for each longhand and one `background-color`. Checked against Chromium, Firefox and WebKit
  over forty values, each after every other.
- e98151a: **Two style blocks joined into one string are reported.** `mergeClassNames` is what was meant.

  ```tsx
  <div className={`${base} ${card}`} />     // reported
  <div className={mergeClassNames(base, card)} />  // the answer
  ```

  A block is a string, so a browser takes the join. What it does not do is MERGE: every class from
  both lands and the stylesheet breaks the tie, so a declaration one of them meant to override
  survives. Measured:

  ```
  base = padding-left: 40px    card = padding: 8px

  merge   panel r-cur-pointer r-disp-flex r-p-8px
  join    panel r-pl-40px r-cur-pointer r-disp-flex r-p-8px
  ```

  `r-pl-40px` should have been cleared by the `padding` written after it — which is what CSS's own
  cascade does at a call site, and what a merge exists for. The page renders with one declaration too
  many, and nothing said so.

  **It only became reachable when the `css` prop went.** The brand already refuses a joined string
  where a BLOCK is wanted — a template of two blocks cannot be spread into another block — but
  `className` takes a plain `string`, and a block is a string, so the one place it matters is the one
  place the type cannot speak.

  Three spellings, one rule: a template, a `+` chain, and `[a, b].join(" ")`.

  **What it does not report**, because the ordinary case must stay quiet:

  - **One block beside a class of your own.** `` `lead ${card}` `` is correct and is what the
    documentation teaches — a foreign class keys on itself, so merging it changes nothing. Measured:
    the two give the same string byte for byte.
  - **The same block twice.** `` `${card} ${card}` `` duplicates classes, a duplicate class does
    nothing, and no declaration overrides another — so the message would be false for it, and a
    message that is false on the case it fires on is a false report however the rule is phrased.

- 7a10122: `animation: auto` is refused, as `value-differs-across-engines`. Firefox reads `auto` as the animation's
  name and Chromium and WebKit put it in no longhand at all, so the same line renders differently in
  each. Set the longhand you mean.
- c1855ef: On the Vite dev server, a file's stylesheet comes with a source map: a browser's style panel names
  the `.tsx` line beside each rule, and clicking it opens the declaration. A longhand split out of a
  shorthand points at the shorthand. The plugin turns on Vite's `css.devSourcemap` unless the project
  sets it; a production build is unchanged.
- b83e92d: Every form of a position now splits: `background-position` with three or four values and as a list
  (`left 10px top 5px, center`), and `mask-position` and `-webkit-mask-position`, which did not split at
  all. `mask-position` is written with the `-webkit-` longhands, the only names all three engines have.

  And two values `background-position` split before are no longer split, because every engine refuses
  them: `1px,` and `5 5`.

- 5f8959a: `font` now splits into its longhands, and writes out every longhand it resets — most of them are
  inherited, so one left out would take the parent's value where `font` gives the initial one. A system
  font (`caption`, `menu`) keeps the shorthand: what it sets is the platform's.
- 8830e6a: `grid`, `grid-template` and `mask-border` now split into their longhands. In the area form, line
  names that meet between two rows become one set and a row with no size is `auto`, as every engine
  reads it; area strings that do not make a rectangle keep the shorthand, since CSS drops them whole.

  Every shorthand splits now, but `all` — which has a layer of its own — and `-webkit-mask`, which is
  refused.

- 126a6c1: `transform-origin`, `perspective-origin`, `vertical-align` and `border-spacing` are longhands now. Some
  engine holds each of them as one — the first two in Chromium and Firefox, `vertical-align` in Chromium
  and WebKit, `border-spacing` in Firefox — and what the others expand them into is internal or
  prefixed, `transform-origin-x` among them. The engines disagree about what they reset, so no split
  could match all three. As longhands they sit with every other longhand, and a merge no longer clears
  anything when one is written.
- 4358175: `mask` now splits into its longhands, layer by layer, and resets the `mask-border` longhands too, as
  WebKit's `mask` does. A box one engine refuses keeps the shorthand: no engine takes `margin-box` here,
  and WebKit refuses `fill-box`, `stroke-box` and `view-box`.
- a2e7ce6: An arm of a `match` on a shorthand now splits like any other declaration:
  `padding: match({size}) { small => 4px; large => 8px 16px; }` picks `r-p- r-pt-4px r-pr-4px …` rather
  than one `padding` class. An arm that cannot split — one holding a `var()` — keeps its shorthand, and
  the other arms still split.
- e98151a: `match` — a value that varies, written as a choice between values that do not.

  ```tsx
  const chip = @@(
    padding: 4px 10px;
    color: match({this.variant}) {
      primary   => $.color.surface;
      secondary => $.color.text;
      _         => inherit;
    };
  );
  ```

  **Every arm is its own rule and its own class**, so nothing is built while the page renders — the
  subject only chooses between classes that already exist in the stylesheet. That is the whole of why
  it exists: variation that can be enumerated stops needing a value on the element.

  It is a lookup table, not pattern matching. There is no destructuring, no guard and no custom
  matcher; the subject is one expression and every arm is a literal.

  - **`_` answers for everything the arms above did not.** With no `_`, a subject naming no arm sets
    nothing at all and whatever was written above it stands — the answer `if ({…})` already gives.
  - **The keys are checked against the subject's type**, so an arm for a value it can never hold is a
    fault at the key. Each arm's value is checked against the property, so a fault lands on the arm
    rather than on the match.
  - **An arm may not hold a hole** (`hole-in-a-match-arm`), because an arm that carried the render's
    own value would cost exactly what a match exists to avoid. An arm that can never run
    (`match-arm-repeated`) and a match with no arms (`match-with-no-arms`) are reported too.

- b329b68: The merge now knows what every shorthand clears, instead of only what the modules on the page told it.
  A package built by an older release no longer leaves a longhand standing that CSS would reset: its
  `border: var(--x)` written after `border-top-color: red` now wins, as it does in CSS. This adds 3.2 KB
  gzipped to the runtime.
- e98151a: **`merge` is now `mergeClassNames`.** Rename your import; nothing else about it changed.

  ```diff
  -import { merge } from "@ramonda/css";
  +import { mergeClassNames } from "@ramonda/css";

  -<div className={merge("lead", @@( display: flex; ))} />
  +<div className={mergeClassNames("lead", @@( display: flex; ))} />
  ```

  **Because `@ramonda/core` exports a `merge` of its own** — `merge(previous, next, identity?)`, the
  deep structural merge that keeps a refetched row's identity — and the collision between them is
  silent rather than loud. It does not arrive as a duplicate identifier, because a file imports one or
  the other. It arrives as a call that means the wrong thing:

  ```ts
  import { merge } from "@ramonda/core"; // the wrong merge for this
  const out = merge("lead", card); // meant: a class beside a block
  ```

  Measured: `tsc` passes it — `previous` is `unknown` and `next` is `T`, so the call is well typed —
  and at run time it returns `card` with `"lead"` gone. A file importing from both packages is one
  line away from that.

  Leaving `merge` as a deprecated alias was considered and dropped: it would keep exactly the
  collision the rename exists to remove. The name says it merges class _names_, which is literally
  what it does now that the key lives in the class name.

  You are unlikely to be calling it yourself — the emitted module imports it by name, and that import
  was already aliased.

- ff0c4bb: Nine more shorthands split into their longhands: `flex`, `white-space`, `grid-area`, `font-synthesis`,
  `marker`, `contain-intrinsic-size`, `text-box`, `-webkit-text-stroke` and `-webkit-border-before`.
  Neither learned table could answer them — `white-space: pre` stands for two longhands at once,
  `font-synthesis: weight` switches one on, `grid-area: a` copies a name into the lines left out — so
  their rules are written out by hand, and every value is checked against Chromium, Firefox and WebKit.

  A value one engine refuses keeps its shorthand, since CSS drops the whole declaration there and a
  split would not: `text-box: cap`, which Chromium refuses, and `font-synthesis` with `position`.

- a01c341: No layer is named by a count any more. A shorthand that reaches the stylesheet whole — a `var()`, or
  a value a split refuses, like `font: caption` — is in `ramonda.v`, weaker than every longhand, so a
  longhand written after it wins as in plain CSS. The layer statement is now `i, a, v, p, u, c`, every
  name a word that means the same in every release, so a package and the application using it agree
  however far apart their builds are.

  The one order a word cannot keep is refused: a narrower shorthand after a wider one when both reach
  the stylesheet whole. The rule is now called `narrower-after-a-whole-shorthand`, and it covers those
  without a `var()` too.

- c812fdf: `offset` and `border-image` split in every form MDN documents: a position before a path, a rotation
  and a distance after it and an anchor after a `/` for `offset`; two slice values with a width and an
  outset after `/`s for `border-image`. Values checked against Chromium, Firefox and WebKit now
  include every example on MDN's page for each shorthand.
- a9f50d5: A split's pieces are in one layer, `ramonda.p`, instead of `ramonda.d1` beside seven empty ones kept
  in reserve. A split always reaches the longhands, and a test holds that for every family; the
  reserve guarded against something the test already forbids. `p` is also easier to read in devtools
  than a `d1` among the breakpoint digits `d0`…`d9`.

  And `-webkit-mask` is gone from the types, so an editor no longer offers it. Writing it is still an
  error that names `mask`.

- c50af09: `animation-range` was split wrong for a range NAME: `animation-range: cover` set the end to `normal`,
  and `cover 10%` read `10%` as the end. In Chromium and WebKit an end left out is the start's name, and
  a length after a name is its offset — `cover 10%` runs from `cover 10%` to `cover`. It is split that
  way now, and so is `timeline-trigger`, which did not split at all.

  The table had been learned from lengths and checked with lengths only, so the gate never asked it a
  word. It asks every family's own words now.

- e98151a: What a refused block SAYS, which is most of what a constrained prop is worth.

  **A kind's variables now print under one name.** `css-system/index.ts` emits `ColorVar`,
  `LengthVar` and so on, and `VarByKind` refers to them. A union alias expands wherever TypeScript
  prints it, so refusing one colour used to read:

      Type 'string' is not assignable to type 'Token<"color", Fixed<"#10b981">> |
      Token<"color", Fixed<"#00b37e">> | Token<…> | Token<…> | undefined'.

  and now reads `Type 'string' is not assignable to type 'ColorVar | undefined'`. The difference is
  larger for a whole allow-list, where six expanded tokens per property left nothing readable at all.

  It is the shape `Keyword<…>` already uses in the property map, reached from the other side:
  `Keyword<K>` survives printing because `K` stands naked in its union, while `VarByKind[K]` is an
  indexed access TypeScript resolves on sight — so the alias needs a name rather than laziness.

  **A block refused for carrying a runtime value now says why.** It read _`false` is not assignable to
  type `true`_, which names two types and tells nobody anything. The flag carries the sentence
  instead — the shape `CssCondition` and `CssSpreadable` already use — so the diagnostic TypeScript
  writes is the explanation, and there is none of ours to add.

  Run `ramonda-css codegen` to pick up the new aliases; they are additive, and `Var<"color">` is
  unchanged.

- e98151a: **The hole is gone.** A runtime value in a declaration is refused, everywhere.

  ```
  color: {this.brand};             ✗  hole-not-allowed
  ```

  It cost something on every element, and it could not be shared. Measured, the same colour written
  two ways: `color: red` emits `r-c-red { color:red; }` and the element carries a class, while
  `color: {this.brand}` emitted `color:var(--r-…-0)` with the value written on every instance — a list
  of ten thousand rows was ten thousand style attributes. And a hole belonged to the declaration it
  stood in, so two declarations wanting one value got two custom properties.

  Two things replaced it, and the message names both:

  - **`match`**, for a value that is one of a few. Every arm is its own rule and its own class, so the
    subject picks between classes that already exist in the stylesheet.
  - **`@@property`**, for a value that really comes from data. One declared name, read by as many
    declarations as want it, set once on the element.

  **The braces are untouched where they choose rather than inject.** `if ({…})` and `...{…}` merge
  whole groups, `match({…})` picks between classes, and `var({name})` names a `@@property` site the
  compiler resolves before the CSS is written.

  What went with it:

  - **`properties: { "*": { holes: false } }`** — the per-project setting. There is nothing left to
    switch off, and nothing to switch back on.
  - **`StaticCssBlock`** — the per-prop spelling of the same refusal, and `CssBlock`'s second type
    parameter with it. `CssBlock<Allow>` is the only block type now.
  - **The second block helper** the virtual file used to declare, since every block is static.

  **Every block is hoisted now.** There used to be two paths — a block with no hole was hoisted to
  module scope, one with a hole was built at the site — and the second is gone. Measured, that is the
  return: merging at a site allocates per element per render, 0.86 µs against 0.001 µs for reading a
  hoisted one.

- 9dc2b0f: New rule `root-in-a-block`: `:root { … }` or `html { … }` inside a block is refused. A block is one
  element's rule, so it meant the root under the element, which nothing is — it compiled and applied
  nowhere. `:root.dark & { … }`, the element under the root, is unaffected.
- e98151a: A prop can now say which declarations may be sent to it.

  `CssBlock` takes the allow-list as a type parameter, so a component can narrow what a caller may
  write into the block it accepts:

  ```tsx
  type CardStyle = {
    color?: Token<"color">;
    gap?: "8px" | "16px";
    "&:hover"?: [{ color?: Token<"color"> }];
  };

  function Card(props: { css?: CssBlock<CardStyle> }) {
    return <div className={@@( display: flex; ...{props.css}; )} />;
  }
  ```

  The allow-list is an ordinary block shape used as a type, so it is written in the spelling a block
  is already written in — the CSS names, and `Token<"color">` where only a declared variable will do.
  Nothing new has to be learnt and there is no second dialect beside `ramonda.css.ts`.

  What matters is where the fault lands, and it lands where the author can act on it: on the value,
  on the property name, or inside the state — never on the call. A caller writing `padding: 4px` into
  the slot above is told that `padding` is not in `{ color?: …; gap?: …; "&:hover"?: … }`.

  Two things fall out and need no rule of their own. A combinator — `& > span` — is refused because
  it is not a key in the allow-list, so a component's internal structure stays out of its API. And
  `!important` stops being writable the moment a value is narrowed to a literal union.

  A block in no slot is unchanged: the parameter defaults to every shape there is, so every existing
  `CssBlock` annotation keeps working and an ordinary block still takes every property there is.

  **This raises the `typescript` peer floor to 5.4**, for `NoInfer`. Fixing the allow-list before the
  block is read is what puts the fault on the property instead of on the call; inferring it from the
  block reported every declaration including the correct ones.

- 00a812d: On the Vite dev server every block adds one class naming where it was written,
  `r:src:src/Card.tsx:10`, so the browser's Elements panel shows which blocks gave an element its
  classes. Blocks merged side by side keep all of theirs; a spread leaves no mark. The classes have
  no rule and change no style. A build and a test run do not have them. New export:
  `withoutSourceMarks`, called by the dev build's code for a spread.
- 9ed3144: A combinator in a block's selector is written spaced — `& > span`, `& + b`, `& ~ c` — as Prettier
  writes CSS. `ramonda-css format` rewrites `&>span`, and `non-canonical-spelling` reports it until it
  is formatted. Inside parentheses and brackets nothing changes: `:nth-child(2n+1)` and
  `[class~="x"]` are left as they are.
- e98151a: **The `css` prop is gone.** A block compiles to its classes, so `className` takes one.

  ```tsx
  const panel = @@( display: flex; gap: 8px; );

  <div className={panel} />
  <div className={@@( display: flex; )} />
  <div className={mergeClassNames("lead", @@( display: flex; ))} />  // beside a class of your own
  ```

  There is nothing a second prop could do that the first cannot. It was an object carrying custom
  property names and this render's values for them — which `className` could not have held — and it
  has not been one since a runtime value in a declaration was refused.

  **It is declared as a message rather than deleted**, because deleting it would be silent: the
  element attribute type ends in `[val: Lowercase<string>]: any`, so a removed `css` would be `any`,
  the block would compile, the class string would be written onto the element as a `css` attribute,
  and nothing would say so. What a reader gets instead is the sentence, printed by TypeScript as the
  expected type.

  **`block-in-a-template` is new, and it is the gap this opened.** Joining a block with a class of your
  own is an ordinary thing to want now, and a template literal is the first thing anybody reaches for
  — and a template literal is TEXT to the compiler, so `` `lead ${@@( color: red; )}` `` used to find
  no block at all: the file was handed on untouched, `@@(` survived into the bundler, and the author
  got a syntax error somewhere else entirely. Measured across every position a block can be written in
  — attribute, assignment, call argument, object value, array element, `return`, arrow body, ternary —
  a template substitution is the only one that finds nothing, so it is reported, with
  `mergeClassNames` named as the answer.

  Gone with it: `applyCssBlock`, `CssBlockValue`, `RMD064`, and the `css` case in `formatAttributes`.
  A component's own prop may still be CALLED `css` — `Card({ css?: CssBlock<CardStyle> })` — and that
  is where an allow-list still narrows.

- e98151a: Two rules that read a style prop's type, not just its block.

  **`style-prop-never-used`** — a component takes a block through a prop and never puts it on an
  element. Nothing fails today: the caller's styles simply do not arrive, which is the quiet way a
  component and its caller come apart. A prop is used when it is spread into a block, put on a `css`
  attribute, or handed to another prop that also takes a block, and it is followed through a local on
  the way.

  **`style-prop-overridden`** — `...{props.css}; padding: 8px` where the prop's own type says a caller
  may send `padding-left`. The shorthand clears the longhand exactly as CSS says, so the merge is not
  wrong; what is wrong is a component that promised a property and then took it back. Two fixes and
  both are right: move the spread below, or take the property out of the prop's type. Only a narrowed
  prop is asked about — a bare `CssBlock` promised nothing in particular.

  Both need a `ts.Program`, so they run in `ramonda-css check` and not in the bundler adapters, which
  transform and never see a type. Both are turned off by id in `ramonda.css.ts` like every other rule.

  Also: **a block that may not be there can now be spread.** `...{props.css}` where `css` is optional
  was refused by the type while the runtime had always skipped an absent block, and an optional prop
  is the ordinary shape for a style a caller may send. `...{cond && block}` works for the same reason.

- 8c3337b: Values every browser takes that used to keep their shorthand now split: `grid-column: 1 / -1`,
  `grid-row: span 2`, `columns: 2`, `container: card / inline-size`, `place-items: first baseline` and
  `safe center`, `overscroll-behavior: auto none`, `border-radius: 1px 2px 3px 4px / 5px`,
  `text-decoration: underline overline`, `text-emphasis: filled circle red`, `offset: none`,
  `interest-delay: 1s 2s` and `timeline-trigger: --a --b`. A new gate holds a list of values people
  write, each of which must split and split right, so one that stops splitting is heard.
- 6d7520f: `-webkit-mask` is refused, as `resets-differ-across-engines`. Chromium and Firefox reset `mask-clip`,
  `mask-composite` and `mask-mode` with it and WebKit keeps them, so the same line renders differently
  in each — and no compiler can make it render one way. Write `mask`, which every engine has.
- 65cdb50: `ramonda-css check` and the editor now report `narrower-after-a-whole-shorthand` across blocks too:
  a block spreading one that sets `border: var(--x)` and then writing `border-top: var(--y)`, whether
  the spread block is in the same file or another, and the same two blocks passed to
  `mergeClassNames`. The compiler could only see it inside one block, and the merge only warned in
  development.

### Patch Changes

- e98151a: A type of your own called `CssBlock` is no longer mistaken for one.

  The two typed rules asked for the NAME, so a project declaring its own
  `type CssBlock = { className: string }` was told its prop was never used — in a file that has never
  heard of this package. The extension carries this plugin and an editor opens it on every project
  there is, so that is not a corner.

  A compiled block is known by its brand now, which is what a `unique symbol` is for: a look-alike
  carries none, an import alias carries it, and a generated `css-system` re-exporting the real one
  carries it too.

  **And the editor now agrees with the build about a file holding no block.** A component may declare
  a style prop and hold no block of its own — a wrapper that only hands its prop on. The build
  reported it and the plugin returned early, so the editor said nothing where a build would refuse,
  which is the one disagreement this package cannot afford.

- fd2386a: **A highlight's `contextSpan` stayed in the virtual file.** In a file holding a style block,
  `getDocumentHighlights` brought the name home and left the statement around it pointing into the
  copy the checker reads.

  Measured on a file of 103 characters:

  |              | `textSpan` | `contextSpan` |
  | ------------ | ---------- | ------------- |
  | at offset 6  | `6+1`      | `948+12`      |
  | at offset 19 | `19+1`     | `961+64`      |

  Nine hundred characters past the end of the file, inside the preamble the virtual copy carries. An
  editor uses that span for the context it shows beside a reference and around a rename, so it was
  reading a range that is not there.

  It was one member of a family that forgot: `elsewhere` and `findReferences` map both spans, and this
  one mapped the first.

  Found by asking the question the plugin's own note raises — _a span that is too long DELETES CODE_ —
  of every span-returning proxy at every offset in four shapes of file, which is now a test.

- 0e738f0: **A rule the build names is a key you can actually switch off.** Two of them were not.

  A refusal prints the rule's id in front of the sentence so a reader knows which key to write in
  `ramonda.css.ts`. For a fault about the SITE — where the block is written rather than what is in
  it — that key did nothing: `checkBlock` has honoured `rules` since it took a config, and
  `checkSite` and `checkNamedSite` never saw one.

  | written                   | `rules: { …: "off" }` | a `ramonda-css-ignore` above it        |
  | ------------------------- | --------------------- | -------------------------------------- |
  | `<div className=@@( … )>` | refused anyway        | let through, and it compiled correctly |
  | `@@wat( … )`              | refused anyway        | let through, and it compiled correctly |

  Two escape hatches offered as equals, one of them shut. Both work now.

  `block-in-a-template` is the one that must not be silenced — a block inside a `${ … }` reaches the
  bundler as `@@(` — and it was already right: it names no key, and neither hatch opens it. The rule
  table says so rather than leaving the reader to find out.

- e98151a: `ramonda-css format` lays out a `match`, which it used to leave as it found it.

  ```
  color: match({this.tone}) {quiet => $.color.accent.quiet;
    loud  => $.color.text.primary;};
  ```

  comes back as

  ```
  color: match({this.tone}) {
    quiet => $.color.accent.quiet;
    loud  => $.color.text.primary;
  };
  ```

  A match is a third shape beside a declaration and a nested rule, and it was laid out as neither:
  `opensAHole` asks whether the text in front of a `{` is a declaration's head, and `color:` is — so
  the brace that opens a match body was read as a hole and every arm was swallowed as one run of text
  nothing was allowed to touch.

  The arms line up on their `=>`, because a match is a lookup table and a table reads aligned. The
  padding is the longest key's, so an arm with a longer key than any before it moves the others — the
  ordinary cost of alignment, and the reason it is worth it here is that the keys are a closed set.

  The `;` that ends the declaration rides the closing brace, because that is what it ends.

- baba776: **`toStyle` now checks the NAME as well as the value.** A token beginning with `--` was returned
  verbatim, so a name carrying a `;` became two declarations on a server-rendered page — the hazard
  the value's guard already existed for, arriving through the other door.

  Measured end to end: rendered with `renderToString`, then read back through the browser's own parser
  on those bytes.

  | written                 | declarations that applied                |
  | ----------------------- | ---------------------------------------- |
  | `;` in the value        | none — the setting is dropped, as before |
  | `;` in the name, before | `--brand: red`, `--evil: red`            |
  | `;` in the name, now    | refused                                  |

  It is reachable only past the types, which is the threat model the value's guard is written for in
  the same file: _a cast, an `any`, a JavaScript caller, data off an API_. The name had no such belt,
  though `nameOf`'s other branch — `var(--…)` — already threw for a token this package did not write.
  A malformed name now throws the same way, because it is the same thing: not data that turned out
  wrong, but a name nothing here ever wrote.

  The alphabet is CSS's own ident and it was measured rather than guessed: every custom property in a
  real build of both apps in this repository is `--` followed by `[A-Za-z0-9_-]`.

  Two things this measurement found to be already safe, and they are worth stating: a `"` in a value
  is escaped to `&quot;` by the serializer, and a `<script>` in one does not become an element.

- bc2d681: **Three refusals explained themselves with a mechanism that no longer exists**, and one of them sent
  the author into the next error.

  A hole in a declaration used to compile to a custom property on the element. Since a runtime value
  is refused everywhere, it does not — but three messages still said it did.

  `hole-out-of-place` was the one that cost something. It read _a custom property holds a value, so
  write `property: {…}` and put the choice inside it_. Measured, all three spellings in one run:

  | written                  | reported                                                 |
  | ------------------------ | -------------------------------------------------------- |
  | `@@( {pick}; )`          | `hole-out-of-place` — what the author wrote              |
  | `@@( color: {pick}; )`   | `hole-not-allowed` — what the message told them to write |
  | `@@( color: var({A}); )` | clean — what works                                       |

  It names the open door now: `@@property( … )` read as `var({name})` for a value from data, `match`
  for a choice between a few.

  `hole-in-a-named-block` said _a hole is a custom property on an ELEMENT_, which also implied a hole
  would work outside a named site. Its own row in the rule table had the true reason all along —
  _which have no element_ — so the message a person reads disagreed with the table they look it up in.
  It now gives the reason and something to do.

  `glued-hole` opened with _a hole becomes one custom property_; the sentence that matters — text
  written against a hole is not part of its value — is unchanged and now leads.

- 8c9bd42: A leftover diagnostic test is gone from `viteBuild.test.ts`, and the gate that exists to catch that
  shape now sees it.

  `test("zzdiagnose")` built a whole Vite production bundle, wrote what it found to `/tmp/zzdiag.txt`,
  and asserted only what the test above it already asserted. It printed nothing, so
  `check-test-probes.mjs` — which exists because a probe once survived into _this same file_ through a
  green gate — had no reason to speak, and it rode through every run since it was committed.

  The gate reads string literals now as well as calls: a path typed into a test that points into the
  system temp directory is a person watching a file while they debug. A test that needs a temporary
  file makes one with `mkdtempSync(join(tmpdir(), …))` and removes it, which is what every fixture
  here already does. `SELFTEST=scratch` proves the new half can fail.

- e98151a: A failing run no longer explains style blocks when there are none.

  Every failure printed _N of those file(s) carry a style block. A position inside one is the author's
  own — the block is checked through a virtual file…_. That answers a real question, and it is noise
  about nothing when `N` is zero — which is now an ordinary outcome, because a typed rule reports on a
  prop's declaration and a component can declare one without holding a block at all.

  It is printed when a block is involved and not otherwise.

- a54561b: A generated `css-system/` file says how to regenerate it, on a second line under the first: edit
  `ramonda.css.ts` and run `ramonda-css codegen`. Regenerate once to pick it up; `codegen --check`
  reports the old header as out of date.
- 1bfa05c: `narrower-after-a-whole-shorthand` across blocks sees a `$` variable: `...{base}; border-top: $.border.top`
  after a base holding `border: $.border.thin` is reported, as it already was with `var()` written out.
  A variable inside a value, `1px solid $.color.a`, counts too.
- f70f3b0: Nothing asserted what six of this package's eight entries export, and one of them is
  `@ramonda/css/properties` — where `CssBlock` lives, and the entry this release reshaped most.

  The surface test said so itself: _there are two entries_. There are eight. `.` and `./compiler` were
  listed and `./config`, `./properties`, `./vite`, `./esbuild`, `./plugin` and `./prettier` were not,
  so a name could be added to any of them, or lost from one, with nothing to say so.

  All eight are listed now, read from source — `Object.keys` cannot see a type, and `./properties` is
  nothing but types. Seen to fail: a type added to `properties.ts` is reported.

- 8c3337b: `grid-column: 2` and `grid-row: 2` set the end line to `2`, where every engine sets it to `auto` — an
  item meant to start at line 2 was squeezed to nothing. Only a line NAME is copied into the end left
  out. Fixed, and line `0` and a `span` below 1 are no longer split, since every engine drops them.
- 41ea1a5: An ordinary declaration no longer replaces an `!important` one in a merge. Both carried one key, so
  the later won: `padding: 1px !important; padding-left: 2px` gave 2px where CSS gives 1px, even in one
  block, and `color: red !important; color: blue` gave blue. Importance is part of a class's key now
  (`r-!.pl-1px_!important`), so the two stay side by side and the `!important` layer decides, as in
  CSS.
- 481a93a: A narrowed block prop takes the CSS-wide keywords: `{ color?: Token<"color"> }` accepts
  `color: inherit`, `initial`, `unset`, `revert` and `revert-layer`, inside a state too. Nothing
  else is let through: another value, `!important` and a property outside the list are still refused.

  Two script files, each holding a block and neither importing or exporting anything, no longer
  report `Cannot redeclare block-scoped variable '__vars'`.

- 0180b6d: **Two registrations of one shorthand are merged, not overwritten.** A shorter list registered second
  used to take the first one's longhands away, and a `padding-left` then survived a `padding` written
  after it — silently, and decided by whichever module the bundler put last.

  `shorthands` is documented as idempotent, and `CLEARS.set` was idempotent only while the two lists
  matched. One build never produces two different lists for a key, because the emitter writes the whole
  family. Two builds do: a library shipping blocks compiled against another version of this package
  carries its own `_clears({ … })`, and an application on a newer one has both.

  | registered                           | `padding-left` then `padding`               |
  | ------------------------------------ | ------------------------------------------- |
  | the full family                      | `r-p-8px`                                   |
  | the full family, then a shorter list | `r-pl-40px r-p-8px` — the clearing was gone |
  | an empty list after a full one       | `r-pl-40px r-p-8px`                         |

  It takes the union now. First-wins would have the same problem from the other end, and these are one
  family described twice: clearing a longhand a newer version has dropped costs nothing, because no
  class carries it.

- 86275bc: **A block inside a `${ … }` is reported by name, and the checker stops piling six syntax errors on
  top of it.**

  A template literal is text, so such a block produces no site — and the whole CSS pass in
  `checkProject` sat behind `if (virtual !== undefined)`. The rule never ran, the file went to `tsc` as
  written, and `ramonda-css` answered with what the rule exists to replace:

  ```
  TS1005: ')' expected.
  TS1003: Identifier expected.
  TS2322: Type '{ className: string; red: true; }' is not assignable …
  ```

  Six of them, naming neither the block nor the line. The build has always said it properly, and says
  where in its own source why: _asked before the early return, since a file whose only block is in a
  template finds no site at all_. The checker asked after.

  Now:

  ```
  block-in-a-template: a style block inside a `${ … }` compiles to nothing — a template literal is
  text, and nothing here can see a block in one.

      Join it with `mergeClassNames` instead: …
  ```

  And the compiler's word about that file goes with it: the file cannot be parsed until the block
  moves, so every syntax error in it is about the fault already named — the same trade made wherever a
  rule of ours speaks first.

  **A `ramonda-css-ignore` no longer silences it in the checker, either.** It never could in the build,
  and a directive that quieted one and not the other left an author with a green editor, a green
  `ramonda-css`, and a failing build.

- e98151a: The style-prop page says where its types come from, and one thing it left out.

  Every row of its _where a fault lands_ table was put through a real project rather than trusted —
  prose tables are the one part of a page no gate reads. Two things came back:

  - **`Token` is exported from `@ramonda/css`, not from `@ramonda/css/properties`.** The page named it
    without saying where it comes from, and a reader following it would have imported from the wrong
    module. It says now, and it says that a project usually wants `Var<"color">` from its generated
    `css-system` instead — the same shape, one step tighter.
  - **A narrowed value refuses `inherit`**, and `initial`, `unset` and `revert` with it. That is worth
    knowing before it is met, so the page says it and shows the union that keeps them.

- 1e7fa61: `position-try` splits a fallback of several words: `--a, top left`, `--a, flip-block flip-inline`,
  `--b flip-block`. The rule follows what the engines take — all three refuse `x-self-start` and its
  kin, and all three take `flip-x` and `flip-y`.
- 19d88b3: Fixes from a review of the shorthand split:

  - A CSS-wide keyword in upper case (`margin: 1px INHERIT`) no longer splits an invalid value.
  - A quoted font name keeps a `/` or `,` of its own: `font: 12px "A/B", serif`.
  - A custom function (`--pad()`) and `attr()` are as unknown as `var()` and keep the shorthand.
  - `narrower-after-a-whole-shorthand` no longer refuses an `!important` wider shorthand followed by
    an ordinary narrower one, which renders correctly; nor, across blocks, a family the block sets
    again after the spread.
  - `value-differs-across-engines` reports `animation: AUTO` in any case.
  - The development warning no longer counts `all` as a whole shorthand.

- 7b7ba00: Fixes from a second review:

  - The development warning about conditions compares an important declaration with other important
    ones only. It skipped every important declaration with no condition, and compared one with an
    ordinary declaration, where importance decides.
  - `narrower-after-a-whole-shorthand` across blocks: a pair inside one block after a spread is
    reported once, a block spread twice counts twice, and after an `if` group the check stops rather
    than guess where the group ends. At a `mergeClassNames` call it is told only for a wider shorthand
    an earlier argument left.
  - `allow-list-not-css` no longer calls a value "not CSS" when it could not be read as one value.

- e98151a: The docs now explain a prop that takes a style block.

  `CssBlock<Allow>`, what goes in an allow-list, why one prop is one element,
  and the two rules the checker runs — all of it existed and none of it was written down for a reader.
  The only trace on the site was two lines in the generated rule table.

  The page is `/style-blocks/prop`, between composing and the config.

  It also fixes the gate that checks every example on the site. `shape()` decides how to wrap a fenced
  block — as a module, a class body or a method — and it was reading the VIRTUAL file rather than what
  the author wrote. The virtual file's preamble is one long line that the author's first line
  continues, so a block that IS a class declaration looked like one that was not: measured,
  `class Card extends Component<…>` holding a style block was wrapped in a class BODY and reported
  `TS1184: Modifiers cannot appear here` six times, about a wrapper nobody wrote. Any page documenting
  a component that takes styles would have hit it.

- e98151a: `style-prop-never-used` no longer reports a prop that is used.

  Six shapes a real component takes were put through the rule, and three were false reports: a prop
  destructured under another name (`const { css: mine } = props`), a prop handed to an ordinary
  function that takes a block, and one read through a getter. All three are ordinary code and all
  three were told their prop was never used.

  - A use is now **any expression whose contextual type is a block**, whatever position it is written
    in — a JSX attribute, a property in an object, an argument to a function. Asking the position's
    kind instead is what missed the third.
  - A getter's body is followed, as a method's already was.
  - A destructured binding is linked to the property it came from, through the thing being
    destructured rather than the declaration holding the pattern — for `const { css: mine } = props`
    that declaration's type is `any`, which had no properties to match.
  - And a destructured **local** is no longer a subject of its own, so the shape above is reported
    once, about the prop, rather than twice. An unused local is `noUnusedLocals`, not this.

  `style-prop-overridden` reports a declaration once however many spreads promised what it clears. It
  looped per spread, so two spreads reported the same declaration twice at the same character.

- f74627d: `text-wrap: pretty` is no longer split. Firefox does not have `pretty` and drops the declaration,
  where a split still set `text-wrap-mode` there. It keeps its shorthand, so Firefox ignores it as it
  would the same line written by hand — and it is not an error: one browser lacking a value is what
  its author expects. The grammar generator now asks every word a family takes, which is how it was
  found, and records such words as `partial`.
- a65a6cc: Fixes from a third review, in what splits and what keeps its shorthand:

  - A keyword in any case splits beside names of the author's own: `grid-column: SPAN 2`,
    `font: BOLD 12px serif`, `container: card / Inline-Size`. A name keeps its case, a grid line
    name in brackets too: `[None]` is not `[none]`.
  - `scroll-margin`, `scroll-margin-block` and `scroll-margin-inline` split a value of several
    lengths. A value with a percentage keeps the shorthand, since these families take none.
  - `position-try` splits a list of fallbacks, `--a, --b`, with the order on the first item only.
  - A value with an empty item, `transition: 1s,` or `1s,,2s`, keeps its shorthand. It is invalid
    CSS, and it was split as if the empty item were not there.

- d2b80b5: **A rule switched off in `ramonda.css.ts` is off for the checker as well as the build.** It had just
  become off for the build, and `checkSource` — which `ramonda-css` and your editor read — kept
  reporting it.

  `checkBlock` has been handed the config since it took one. The SITE checks never were, in either
  door, so `unknown-named-block` and `block-as-a-jsx-attribute` ignored the key their own message
  names. That was fixed for the build in this same release and not for the checker, which left the two
  disagreeing:

  | `rules: { "unknown-named-block": "off" }` | before            |
  | ----------------------------------------- | ----------------- |
  | the build                                 | compiled          |
  | `ramonda-css`, and the editor             | still reported it |

  Both now read the key. The test asserts the two doors AGREE rather than checking each alone, because
  that is the property: either tool moving on its own is the fault.

- e98151a: A typed rule no longer hides a TypeScript error, and no longer speaks about a declaration with no body.

  Both were found in one file — a wrapper that takes a block and passes one on, which is an ordinary shape:

  ```tsx
  declare function Inner(p: { css?: CssBlock<{ color?: string }> }): JSX.Element;

  export function Card(props: { css?: CssBlock<{ "padding-left"?: string }> }) {
    return <Inner css={@@( ...{props.css}; padding: 8px; )} />;
  }
  ```

  **`padding` is two different faults on one character** — the receiving slot does not allow it, and it
  clears what this component's own caller may send. The filter that stops a rule and the compiler
  saying one thing twice dropped the compiler's, so a real type error vanished behind a rule that had
  never mentioned it. The typed rules are left out of that filter: they answer a question TypeScript
  cannot ask, so a collision is never a repetition.

  **And `Inner`'s prop was reported as never used.** An ambient declaration states a signature and
  holds no code, so nothing in it could put a prop on an element — a subject whose scope has no body
  is no longer a subject.

- e98151a: The two typed rules can be told they are wrong, like every other rule.

  `style-prop-never-used` and `style-prop-overridden` honoured neither escape hatch. Every rule in
  `rules.ts` gets both for free — `checkBlock` drops the ones a config silenced and `checkedSource`
  drops the ones a directive covered — and these two take neither path, so they could not be switched
  off at all.

  Both now work:

  ```ts
  export default { rules: { "style-prop-never-used": "off" } };
  ```

  ```tsx
  // ramonda-css-ignore the prop is spread by a wrapper this file cannot see
  props: { css?: CssBlock },
  ```

  And the directive works in a file holding NO block, which is the ordinary shape for a component that
  only hands its prop on — those files are in none of the maps the block pass fills, so their
  directives are now read when there is something to say about them.

- e98151a: The two rules that read a style prop's type now run in the editor, not only in CI.

  `style-prop-never-used` and `style-prop-overridden` need a `ts.Program`, and the language service
  has one — so there was never a reason to make them a thing you meet on a push, after you have
  stopped thinking about the code.

  Asked for one file rather than for the project, which is sound as well as cheap: a slot's scope is
  the class or function declaring it, and a spread and the declaration below it are one block, so
  neither rule reaches past the file it is given. Measured at 0.15 ms for one call on a real 605-line
  file.

  A reduced editor server never reaches them — `getSemanticDiagnostics` is refused outright in
  `PartialSemantic` mode and a `Syntactic` service has no program at all — so neither rule can misfire
  where types cannot be resolved.

- 340bfb2: `padding: VAR(--p)` is no longer split. CSS function names ignore case, so it is a `var()`, and a
  split of one sets every longhand to a value that is invalid when the variable holds two: with
  `--p: 4px 8px` the page got `0px` where CSS gives `4px 8px`. Only the lower-case spelling was refused
  before.

## 0.4.0

### Minor Changes

- 8d71b71: A declaration another declaration on the same element switches off is reported.

  `display: block; gap: 12px` is valid CSS. Every tool is happy, the build is green, and the browser
  spaces nothing. So is `position: static; top: 20px`, and `text-overflow: ellipsis` beside a
  `white-space` that wraps — ten rows in all, each one a layout that is quietly a little wrong with
  the line that looks like the fix already in place.

  A stylesheet cannot ask this. It does not know which of its rules reach an element, so nothing built
  on ordinary CSS can say _this line does nothing_. A block is one element's rule, which is what makes
  it answerable here.

  A test does not catch it either. `getComputedStyle` reports the computed value rather than what the
  browser did: it answers `z-index: 10` on a static element and `width: 300px` on an inline one,
  having done neither.

  Every list in the rule was measured against Chromium rather than recalled, and that removed four
  properties from it — `align-content`, `justify-items`, `place-items` and `place-content` all work on
  a block container in current browsers, and reporting them would have reported correct CSS. `gap`
  keeps its multi-column exception for the same reason.

  A review found four more shapes it was wrong about, each of them correct CSS it would have failed a
  build over: `display: -webkit-box` and `-webkit-inline-box` lay out children and use `gap`;
  `aspect-ratio` still applies beside a height of `50%`, `calc(50% - 2px)`, `min-content`,
  `fit-content` or `stretch`, because none of those is a size until something has been laid out; and
  an `overflow-x` or `overflow-y` written beside `overflow: visible` brings both `resize` and the
  ellipsis back. All four are silent now.

  A neighbour the checker is already complaining about decides nothing either. `display: bolck` is a
  typo, and the author may be about to write `flex` — which makes the `gap` beside it right. Only the
  `display` row needed that, and the asymmetry is the reason: a row that fires when the value IS
  something, like `position: static`, goes quiet on a misspelling by itself.

  Silence is the default wherever the answer is not certain. A `...{spread}` merges declarations the
  reading block cannot see, so a disabling declaration counts only where it is written; `white-space`
  is inherited, so an absent one is never assumed; a nested rule is judged on its own declarations;
  and a hole is not judged at all.

  Switch it off with `rules: { "declaration-does-nothing": "off" }`, or for one line with a
  `ramonda-css-ignore` and a reason.

- 86b8e43: The editor says when nothing in the project can compile a style block.

  The plugin is contributed by the VS Code extension as well as by a `tsconfig.json`, so it answers in
  projects that have no `@ramonda/css` at all. Those projects cannot compile a block — a build stops
  at `Expected identifier but found "@"` — and an editor that only reported the CSS was promising a
  page the build would refuse.

  One diagnostic now says so, on the block, beside the CSS reports rather than instead of them:

  > `[no-compiler]` nothing in this project compiles a style block, so a build will refuse this file.

  That shape is TypeScript's own, measured rather than recalled. JSX in a project with no `jsx` option
  is not met with silence and not with a broken parse — it is parsed, it is checked, and one more
  diagnostic names what is missing:

  ```
  TS17004: Cannot use JSX unless the '--jsx' flag is provided.
  TS7026:  JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements' exists.
  ```

  A project that names the plugin in its own `tsconfig.json` has the package by definition and never
  sees the line.

- 7d3614e: A number written where only keywords go is reported.

  `display: 1` compiled in silence while `position: 1` was caught — and both take no number. What
  separated them was whether the generator could reduce their grammar to a primitive, which is not a
  fact about CSS.

  So the fact is measured instead. `scripts/build-numberless-properties.mjs` launches Chromium,
  Firefox and WebKit and asks `CSS.supports(property, n)` for seven different numbers; a property
  every engine refuses all of them for is one no number belongs in — 241 of the 566 unprefixed
  properties. It is the INTERSECTION rather than the union, because this says a number is _wrong_.

  Only when the number is the whole value: `box-shadow: 0 0 1px red` and `transform: scale(2)` are
  correct CSS on properties in that list, and both are measured to be accepted.

- 647c43f: A call that is never closed is named where it opens, instead of blaming the line below.

  `content: url(;` is a missing `)`. The value scanner counts parens and a block's own closer is a `)`
  like any other, so the value ran past `)}` and took the author's next line with it — and what they
  were told was about that line:

  ```
  `export const d = (1 + 2)` is not a declaration
  reported on line 4, for a mistake on line 2
  ```

  The new rule `unclosed-call` says which call is open, at the line and column it opens on. The strict
  read carries the same sentence, because it refuses the block before any rule can speak.

### Patch Changes

- 387bf4a: The unused-code dimming, and a `// TODO`, are the author's own again.

  An editor fades unused code out from `getSuggestionDiagnostics` — a third list beside the semantic
  and syntactic ones, and it was not proxied. It came straight off the virtual file with virtual
  positions, so an editor applied them to the author's text at face value: a word came out half
  coloured, and hovering a `<div>` said `'__cond' is declared but its value is never read` — a name
  this package wrote and nobody can act on.

  Where the stray fades LANDED depended on the file's length, which is why editing an unrelated line
  changed the symptom and why removing every `$` appeared to cure it: the preamble is shorter without
  one, so the same meaningless offsets fell past the end of the text instead of onto it.

  A sweep of the language service for every method that answers with a position found one more:
  `getTodoComments` reported a comment on line five at offset 838 of a file a hundred characters long.

  Both map home now, so a name the author really did leave unused is still faded and a TODO they wrote
  is still found — at the place they wrote it.

- 4f84832: The grammar tests no longer fail when the machine is busy.

  `includeExplanation` makes shiki tokenise each line twice — once for scopes, once for the binary
  form — and hands both passes the same 500 ms limit. When one trips it and the other does not, the
  two disagree about where the line ends and shiki walks the shorter list with an index from the
  longer one, reading `undefined`.

  It appeared once in a full run with every package's tests going at once, and not on an idle machine.
  Turning the limit down to 1 ms reproduces the same error every time, which is what identified it.

  The limit is now zero, which is `vscode-textmate`'s own default: a time limit has nothing to do with
  what these tests claim, which is the scope a grammar gives a piece of text.

- 3bffb83: A property name in the wrong case is one spelling of correct CSS, not a typo.

  `COLOR: red` was reported as _`COLOR` is not a CSS property_, with no suggestion — and measured in
  Chromium, Firefox and WebKit, all three set `color` to red and all three say
  `CSS.supports("COLOR", "red")` is true. Property names are case-insensitive in CSS.

  The rule for a value's keywords already settled this — _saying it does not exist is a lie the author
  cannot act on_ — and reached the verdict this now uses: still refused, under `non-canonical-spelling`,
  because a repository wants one spelling and `ramonda-css format` writes it.

  A real typo shouted gets its suggestion back too: `DSIPLAY` is six substitutions from `display` and
  none from `dsiplay`, so it used to come back with none at all.

- 30a5ba1: One mistake in a declaration is one finding, when a project narrows several things at once.

  `literal-not-allowed` is the widest of the rules a config turns on — it fires on any written-out
  value of a kind taken from variables — so it landed beside every narrower rule that also fired:

  ```
  letter-spacing: 2rem     literal-not-allowed + unit-not-allowed
  margin: 8px              shorthand-not-allowed + literal-not-allowed
  padding: 1px 2px         too-many-values + literal-not-allowed
  ```

  Each is one gesture by the author. The one kept is the outermost of the four, in the order the fixes
  nest: which property, then how many values, then where the value comes from, then how it is spelt.
  Reading the unit first is the case that shows why — it sends you to `2px`, which the same config
  still refuses.

  Two findings of the same rule are still two: `padding: 2rem 3em` names both units. Two declarations
  still keep their own, and anything CSS itself refuses is untouched.

- f828308: The editor plugin no longer reads every declaration file looking for a style block.

  The overlay let through anything named like source, which is every `lib.*.d.ts` and every `.d.ts` in
  `node_modules`. On a project holding one small file, 174 files reached it — 172 of them declarations
  — and 4.9 MB of text was read.

  That is work for an answer known in advance: a declaration file declares types and has no
  expressions, so there is nowhere in one for `@@( … )` to be written.

  The cost was paid per project rather than per editor session, so a monorepo paid it again for every
  package a file was opened in. Measured through a real `tsserver`, opening a second project: 248 ms
  with the plugin against 59 ms without. It is now 62 ms — the same as a plugin that does nothing at
  all, and the same as no plugin.

  The exclusion is asked of one function, `fileMayHoldABlock`, which the editor plugin, the CLI check,
  the Vite plugin and the esbuild plugin all now use. Adding it to the editor alone had made them
  disagree: a block written in a declaration file was two reports from `ramonda-css` and nothing at
  all in the editor. TypeScript's own complaint about such a file stays, in both, which is the honest
  answer — a declaration file allows no initialiser, so the block could never have been there.

- 4209148: A block the parser gives up on no longer hides every other file's faults.

  `ramonda-css` stops type-checking when it cannot read a block, and the reason is right: with no
  virtual file for that module, the compiler's word about anything is confusion about a file it could
  not read. But that reason was applied to the whole project — one unclosed `url(` in one file hid a
  misspelt property in another that had parsed perfectly, so a typo anywhere meant fixing a repository
  one error per run.

  The CSS rules that ran over files which read are reported now, under a heading of their own, after
  the refusal. The compiler's own diagnostics stay out, which is what the reason is about, and the
  file that failed still contributes nothing — its walk stopped before it found anything.

  ```
  [ramonda-css] 1 block(s) could not be read, so nothing was type-checked:

    src/Card.tsx:2:12
      `url(` is never closed — it needs a `)`.

  [ramonda-css] and 1 problem(s) in files that read:

    src/Other.tsx:2:3
      unknown-property: `colour` is not a CSS property. Did you mean `color`?
  ```

- 545c8b1: One mistake, one report, for a value a project refuses twice over.

  `width: 2rem` under a closed `values` list and a `units` list drew two findings — _`2rem` is not one
  of the values this project allows_ and _`rem` is a unit this project does not use_ — for one word
  and one fix.

  The rules a project switches on overlap by construction, which is why the check already collapses
  them to the outermost question: which property, then how many values, then where the value comes
  from, then how it is spelt. `value-not-allowed` was not in that list, and by the same reading it
  belongs between the last two: the unit is a detail of a value that is not on the list, and reading
  the unit first sends you to `2px`, which the list still refuses.

- 59e6045: A closed list of values takes numbers where CSS measures the property in numbers.

  `values: ["1", "10"]` on `z-index` type-checked and then every use of it was refused, because a
  quoted value is a CSS string and a browser drops the declaration. A setting that permits what the
  checker will not take is worse than one that refuses outright.

  The twenty-one properties CSS gives a `<number>` or an `<integer>` now take `readonly number[]`, from
  a generated type built out of the same grammar the rules read. Everything else still takes either — a
  time is `"120ms"` and a colour is `"#10b981"`.

  Both halves, because nothing type-checks a config in the build: the type refuses it in your editor,
  and the config validator refuses it with the number to write.

## 0.3.0

### Minor Changes

- 8773790: `ramonda-css codegen --check` reports a stale `css-system/` instead of writing it.

  The generated pair is committed, so something has to say when it stops matching the config beside
  it — the same question this repository already answers for `keywords.generated.ts`. Codegen knows
  both halves already, because it compares each file before writing for an unrelated reason, so
  `--check` writes nothing, names the files that no longer match, and exits non-zero.

- 6744f59: Three settings the types enforced and the build ignored now reach both.

  Vite and esbuild run the rules over a block and never type-check it, so a setting that only reached
  the types was one the dev server served anyway:

  ```
  properties["*"].units          padding-left: 2rem    checker refused, build served
  properties["z-index"].values   z-index: 5            checker refused, build served
  properties["*"].shorthand      padding: 8px          checker refused, build served
  ```

  The project-wide `units`, `arity` and `variablesOnly` already spoke in both, so half the config was
  enforced everywhere and half in one place with nothing saying which.

  Two new rule ids: `value-not-allowed` and `shorthand-not-allowed`. Per-property `units` joins
  `unit-not-allowed`. Each names the setting and the way out, and the compiler's word on that line is
  dropped so you meet one report rather than two.

- 15e675c: Codegen writes into `css-system/`, and the output is meant to be committed.

  ```
  ramonda.css.ts
  css-system/
    index.ts         $, Value, Var, and this project's narrowed property map
    variables.css    :root, and an @property for each
  ```

  ```ts
  import { $, type Value } from "../../css-system";
  ```

  **It was `ramonda.css.generated.ts` and `.css`, gitignored — and the reason for hiding them was
  wrong.** It said committing would let a config and its output drift apart in review. Hiding a file
  does not stop it drifting, it stops anybody seeing that it has, and it costs a fresh clone its `$`
  until something builds. `check-css-system.mjs` runs codegen and compares instead, the way this
  repository already gates its own generated tables.

  `outDir` renames the folder for a project that already has one by that name.

  **Breaking:** move your imports from `ramonda.css.generated` to `css-system`, run
  `ramonda-css codegen`, and drop the `.gitignore` lines.

- 87da03e: Three things a user met in the editor.

  **An accepted auto-import landed at the end of the file** when it carried a `@@` block, and at the
  top the moment the block was deleted. `getCompletionsAtPosition` was proxied and mapped the caret
  into the virtual file; `getCompletionEntryDetails` was not proxied at all, so TypeScript got the
  author's position against the virtual text and returned nothing the editor could place. It is
  proxied now, and every span a code action would write at is mapped home — an insertion that lands in
  this package's own preamble is written at the author's own first character, which is where an import
  belongs. A code action holding a span that maps nowhere is dropped whole.

  **`import { $ } from "@ramonda/css/properties"` was offered** beside the real `$` from a project's
  generated module. That `$` exists only to carry a sentence for a project that has declared no
  variables, and an export is an auto-import suggestion. The virtual file writes the fallback inline
  now, and nothing exports a `$` but the generated module.

  **`Var<K>` is generated**, for a value toggled between variables:

  ```ts
  const tone: Var<"color"> = toggle
    ? $.color.accent.quiet
    : $.color.accent.main;
  ```

  `Token<"color", …>` could not express this — its second parameter is the variable's range, and a
  toggled value has two. Inference already carries the local case; `Var<K>` is for a class field, a
  parameter, or a return type.

- fca1579: `ramonda-css explain <property>` — what your config does to one property, and which line decided it.

  ```
  $ ramonda-css explain border-radius

    border-radius   a length or a percentage

      shorthand      false        "*"
      arity          1            "*"
      variablesOnly  false        "border-radius"   overriding "<length>"
      units          px, rem      "<length>"

    from ramonda.css.ts
  ```

  `properties` is keyed by three selectors now, each binding more tightly than the one before, so
  knowing what applies to one property meant reading three entries and holding CSS's own
  classification in your head.

  It walks the same selectors as the merge the compiler reads, in the same order, and a test asserts
  the two agree over every property CSS classifies — an explanation that drifted from what is enforced
  would be worse than none, because it would be believed.

- 8efe87c: `ramonda-css format` lays out the expression inside a hole, through your own formatter.

  ```
  before   color: {this.toggle ? $.color.accent.quiet    : $.color.accent.main};
  after    color: {this.toggle ? $.color.accent.quiet : $.color.accent.main};
  ```

  The braces were closed up and the interior was left alone, so the one part of a block that is
  ordinary TypeScript was the one part escaping the formatter — while this command exists precisely so
  a file carrying blocks is laid out by the project's own tools.

  The expression is handed to the same formatter alone, wrapped as a statement, and unwrapped. Two
  answers are declined and the author's text is kept: one that spans lines, because the layout puts a
  hole on one line and could not place it; and a formatter that throws, because a broken `biome.json`
  is a setup fault rather than a reason to lose an expression.

  Only `format` does this. The checker, the linter and the editor read the author's text unchanged.

- a8d1cdc: Completion after a `:` in a nested rule, and after a property's `:` where nothing is typed yet.

  ```
  &:      hover, focus, first-child, …   (was: 828 property names)
  &::     before, after, …               (was: 828 property names)
  position:      static, relative, …     (was: 828 property names)
  ```

  Asked for while using it. The pseudo-classes come from `SELECTORS`, the same table `unknown-selector`
  reads, so what is offered and what is accepted cannot drift — asserted, not assumed.

  A prelude is told from a declaration by the `&` at the head of the run, which `CssBlockShape`'s
  `` `&${string}` `` key makes a fact. `&:hover { color: ` is still a value, because the `{` bounds the
  run before the `&` is reached.

  The empty-value case was a second fault found beside it: the caret after `position: ` mapped one
  character short of the value, landing in the key position of the next declaration. So `position: stat`
  worked and `position: ` did not — the answer arrived only once you had typed enough not to need it.

- 1cf3ab9: `toStyle` says why a value was refused, instead of `not assignable to type 'never'`.

  ```
  before   Type 'Token<"length", "16px">' is not assignable to type 'never'.
           Type 'string' is not assignable to type 'never'.

  after    Type '"24px"' is not assignable to type
             '"24px" & this_variable_may_only_be<"8px" | "16px">'
  ```

  Two errors on one line become one, and it names the values the variable may take. A variable
  declared with a bare value — which means it never changes — says that instead, and says to give it a
  `range`.

  The second parameter of a `Token` was always the RANGE rather than the initial value; a bare
  declaration has a range of one value, so the two coincide. What was missing was any way to read that
  off the refusal.

  `Fixed<V>` is exported and is written by codegen for a bare declaration. It marks the declaration,
  not the value: `range: ["16px"]` is a range that holds one value and stays settable.

- 8aae46c: `units` in `ramonda.css.ts` is keyed by unit family, and the flat list is refused.

  ```ts
  units: { length: ["px", "rem"] }      // lengths are these two
  units: { length: ["px"], time: ["ms"] }
  units: { flex: [] }                   // `fr` is not used here at all
  ```

  A family the config does not name is not constrained. The flat list — `units: ["px", "rem"]` — meant
  _every unit in CSS and nothing else_, and measured, a project stating the one rule it wanted got four
  reports on ordinary CSS it had no opinion about: `transition: all 200ms ease`, `width: 50%`,
  `rotate: 45deg`, `grid-template-columns: repeat(3, 1fr)`. To say "lengths are px and rem" you had to
  enumerate the units of five other families.

  **The old list is refused rather than reinterpreted.** Reading it as `{ length: [...] }` would make a
  project's rules quietly weaker on upgrade, with nothing said. The error writes out the family form
  with your own units in it.

  The `units` key inside `properties` is unchanged — that one is per property and reaches the types.

- c0887fc: `variablesOnly` reaches the build, and its message names the project.

  The types refused `padding-left: 8px` and the rule said nothing — but vite and esbuild run the rules
  and never type-check a block, so the build compiled what `ramonda-css check` refused. Only composite
  properties like `border: 1px solid red` were caught.

  ```
  before   TS2322: Type '"8px"' is not assignable to type
             'Narrowed<never, 0 | "0" | Token<"length" | "percentage" | "length-percentage">>'

  after    literal-not-allowed: `8px` is a length or a percentage written out, and this project
             takes them only from its own variables.

             Declare it in `ramonda.css.ts` and write `$.…`, or set
             `"padding-left": { variablesOnly: false }`.
  ```

  One report per fault: the compiler's word on that line is dropped where the rule has spoken.

  A call, a bare `0`, `var()` and a hole are not literals and are never reported.

- 55efdb7: `variablesOnly` is a selector inside `properties` now, not a top-level list of kinds.

  ```ts
  properties: {
    "*":             { shorthand: false },      // every property
    "<length>":      { variablesOnly: true },   // every property whose value is that kind
    "border-radius": { variablesOnly: false },  // that property, overriding the kind
  }
  ```

  `properties` is keyed by three things — the sweep, a kind, a property name — each binding more
  tightly than the one before, and merged key by key so shared configs still combine.

  It was a top-level key listing kinds, which made it the one setting keyed by kind while every other
  was keyed by property. Per property alone could not work: `<color>` reaches 40 properties and
  `<length>` 127.

  **What the list could not express is the exemption** — it was all-or-nothing per kind, so a project
  could not say _lengths from variables, except `border-radius`_.

  The old key is refused with the selector written out from its own list. `<length>` is the same word
  already written in `kind("length", …)`.

### Patch Changes

- f640c71: A numeric CSS value is a number in the type, so a narrowed property stops listing values you cannot
  write.

  ```
  before   "z-index"?: 0 | 1 | "0" | "1" | 10 | "10" | 100 | "100" | 1000 | "1000" | …
  after    "z-index"?: 0 | 1 | 10 | 100 | 1000 | Token<…> | CssGlobal | `var(${string})`
  ```

  The string spellings were there because the virtual file quoted every declaration's value, so
  `z-index: 1` reached the type as `"1"` — and a list of numbers refused its own permitted values. The
  fix admitted both spellings, which made the type offer `"1"` while `string-not-allowed` refuses
  quotes in CSS and is right to. A type that lists a value the checker rejects is a contradiction, and
  explaining it in a doc comment did not make it one less.

  `quoted` emits a numeric value as a number now. A hole is unaffected: a numeric one is a number, and
  a string one widens to `string`, which no narrowed property accepts.

  And `z-index: "1"` is one report — the compiler's `Type '"\"1\""' is not assignable` is dropped where
  the rule has spoken.

- 6dc92c6: A second fault on the same line is reported again.

  Where a rule of ours already speaks for a fault, the compiler's word about the same one is dropped
  so an author reads one message rather than two. That drop was keyed on the LINE — and a line holds
  as many declarations as you care to write, so anything else on it went too. Measured,
  `padding-left: $.size.control.mdd; color: $.size.control.md;` reported the typo and silently lost
  the kind mismatch beside it, which nothing else catches: a kind is a type, not a rule the build
  runs. In an editor, a one-line component lost an ordinary `const n: number = "no"` the same way.

  The unit is the declaration now, in both the checker and the editor.

- 2d8045e: A property typo reaches the build, and a unit is reported once.

  **`dsiplay: flex` compiled.** `unknown-property` reported dashed names only, because a bare one
  already had TypeScript's `TS2561` with its own _did you mean_. That held in the checker and not in
  the build — vite and esbuild run the rules and no TypeScript at all, so a plain typo and even
  `zzz: flex` reached the stylesheet with nothing said anywhere.

  The rule speaks for both now, with or without a suggestion, and the compiler's word on the line is
  dropped in the checker and in the editor — so it stays one typo, one report.

  **And `units` said twice was reported twice.** The top-level `units` and the one inside `properties`
  are different mechanisms with one name; setting both named the same value twice. Two different units
  in one value are still two findings.

- 0040ca8: A keyword written in a different case is no longer reported — and no longer makes a second class.

  **The class name did not fold case, and that was a live fault.** Measured through the real transform:

  ```
  color: currentColor;   →  r-c-currentColor
  color: currentcolor;   →  r-c-currentcolor
  ```

  Two atomic classes with identical CSS, and two hashes with them. `normalise.ts` folded a value's case;
  `flatten.ts` built its own canonical text and never called it. One class either way now.

  **And the report goes.** `color: currentColor` — the spelling MDN documents — failed the build, and
  every rule is an error. The forty `<system-color>` names went with it: `Canvas`, `ButtonFace`,
  `AccentColor`, each spelled here exactly as the specification prints them.

  `csstype`, the shared type behind emotion, styled-components, vanilla-extract and StyleX, lists
  `"currentColor"` outright and ends its colour with `(string & {})` — none of them reports a case at
  all.

  `ramonda-css format` still rewrites every one of them, asserted through the real biome on a value, a
  pseudo-class, an at-rule name and a media feature at once. A difference that is more than case —
  `&:before` for `&::before`, `2n + 1` for `2n+1` — is still reported.

- 0a98543: Two ways a literal still reached the page under `variablesOnly` are closed.

  **A colour longhand did not reach the build.** `color: red` was left to the types, and vite and
  esbuild run the rules without type-checking a block — so the checker refused it and the dev server
  served it. Forty properties. The rule reads them now, and the compiler's duplicate is dropped.

  **A custom property set in a block was an open door.** `--own: red; color: var(--own)` walked around
  the setting in one line.

  A custom property has no kind, so only a value that can be nothing else is reported — a hex, a colour
  function, a named colour, or a number carrying a unit. `--n: 3`, `--label: "red"`, `--own: var(--x)`
  and `--gap: 0` stay silent.

- 3235ffb: A closed `values` list is asked per property, which fixes three faults at once.

  ```
  values + variablesOnly        the literal went in anyway — `variablesOnly` was never consulted
  "<time>": { values: [...] }   emitted a row literally NAMED `"<time>"`, constraining nothing
  "*": { values: [...] }        silently did nothing at all
  ```

  The branch writing a closed list walked the config's own KEYS while every other setting asks
  `ruleFor(property)`. A kind selector exposed it; the `"*"` fault predates the selector and was never
  noticed.

  `"*": { values: [...] }` is refused now, naming the two places a closed list belongs. A list of
  permitted values for all 935 properties is not a thing anybody means, and doing nothing about it
  quietly was the worse answer.

  `variablesOnly` removes the literal spelling and nothing else — a variable is still held to the
  range by its declared value.

- d4ab885: The editor stops offering what the checker refuses, and the useful names come first.

  **A kind taken only from variables no longer offers its literals.** With
  `"<color>": { variablesOnly: true }`, typing `color: ` offered all 210 colour keywords — every one
  of which `literal-not-allowed` then refuses. `currentcolor` and the CSS-wide keywords stay, because
  the setting leaves those alone too.

  **A vendor-prefixed name sorts last.** `&::` offered eight `-moz-` and `-ms-` pseudo-elements ahead
  of `before`, because the list was alphabetical and a dash sorts before a letter.

- b7f69af: Two conditions that can both hold, setting one property, are refused instead of ordered by the build.

  `widthSlot` ranks a breakpoint by its width and everything else by a small table of bands — and two
  different conditions inside one band tie. A tie is settled by the sheet's position, which is the
  order the build happened to meet them. Measured in Chromium through a real Vite build, the same
  block each time:

  ```
  @supports (display: grid) { color: red; } @supports (display: flex) { color: blue; }

  alone in the file                            blue — what plain CSS says
  interfering block in ANOTHER file            RED
  interfering block in the SAME file           RED
  ```

  Both queries are true in every browser that can read the sheet, so the page depended on what another
  component wrote. There is no order to give the pair that is CSS's — one sheet, one position, and two
  blocks each wanting a different one — so the shape is refused with the fix in the message.

  Conditions that exclude each other still tie and still say nothing: a colour scheme, an orientation
  and a medium are most of what anybody writes, and no element is ever matched by both.

- b5c223b: A fault in `ramonda.css.ts` is said, not crashed — and the editor stops hiding one.

  Two halves of the same thing, both measured by running every way a config can be wrong through
  every consumer that reads one.

  A bad variable name, a value that would close the `:root` rule, and two variables spelling one
  custom property all threw a raw `Error`, so they reached a person as a Node stack trace with the
  sentence buried in it. `cli.ts` already draws this distinction — a fault in the author's file is
  said, a bug of ours is thrown — and these were on the wrong side of it. No test saw it, because a
  crash exits 1 and prints its message too. They are refusals now, and they name the config file,
  which the Vite build never did.

  In an editor, a config that could not be read was swallowed so it would not take the completions
  down with it. It took every RULE down instead, in silence: a block breaking two of the project's own
  settings showed nothing at all, under all nine broken configs measured. The completions still
  survive, and now one diagnostic sits on the block saying the config did not read and no rules are
  running. Only on files that hold a block.

- 5ec3de3: A `ramonda.css.ts` that does not parse is refused, instead of loading as an empty config.

  TypeScript's error recovery hid this completely. `transpileModule` reports nothing unless it is
  asked to, and it emits whatever it managed to build — measured,
  `export default { variables: {{{ };` became `exports.default = { variables: {} };`. So the config
  loaded: valid, empty, and nobody's. Nothing threw, nothing was undefined, and every consumer that
  does not type-check the config ran with no settings at all.

  Measured through a real Vite build: it exited 0 and shipped `.r-pl-2rem` and `.r-c-\#ff0000` — the
  unit and the hardcoded colour that very config forbids. Only `ramonda-css check` caught it, because
  it alone type-checks the file.

  The refusal names the line and column, and says what the silence would have cost.

- e9b0482: Saving `ramonda.css.ts` reaches a running dev server.

  It did nothing. The hot-update hook takes files that hold a block and a config holds none, so it
  returned at the first line — and both halves of what the config decides were left stale, silently:

  - `css-system/variables.css` is written once at `buildStart`, so a design token changed from `16px`
    to `40px` still served `16px`. It is a plain stylesheet the project imports once; nothing else was
    ever going to regenerate it.
  - every already-compiled file kept the rules the old config gave it, so a narrowed `units` or a
    property switched off was not enforced until each file happened to be touched by hand.

  The page was simply wrong with no word anywhere, and restarting the server was the only cure — on
  the one file this package tells people to edit. Codegen re-runs now and every file holding a block
  is invalidated, so the next request compiles against the config that is actually on disk.

  A config saved half-typed is swallowed, the same way a block that does not compile is: the transform
  reports it properly the moment anything asks for a file.

- ca1fbb4: The dev server is measured across files, across long editing sessions, and across a file gaining its
  first block.

  No behaviour changed for these — the sheet already withdraws what a file claimed before re-claiming
  it, so two files sharing an atom stay right when one stops naming it, and fifty saves leave a file
  serving its own two rules. Nothing asserted any of it: every dev-server test saved one file and
  asked about that file.

- dd0a211: The esbuild adapter knows which build it is running, so a config that depends on the environment is
  honoured.

  A config may be written `env.production ? ["px"] : ["px", "rem"]` — that dependence is the whole
  reason it is TypeScript rather than JSON. Vite is handed its mode and passes it on; the esbuild
  adapter read `NODE_ENV` alone, on the reasoning that esbuild is not told which build it is. It is
  told, twice. Measured, the same config and the same block:

  ```
  vite,    --mode production, NODE_ENV unset    refused
  esbuild, minify: true,      NODE_ENV unset    BUILT — `2rem` went in
  ```

  So a project bundling with esbuild and not setting `NODE_ENV` shipped the loose half of its own
  rules with nothing said anywhere.

  `define: { "process.env.NODE_ENV": … }` decides it, because that is a statement and it lets somebody
  minifying a development build say so. `minify` decides it next. `NODE_ENV` answers when the build
  says neither.

- 413ded1: `@@property`, `@@keyframes` and `@@font-face` type-check again in a project that declares variables.

  A generated `css-system/index.ts` replaces the shipped property map for every file under it — that
  is how a project's own settings reach a block — so a type it does not pass on stops existing. It
  passed on four and dropped seven, and three of those seven are the shapes a named block is checked
  against:

  ```
  TS2694: Namespace '…/css-system/index' has no exported member 'CssPropertyDescriptors'
  TS2694: … 'CssKeyframesShape'
  TS2694: … 'CssFontFaceDescriptors'
  ```

  The same file with no config had no problems at all, so what broke them was declaring a variable —
  the one thing the feature asks people to do.

- 72e2e65: Every config-driven rule is now measured inside a nested rule.

  No behaviour changed — the recursion was already right — but not one of the six rules a project's
  config turns on had ever been exercised inside `&:hover { … }`, which is exactly where a hover
  colour and a focus ring are written. A `variablesOnly` that stopped at the top level would have
  exempted the declarations most likely to hold a hardcoded one, and nothing would have said so.

- cfa89f2: The caret right after `@@` offers the named sites, not the whole world.

  Typing `css={@@` and then `(` produced `css={@@Component()}` — the completion list held **1003
  entries**, every global and local and keyword, with the first preselected so the next keystroke
  committed a name the author never typed.

  `css={@@}` has no parens yet, so no block is found and no virtual file is built; the question reached
  TypeScript against the author's own text, where that caret is an ordinary expression position.

  Four things can follow `@@` — a `(`, or `keyframes`, `font-face`, `property` — so that is the list,
  and `isGlobalCompletion: false` stops the editor falling back to its own word list.

  **And nothing in it commits by accident.** Narrowing the list was not enough: the first entry is
  preselected, so `(` still wrote `@@keyframes()` where a plain `@@( … )` was meant. The position is
  declared a new-identifier location — which it is, since `(` is a thing the author may type that is
  not in the list — and every entry says its commit characters are none.

  A single `@` is an ordinary decorator and is untouched.

- bdf8d9a: An `outDir` the editor cannot read is refused instead of quietly breaking `$`.

  The folder is read twice: codegen transpiles the config and gets the real value, while the
  per-file lookups read the key out of the config's text, because they run in an editor on every
  keystroke's worth of work. When the two disagree — the key computed, or merely mentioned in a
  comment earlier in the file — the generated files land in one folder and everything that reads them
  looks in another. What the author was shown was `Property 'size' does not exist on type "Declare
your variables in ramonda.css.ts, then run ramonda-css …"`: advice they had just followed.

  Codegen now compares the two readings and refuses, naming both folders, before anything is written.

- 1b6df4e: A vendor prefix and the standard property it renames are ordered, not left to build order.

  They are one property to the engine and two names to the model, so both landed in the same cascade
  layer — and inside a layer the winner was whichever the build emitted first. Measured in Chromium
  through a real Vite build, the same block each time:

  ```
  -webkit-box-shadow: 0 0 1px red; box-shadow: 0 0 9px blue;

  alone in the file                            blue   — what plain CSS says
  after a block naming `box-shadow` first      RED
  after a block with the same two, reversed    RED
  ```

  The page depended on what another component wrote. The prefixed form now sorts first, so the
  standard property wins wherever both appear and wins the same way in every build — which is also
  what every author means by a prefixed fallback. Writing them the other way round is an override the
  sheet cannot honour, and `override-out-of-order` says so with this pair's own reason.

  A prefixed shorthand borrows its standard form's breadth too: `-webkit-border-radius` sat in the
  longhands' own layer and lost to them.

- d5e85a8: A wrong setting inside `properties` is refused with a sentence, instead of crashing or being ignored.

  The config validator checked the top-level keys and the `properties` keys, and stopped there. Inside
  an entry, `units` and `values` reached `.map` on a non-array: measured,
  `properties: { "<length>": { units: { length: ["px"] } } }` threw `units.map is not a function` out of
  codegen, with a stack naming neither the file nor the key — and from an editor that throw comes out
  of `getScriptSnapshot`, which takes down completion, hover and every squiggle in the project.

  `units` was the sharp one, because the top-level key changed to be keyed by family and says so when
  a list arrives. Per property it is still a list — one property, one set of units — so an author
  applying the top-level lesson one level down was thanked with a crash. The message now says which
  shape belongs where.

  `shorthand: "no"`, `variablesOnly: "yes"`, `arity: "2"` and a key that is not a setting at all were
  accepted in silence and did nothing. A misspelled property name was too: `"<lenght>"` was refused
  and `"padding-lft"` was not. All of them are refused now, with the near miss offered.

- 563310b: A quoted value is one fault, and the type says why both spellings are there.

  `z-index: "1"` under `values: [0, 1, 10]` gave two findings, and the second was worse than
  redundant — _takes only 0, 1, 10 … and this is `"1"`_ names a value that IS in the list. The fault
  is the quoting, which `string-not-allowed` already says. `value-not-allowed` leaves it alone now.

  **And the string spellings in the type are explained where they are met.** Configuring
  `values: [0, 1, 10]` and hovering showed `"0" | "1" | "10"` beside the numbers, which reads as a
  widening and is not one: a block is CSS, so `z-index: 1` reaches the type as the string `"1"`. The
  doc comment says so, rather than leaving it to be worked out from the union.

  The module's header count is counted rather than derived from line shapes — the longer comment made
  it read `207.5 properties`.

- 4c5a186: Silencing a rule your own config turned on is refused, naming the setting that works.

  Three settings reach both a rule and a type, and a rule severity can only reach the rule — so
  `rules: { "literal-not-allowed": "off" }` beside `variablesOnly: true` left the error in place and
  swapped a message naming your project for `Narrowed<never, Token<…>>`. Only `arity`, which has no
  type behind it, silenced completely.

  The config now refuses the combination and says which setting to change instead. Silencing a rule
  this config did not turn on is unaffected.

- 84ba8f3: `border-radius` can be narrowed now, along with nine relatives.

  Its grammar is `<length-percentage>{1,4} [ / <length-percentage>{1,4} ]?` — four corners, then four
  again after a slash, one primitive throughout. The classifier wanted every piece of a sequence
  bracketed and the first one is not, so the property a design system constrains right after padding
  could not be narrowed at all.

  A `/` separates values in CSS and never is one, so skipping it cannot admit a grammar holding two
  kinds: `font`, `grid`, `border-image` and `mask` stay unclassified where they belong.

  `PRIMITIVE` 195 → 205, nothing lost and nothing reclassified. The elliptical `border-radius:
50% / 20%` and `animation-range-start: entry 50%` are measured and guarded — a classified property is
  a narrowed one, which is where refusing correct CSS becomes possible.

- e2322c3: A declared name or value that would break the generated stylesheet is refused.

  Neither was checked. The emitted module parsed in every case; the CSS did not, and two of these mean
  something other than what they say:

  ```
  value `a;b`   →  --a-b: a;b;     the `;` ends the declaration, `b;` is left over
  value `a}b`   →  --a-b: a}b;     the `}` CLOSES `:root`, and every later variable escapes the rule
  a newline     →  --a-b: a        the value is cut in half
  name `b*c`    →  --a-b*c: 8px;   not a custom property name at all
  name `b"c`    →  --a-b"c: 8px;   nor this one
  ```

  The permitted name set is not invented: the editor's grammar matches a `$` path as
  `(?:\.[A-Za-z0-9_-]*)+`, so a segment outside it is a variable `$` could never reach — codegen was
  writing one anyway.

  A dot in a key still reads as nesting, which works and is now written down.

- 558f421: The VS Code extension moved out of this package, from `packages/css/vscode` to `tools/vscode-css`.
  Nothing this package ships changes — `files` is `["bin.mjs", "plugin", "dist", "README.md"]` and the
  extension was never in it. The marketplace identifier, the grammars and the formatter are all
  unchanged.

  It moved because of where it sat rather than what it is. Changesets attributes a changed path to the
  package that owns it, so every extension-only edit — a readme line, a version bump — demanded a
  changeset for `@ramonda/css` and a release of a tarball that had not changed. The extension is not a
  workspace package, does not go to npm, and carries its own version and changelog; it was under
  `packages/` only because that is where it was written.

  If you referenced the folder directly, it is `tools/vscode-css`. `pnpm extension:package` from the
  repository root is unchanged.

- 556eaf7: The message for a custom property nothing sets points at a key that accepts it.

  It offered four ways to fix a `var(--name)` nothing sets, and one of them was _add it to `variables`
  in `ramonda.css.ts`_. That key became the declarations `$` is built from and refuses a bare list, so
  an author following the advice was told _that was its old meaning … those go in `alsoSets` now_ —
  the tool sent them somewhere that turned them away, and the refusal did the teaching the message was
  already trying to do.

- 22d5e73: Two places that wrote without looking at what was there.

  **A placeholder that came back twice** left this package's own marker in the author's file. `restore`
  refused a placeholder the formatter had eaten and not one it had duplicated — the first got its block
  and the second kept `/*@ramonda-css:0*/ 0`. Refused now, for the reason the missing case already
  gave: there is no correct output to fall back to, so there is no output.

  **Codegen overwrote a hand-written `ramonda.css.generated.ts`** and said nothing. That loss is
  unrecoverable — the name is in `.gitignore` by this package's own instruction, so there is no copy.
  A file at that name which does not carry `@ramonda/css` is kept, and the run stops with what to do
  about it. Looked for loosely, so a file written by an older version is still ours.

## 0.2.0

### Minor Changes

- 42429fe: **A style block written as a bare JSX attribute is refused.** `css=@@( … )` no longer compiles; write
  `css={@@( … )}`, or give the block a name — `const panel = @@( … )` — and pass that. Both were always
  supported, both compile to the same class, and nothing else changes.

  A block is a **TypeScript value**, and a bare attribute is the one spelling that is not one:
  supporting it meant this package extended JSX rather than TypeScript. It also could not be made to
  work properly. An editor stops consulting syntax injections the moment it enters a tag's attribute
  list, so the spelling was coloured only as the first attribute on the tag's own line and read as an
  error everywhere else; and Prettier never offers a plugin the chance to print an attribute value, so
  the formatter handed back the braced form regardless — the file you saved was not the file you wrote.

  The refusal is `block-as-a-jsx-attribute`, on the attribute name, in the build and in the editor. It
  names the spelling to write. The rule ran as `uncolourable-block` before this, a suggestion the build
  ignored, which was right while the spelling worked.

  The documentation moved with it. `/style-blocks` is seven pages now instead of one of 1468 lines, and
  it has an install section, which it did not before.

## 0.1.0

### Minor Changes

- 691c632: `@ramonda/css`: style blocks, published

  A style block is `@@( … )` written beside the markup, and what goes inside it is CSS. Before the
  build, every static declaration becomes a class that already exists in a stylesheet, and every
  `{ … }` hole becomes one CSS custom property the element carries — so the runtime sets values, never
  rules.

  ```tsx
  <div css=@@(
    display: flex;
    gap: 8px;
    border-left: 4px solid {this.accent};
    &:hover {
      border-left-color: #00b37e;
    }
  )>…</div>
  ```

  **Everything a tool needs to read the syntax ships here.** The compiler, plugins for Vite and
  esbuild, a language-service plugin for the editor, a Prettier plugin, and `ramonda-css` — a formatter
  and linter wrapper for biome and oxlint, which have no plugin surface for a syntax they cannot parse.

  **Nothing in the entry imports the framework**, at any depth: a page that loads a compiled block
  pulls in a class name and a map of custom properties.

  The editor's colours are a separate install, because a grammar costs nothing and a compiler does:
  **Ramonda CSS** on the Visual Studio Marketplace.
