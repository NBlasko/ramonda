# @ramonda/css

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
