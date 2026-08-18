# @ramonda/check

## 0.9.0

### Minor Changes

- 5a11869: A fourth rule family: rules that read one RENDER, and the first two of them.

  **What the other three could not answer.** A class rule sees a class, a module rule a file, an
  element rule one element and its ancestors — enough for "is this `<tr>` inside a table", and nothing
  at all about two elements that never meet. An `id` claimed twice and a heading level that jumps are
  both questions about a whole markup tree, and no subject that size existed.

  **`TreeRule`** takes one render — one top-level piece of JSX, with every element in it in document
  order. Deliberately not the composed tree: what `<Panel />` renders depends on its props, its state
  and what its slots were filled with, and this package does not guess.

  **The family exists for one guard, not for the walk.** A per-class rule could have walked the JSX
  itself. What cannot be left to each rule is deciding whether two elements are ever really both
  there: `{editing ? <input id="x"/> : <span id="x"/>}` is two ids in the source and one in the
  document. So every node carries `alwaysPresent`, computed once — anything under a condition, a
  guard, a `switch` or a callback is `false`. Proved load-bearing: forcing it to `true` fails four
  tests, every one of them a piece of correct markup being reported.

  The two rules on it, both warnings and both silent across every app and package here:

  - **`duplicate-id`** — two always-present elements in one render with the same literal `id`. Nothing
    fails loudly when this happens, which is why it is worth reporting: `getElementById` and `#x`
    answer with the first and never mention the second, `<label for>` labels the first — so the other
    control is nameless in the accessibility tree, not merely visually — and `aria-labelledby`,
    `aria-describedby` and a fragment link resolve the same way.
  - **`heading-skips-a-level`** — a heading more than one level below the one before it. Headings are
    the document's outline, exposed to a screen reader as a navigable list, so `h1` then `h3`
    announces a section nested inside one that does not exist. Going back UP is not reported: `h3`
    then `h2` is one section ending and another beginning.

  A heading that may not be there **breaks the chain** rather than being skipped over — found by
  running it, not by reading it: `<h1>`, `{detailed && <h2>}`, `<h3>` was reported as a skip, and that
  markup is correct whenever `detailed` is true.

  Both were proved not to be silently dead by planting them into `DocPage`, the docs' own page
  component, and watching the CLI name each one.

- 62758d6: `duplicate-key-among-siblings` — two children of the same parent written with the same `key`.

  A key is how the diff decides that the node it is looking at is the node it saw last time. Two
  children claiming the same one means only one can be matched: the other is treated as new, so its
  state and its DOM land on a node that is not it, while the page still looks right.

  Read from the PARENT, because the fault belongs to neither child on its own — each is a good
  element with a good key, and what is wrong is that they are siblings. That is also what makes "among
  siblings" exact: the same key under a different parent is a different key and is never reported.

  Keys written as literals only, strings and numbers alike. `key={row.id}` may well collide at run
  time and deciding that needs the data, which is what `RMD002` is for.

  A warning for now, and an error in a later version — the rule for a new rule here, kept even though
  a duplicate literal key is not a judgement call.

- 278ca1e: `role-takes-no-name` — an `aria-label` written on something the specification forbids naming. This
  is the last of the ARIA tables, and it is deliberately a **slice** of the role matrix rather than
  the matrix.

  An `aria-label` is not a tooltip and not a comment: it is the accessible NAME of a thing in the
  accessibility tree, and each role's characteristics say whether it may have one. A `<div>` is
  `generic` — the role for an element that carries no meaning — so there is nothing for a name to
  name. `<div aria-label="Filters">` does not label a region. It does nothing: the attribute is in the
  DOM, visible in the inspector, and a screen reader announces the children exactly as it would have
  without it. `role="presentation"` is stronger still and removes the element from the tree entirely.

  **Why not the whole matrix.** Which of the ninety-odd roles supports which `aria-*` would be the
  most dangerous table this package could carry: it is read to report an attribute that is NOT
  supported, so every cell missing from it reports correct markup, and there are thousands of cells.
  Naming is the part that is unambiguous, short, and worth having on its own. The rest of the matrix
  is not planned.

  A written `role` always wins over the tag's own, which is what makes this safe: `<div role="region"
aria-label="Filters">` is correct and common, and a role this cannot read silences the element.
  `<section>` is left out of the tag table for the sharpest version of the same point — it maps to
  `region` **when it has an accessible name**, so naming it is not merely allowed, it is the
  documented way to write one.

  An attribute whose case is wrong is not a name. `aria-labelledBy` reaches the DOM as a different
  attribute from `aria-labelledby`, so it is `unknown-aria-attribute`'s business — matching it here
  would report that the name does nothing, for the wrong reason. Found by running the rule over the
  fixtures that already existed, where it also turned up two lines written as "not reported" that
  really were faults.

  Zero reports across every app and package here. Both directions proved on real code: `aria-label` on
  the docs' existing menu **button** reports nothing, and the same attribute on a `<div>` reports.

- 0ba2fa9: `role-missing-required-aria` — a role written without the states and properties it cannot work
  without.

  The ARIA rules so far all read one direction: is this name in the vocabulary, is this value in the
  list. This reads the other. Every role in the fixture is real, every attribute present is spelled
  right, and the markup is still broken — because some roles mean nothing on their own.

  A `div` has no checked-ness, no level and no value. So `role="checkbox"` with no `aria-checked`
  announces a checkbox in a state nothing can report, which is worse than the plain `div` would have
  been: at least a `div` reads as what it is. `role="heading"` with no `aria-level` has no place in
  the outline; `role="slider"` with no `aria-valuenow` is a slider at no value.

  `ROLE_REQUIRES` is the "Required States and Properties" line from **WAI-ARIA 1.2**, and it is the
  first table in this file that has to lean **short** rather than long. The others are vocabularies,
  read to report a name that is NOT in them — a short list there reports correct markup. This one is
  read the opposite way, so an entry that should not be here reports correct markup directly. Left
  out on purpose: every conditional requirement (`separator` needs `aria-valuenow` only when
  focusable, and nothing static can say whether it is) and every requirement that moved between ARIA
  1.1 and 1.2, `option` and `spinbutton` among them. A requirement people disagree about is not one
  to fail a build over.

  Only an **explicit** role is judged. A native element's role is the host language's and the host
  language supplies what it needs — judging those would report every correct `<h2>` there is — and
  `STATE_FROM_THE_ELEMENT` covers the case from the other side, where `<input type="checkbox"
role="checkbox">` carries its state natively. Nor is a fallback chain judged: `role="switch
checkbox"` is a list of alternatives, not one claim.

  The attribute counts as present when it is written at all, expression or not. Whether
  `aria-checked={checked}` holds something the spec permits is `aria-value`'s question, asked on the
  same element.

  Zero reports across every app and package here. Both halves proved on a real component: with
  `role="combobox"` planted beside the docs' existing `aria-expanded` there is no report, and with
  `role="checkbox"` there is one.

- d6044a4: Two rules the framework already reports at runtime, now provable before anything runs.

  `row-without-a-key` — a row built from data with no `key`, from a `map` or from `list()`. From a
  `map` there is no identity at all: rows are matched by position, so inserting anywhere but the end
  hands every row below it the previous row's state and DOM. From a `list()` the framework infers an
  identity from what makes a row different from its siblings, and a key you write wins over it — so a
  key is the difference between an identity you chose and one that was inferred, and inference can
  fail (a row whose every field is nested or shared with its siblings has nothing to be told apart
  by). It matters most in the commonest case: data that arrives fresh, where every object is new and
  there is no reference left to recognise.

  Only the element a row-building callback RETURNS is asked for a key — in
  `rows.map((row) => <tr><td /></tr>)` the `<tr>` is the row and the `<td>` is not. A component row is
  asked too, unlike every other element rule, because the component is what holds the state that goes
  to the wrong row.

  `class-instead-of-classname` — `class` where Ramonda reads `className`, so the styling it names
  never applies. It fails invisibly: the element renders, the class string is in the DOM, and the hunt
  starts in the stylesheet, which is the one place the fault is not. Host elements only; on a
  component `class` is a prop that component declared.

  Both are warnings. `class-instead-of-classname` is quiet across this repository;
  `row-without-a-key` reports 17 places, every one of them a `list()` relying on inferred identity.

- 21ef6bf: `ramonda-check` reports a dynamic import the bundler cannot split.

  A bundler splits at a dynamic import and nowhere else, and only when it can read the path at build
  time. `import(specifier)` is therefore not a split point: the module is pulled into the caller's
  chunk, or left out of the build entirely and looked for at run time — which works on a dev server,
  where the source is served as it sits, and 404s in production, where nothing emitted it. Nothing
  says so today.

  It is silenced by either annotation, and both are honoured for different reasons.
  `import(/* @vite-ignore */ name)` is the bundler's own marker: the rule's premise is that nothing
  tells you, and at a site carrying that one the bundler told the author and the author answered.
  `// ramonda-check-ignore why` is this package's own, and it keeps the reason visible in every run.

  Measured across this repository before the rule was written: 88 dynamic imports with a literal path,
  3 without, and all three already marked. It reports nothing here, and reports the fault the moment a
  marker is taken off — both checked.

  `AnalyzeResult.findings` gains `unsplittable-import`, and `UnsplittableImportIssue` is exported alongside it.
  This is the first rule that reads a FILE rather than a class: a question about what a module imports
  has no class to hang off.

- 69e4133: `unknown-aria-attribute` reported correct markup, and now reports a wrong case only inside SVG.

  The rule shipped saying that a wrong CASE was its interesting half — that `aria-labelledBy` "reaches
  the DOM as an attribute called `aria-labelledby`-but-not-quite, assistive technology never looks at
  it, and nothing anywhere says a word".

  **Measured through `renderToString` rather than argued about, and it is false for an HTML element.**
  Attributes there are written with `setAttribute`, which the HTML specification lowercases, so
  `aria-labelledBy` arrives as `aria-labelledby` and works exactly as intended. Reporting it was
  reporting correct code — the one kind of mistake this package treats as fatal to its own
  usefulness, and it was in the rule's own headline.

  It is true inside SVG. Those attributes go through `setAttributeNS(null, name)`, which writes the
  name verbatim — the same render, the opposite result — so a case-only difference there really is an
  attribute nothing reads. That is where the rule keeps it.

  Everything else is unchanged. A plain typo is still reported everywhere, and so is a name wrong in
  more than its case: `aria-labeledBy` is not `aria-labelledby` in any namespace.

  `ElementContext` gains `inSvg` to tell the two apart, decided **by tag name**, because that is how
  the framework decides it — `<circle>` is SVG wherever it is written, and a `<div>` inside a
  `<foreignObject>` is HTML. The tag list comes from `@ramonda/dom-facts` (see the changeset beside
  this one); written as a first guess instead, it was twenty-one tags short — every filter primitive —
  and wrongly claimed `title`, which the framework renders as HTML.

  The fixture holds both spellings of the same name, one in each namespace, so neither half can pass
  by finding the other.

- ca7c7e3: `aria-value` — an `aria-*` attribute carrying a value its specification does not permit.

  The third of the ARIA tables, and the one with the most to catch. Its two siblings judge NAMES: is
  this a real attribute, is this a real role. Neither has anything to say about `aria-hidden="yes"`,
  because the name is perfect.

  **The browser keeps it.** An attribute is a string, so a wrong value survives to the inspector
  looking exactly as healthy as a right one. What does not happen is the meaning: the element stays in
  the accessibility tree, an `aria-live="loud"` region announces nothing, `aria-level="two"` gives a
  heading no level at all. Only a screen reader disagrees, and only for the people who need it.

  `ARIA_VALUES` is the value type of every state and property that HAS one, written from the
  Characteristics table in **WAI-ARIA 1.2** — booleans, the three that also take `undefined`, the two
  tristates, the integers, the numbers, and the seven closed token lists.

  The types deliberately NOT in it are the ones with nothing to judge. An id reference is any
  non-empty name and a label is any string, so every value is well formed and a table entry would only
  create the chance of reporting correct markup. An attribute with no entry is one no rule has an
  opinion about.

  `false` is never reported: `aria-hidden="false"` is the documented way to say an element is exposed,
  which is not what leaving the attribute off says. Nor is an expression — `aria-hidden={hidden}` is
  not a value this can read, and guessing is what the package refuses.

  Zero reports across every app and package here. Proved not silently dead by corrupting a real
  `aria-expanded` in the docs' own menu button and watching the CLI name it.

  The token wording came from reading the printed report, not the code: the bare list said `it takes
\`assertive\`, \`off\`, \`polite\``, and it says `one of` now.

- c26b359: **Breaking:** `AnalyzeResult`'s per-rule lists are now one `findings` object keyed by rule name.

  `result.arrowFields` becomes `result.findings["arrow-fields"]`, and the same for `browserUrlReads`,
  `domWrites`, `duplicateDecorators` and `unwatchedFields`. Nothing else on the
  result moved: `issues`, `counts`, `graph`, `unresolved`, `annotated` and the graph's own checks are
  where they were.

  Nothing is lost but the spelling. Each list is still typed as that rule's own issue — `findings` is
  derived from the rule registry, so the key and the element type are read off the rule rather than
  declared a second time.

  The reason is what a rule used to cost. Each one meant a line in the published interface, a line in
  the CLI's destructure, a report block written by hand, and a clause in the sentence that says
  everything is fine — and that last one is the sharp edge: a rule added without its clause would have
  printed "everything is fine" directly above its own report. That condition is derived now, so it
  cannot be forgotten.

  How a rule says what it found moved onto the rule as well, so `ramonda-check`'s output for a given
  finding is unchanged. Two lines of wording did change, both deliberately: the all-clear sentence no
  longer lists the rules by name (it grew with every one), and the duplicate-decorator advice no
  longer carries a `[ramonda-check]` prefix that no other rule's advice had.

- 31dcb8e: Four accessibility rules, reading your JSX one element at a time.

  `unnamed-image` — an `img`, `area`, image `input` or empty `object` that nothing can announce.
  `empty-heading-or-link` — a heading or a link with nothing inside it. `unnamed-frame` — an `iframe` with no
  name. `positive-tabindex` — a `tabIndex` above zero, which does not move one element but creates a
  second tab order running before the whole document's.

  All four are warnings, and all four are quiet across this repository — measured on `apps/docs`,
  `playground-core`, `devtools` and `core`, and checked by taking the `alt=""` off a real `<img>` and
  watching the report appear at its line.

  They are the first rules that read a JSX ELEMENT, so `ElementRule` joins `Rule` and `ModuleRule`:
  `alt` on an `<img>` is a question about a tag, not about a class or a module, and there are dozens
  more of them coming. One walk serves all of them — the analyzer visits each element once, builds
  the context once, and hands the pair to every active rule.

  **An element that spreads props is handed to no rule at all.** `<img {...rest} />` may carry the
  attribute in question and nothing static can say whether it does, so the silence contract is applied
  once for the whole family rather than remembered by each rule. `alt=""` is likewise never reported:
  it is the documented way to mark an image decorative.

  `AnalyzeResult.findings` gains `unnamed-image`, `empty-heading-or-link`, `unnamed-frame` and `positive-tabindex`,
  with `UnnamedImageIssue`, `EmptyHeadingOrLinkIssue`, `UnnamedFrameIssue` and `PositiveTabIndexIssue` exported
  alongside.

- 4274296: Two rules over markup the HTML parser will not keep where it was written.

  `tag-needs-its-parent` — a `<tr>` outside a table, an `<option>` outside a select, a `<summary>`
  outside a details. The parser moves these, or drops them, or closes the element it was in the
  middle of, so the tree the browser builds is not the tree in the source.

  `interactive-inside-interactive` — a link inside a link, a button inside a button, a form inside a
  form, a label inside a label. Meeting the second the parser closes the first, so the inner one
  becomes a SIBLING of the outer and the failure is behavioural rather than visual.

  JSX has no content model — it nests whatever you nest — so neither is something the compiler can
  see. The framework watches a narrower version at runtime (`RMD010`, for a component's default host
  in a parent that will not take it) and only once the markup renders; on a server-rendered page a
  bad nesting also surfaces as a hydration MISMATCH, whose advice is about clocks and random numbers.

  Both walk through a callback: `<tbody>{rows.map((row) => <tr />)}</tbody>` is how every table is
  written, and a version that stopped at the arrow would be silent about tables. Both go quiet when a
  component is in the way, because what it renders is decided inside it.

  Warnings, and quiet across this repository.

- 0e2ff52: Three rules over the ARIA vocabulary.

  `unknown-aria-attribute` — an `aria-*` attribute the specification does not have, and it names the one that was
  meant when that is certain. The fault worth catching is not the invented name but the CASE:
  `aria-labelledBy` looks right, is a different attribute from `aria-labelledby`, and does nothing at
  all. `unknown-role` — a `role` that is not one, told apart from an ABSTRACT role, which is somebody
  reading the spec's inheritance diagram and taking a branch for a leaf. `aria-with-no-subject` — `role`
  or `aria-*` on an element with no accessibility tree node to describe, where the attribute does not
  do a little, it does nothing.

  The vocabulary ships as data in `src/rules/aria.ts`, from WAI-ARIA 1.2 with the 1.3 role additions,
  and _ARIA in HTML_ for the element table. The tables lean LONG on purpose: short by a name they
  would report correct markup, which is the one kind of mistake this package treats as fatal to its
  own usefulness.

  All three are warnings and all three are quiet across this repository. Checked by changing one real
  `aria-label` to `aria-Label` in the docs app and watching the report name it, with the fix.

- dddac5f: The request is live only while you render, and now two things say so.

  **The question first, because the answer is the reassuring half.** Can `requestContext()` hand one
  visitor another visitor's data? No — and it is not the variable that saves it. The scope IS one
  module-level value shared by every request the server is handling at once. What makes it safe is the
  WINDOW: `renderToString` installs it, mounts synchronously, and clears it in a `finally` before its
  first `await`. Node runs that section to completion, so no second request can be inside it.

  Measured rather than argued, and now pinned by
  `packages/core/src/__tests__/hydration/RequestConcurrency.test.tsx`: ten interleaved renders each
  read their own user, two concurrent ones never see each other's. Delete the one line that clears the
  scope and both requests read `["read:bob","read:bob"]` — Ada's component serving Bob's user. Three of
  the tests fail on it. There was no test for any of this before.

  **The defect that came out of it: breaking the rule was silent.** A read below the first `await`
  throws, but the throw does not always arrive anywhere. Measured with no `try`/`catch`, which is what
  an app actually writes: `renderToString` **resolves normally**, the page is served, `console.error`
  is called **zero** times, and the component is quietly missing its value. The rejection goes into the
  server's work drain and is swallowed — exactly what `RequestScope.read`'s docstring already says
  happens in build mode, which is why `guardBuild` records IN ADDITION to throwing. Server mode had no
  counterpart.

  **`RMD053`** is that counterpart. `requireScope()` now reports before it throws, so the record
  survives the swallowed rejection, and the throw's message says the third way to arrive: a read below
  a yield, not only a call at module top level. Deduped on the FIELD rather than the component, and not
  by preference — by the time it fires the render is over and `renderingOwner()` is already empty.
  Production is unchanged: every `diagnose` call site in the package is behind `__DEV__`.

  **`ramonda-check` reports the same read from the source**, as `findings["late-request-read"]`, a
  WARNING under this repository's rule for a new rule. Zero reports across all three apps; verified not to be
  silently dead by planting a real late read into a real component in `playground-ssr` and watching the
  CLI name it through the repo's own source alias.

  The two are not redundant and not symmetric, which is the same shape the duplicate-decorator work
  settled. The static rule speaks before anything runs, including for a branch nobody has opened.
  `RMD053` catches the read that left the static rule's reach — through a variable, a helper, or a
  build with no types.

  What the rule judges, each half planted and caught:

  - **A late read through a same-scope local** (`const ctx = requestContext()` above the await, used
    below) is reported. One hop in one function is a declaration, not the general dataflow this
    analyzer refuses.
  - **`for await`** raises the flag too. It is a `ForOfStatement` carrying an await token, so the
    check for an `AwaitExpression` never sees it.
  - **A read inside the await's own operand** — `await requestContext().get(key)` — is NOT late. The
    operand is evaluated before the suspension, so the walk descends into an await before raising its
    flag.
  - **A nested callback starts a clean timeline.** Whether it runs before or after the enclosing yield
    is dataflow, and guessing would report `items.map(…)` called synchronously above the await.
  - **One mistake gets one report.** A context TAKEN below the await is the failure — that line
    throws, so the line reading through the local never runs. Only a local taken before the yield is
    followed, or the reader would be sent to the second of two reports, on dead code.
  - **Identity is the import specifier, not the name.** An app is entitled to its own function called
    `requestContext`. This is stricter than the sibling `document` rule on purpose: nobody writes
    `const document = …` and reaches for `.body`, but a same-named local here is plausible.

  Two fixture gaps were found the same way and are worth recording, because both tests passed while
  proving nothing: the "app's own helper" case had been written as `requestContext2`, so the NAME check
  rejected it and the identity check was never reached; and nothing covered a read inside an await's
  operand, so reversing the walk order went unnoticed.

- 798afae: The reference's rule tables are generated from the rules, and `ruleCatalogue()` is what generates
  them.

  **The fault it fixes was already there and already silent.** The check reference carried two tables
  of rules — errors and warnings — typed by hand, and the day nine rules landed beside them the tables
  were nine rows short. Nothing noticed, because nothing connected the two. A reference that is
  quietly incomplete is worse than one that says so: a rule missing from the page is a rule nobody
  knows they are being judged by.

  `Report` now carries the two facts a table needs and a rule did not say out loud:

  - **`reportedWhen`** — the condition, as a clause completing "reported when". Beside the rule it
    describes, which is the only place where changing one makes the other obviously stale.
  - **`alsoReportedAs`** — the runtime diagnostic that reports the same fault once the line runs, for
    the six rules that have one. A code rather than a link, so nothing in the package has to know what
    the documentation site is built with.

  **`ruleCatalogue()`** is the new export: every rule as four strings, in the order their reports are
  printed. Deliberately not the rules themselves — a rule carries functions over its own issue type,
  which is no use to a generator and would tie anything touching it to this package's internals.

  `apps/docs` builds both tables from it and the docs build fails when the committed page does not
  match, the same shape `build-theme.mjs --check` already had. Four failure modes, each planted and
  watched: a stale table, a missing region, a rule naming a diagnostic the reference does not
  document, and — the one a generator usually gets wrong — the region markers themselves. They are
  link reference definitions rather than HTML comments, because the site renders markdown with
  `html: false`, so a comment arrives at the reader as `<!-- … -->`. Measured, not assumed.

- 251f0a4: `head-tags-collide` — two entries in one `Head` that are the same tag, so only the second is
  written.

  **The rule this replaced died first, and that is the point.** The backlog carried `RMD043` — a
  `<meta>` with nothing to identify it — as the last runtime diagnostic that looked statically
  provable. It is not: `MetaTag` is a union requiring `name`, `property` or `httpEquiv`, so `tsc`
  answers `TS2769` on the tag that would trip it. Probed before anything was written, which is now the
  third time a candidate has died that way.

  The probe found a real one next door. `Head` keys the tags it writes by what identifies them — a
  `<meta>` by `name`, `property` or `http-equiv`, a `<link>` by `rel` and `href` — so that an update
  REPLACES a tag rather than appending a second copy. Two entries with one identity are therefore one
  tag, and the later silently wins.

  Measured end to end rather than reasoned about: ten tags written, four served. `description: "The
real one."` came back as the second description, both `robots` collapsed to `noindex`, and the
  16×16 icon left no trace. No type error, no diagnostic, no way to see it in the page that is served.

  `description` is a shorthand for the meta tag of that name and is collected **first**, so writing
  both loses the shorthand — the line that reads like the page's own description. The report points at
  the entry that is lost and names the line that replaces it. That was the second design: the first
  named both entries, and printing it showed `a meta name="robots" and a meta name="robots" are both
name="robots"` — the same fact three times, and never the two lines.

  What it stays quiet about: a computed identity, a spread inside a tag, a list held in a variable,
  an app's own `Head` of the same name, and — the one that keeps it honest — two byte-identical
  entries, which collapse to the tag they both describe and lose nothing.

  Zero reports across every app and package here. Proved not to be silently dead by planting a real
  collision into `DocPage`, the docs' own page component, and watching the CLI name it through the
  factory spelling.

- e03a67c: Two rules that follow what a render REACHES, not what it is written to contain.

  `state-written-while-rendering` — a write to `@state` or `@persist` from anything `render()` or a
  `@compute` can reach. `clock-read-while-rendering` — `Date.now()`, `new Date()`, `Math.random()` or
  `performance.now()` reached the same way.

  The walk is the rule. A fault is almost never in the body of `render()`: it is in a helper on the
  class, in a utility imported from another file, or in the third branch of a chain of conditionals.
  The report names the path — `render → decorate → stampedLabel` — which is the useful half, because a
  clock three files away is baffling on its own and obvious once the path is written down.

  A nested function is walked only when it is INVOKED during the render — an argument to `list(each,
…)` or `.map(…)`, or a function called on the spot. Anything returned, assigned or handed to an
  attribute runs later, and its body is exactly where writing state is correct. That distinction is
  not decoration: the first version walked into everything that was not written directly as a JSX
  attribute, and it reported five places in this repository, every one of them `@memoizedHandler` —
  a first-class idiom of the framework.

  `new Date(value)` is not reported; parsing a timestamp is deterministic. A write to a field that is
  not state is not reported. A `@mounted` is not reported, because a render does not reach it.

  Both are warnings, and both are quiet across this repository.

### Patch Changes

- 99a5627: `@ramonda/dom-facts` — one list of SVG tags instead of two.

  `@ramonda/core` decides how to build an element; `@ramonda/check` reads source and says what that
  decision will be. Both need the same list of tags, and both had one. Written into the checker as a
  first guess, its copy was **twenty-one tags short** — every filter primitive — and wrongly claimed
  `title`, which the framework renders as HTML. A test that read core's source caught it, but a test
  pinning two lists together is a confession that there are two lists.

  So there is one, in a **private** package that publishes nothing and is a devDependency of both.
  Both consumers bundle their own code and tsup inlines anything that is not a declared `dependency`,
  so nothing about either published package changes:

  - `@ramonda/core` ships the identical literal — 636 bytes, byte-for-byte — in the same chunk. Total
    production output moved by **six bytes** raw and **one byte less** gzipped, all of it the
    minifier renaming a variable because module order shifted. No import and no type in `dist`
    mentions the private package; only the dev bundle's path comment does, which is how esbuild marks
    an inlined module.
  - `@ramonda/check` still publishes with **no runtime dependency at all**, which is the property that
    lets it run first in a build. The list is inlined into its shared chunk.

  `svgElements` is still exported from core's `constants.ts`, as a re-export, so nothing inside core
  changed an import and `SvgNamespace.test.tsx` still pins the list to the SVG types in `global.ts`.

  The package has a rule about what may go in it, written at the top: a fact about the DOM or HTML
  that **both** packages need, and nothing else. A shared package with no such rule becomes the place
  things go to avoid a decision.

- cafc061: Internal: the five per-class checks now live behind a rule interface, one file each, and the two
  guards that decide whether a rule is honest are declared rather than written by hand.

  `needs` names a package the project must import before a rule means anything — what `usesRouter` was
  for `browser-url`, now a set read once for every rule that will want one. `exempt` names an id prefix
  a rule never fires inside, because a rule about reaching past an abstraction is always wrong about
  the code that implements it.

  No behaviour change: `analyzeProject` and `AnalyzeResult` are unchanged, every issue type is
  re-exported from where it was, and the graph a real project produces is byte-identical, hash
  included.

  The refactor also found that `exempt` had been unreachable since it was written — `needs` fires
  first, and `@ramonda/router` does not import itself — so it now has a fixture that reaches it and a
  test that fails without it.

- b6bb397: `@ramonda/check` guards its own public surface, and three types that were never exported now are.

  This package had no `PublicSurface.test.ts` and no line in the docs' `check-api-coverage.mjs`, so
  neither of the two tripwires every other package has was watching it. In that time it went from five
  rules to twenty-seven, each one adding a published issue type — and **`AriaValueIssue`,
  `RoleMissingRequiredAriaIssue` and `RoleTakesNoNameIssue` were never exported at all**. They were
  reachable through `findings` and unnameable in an annotation, which makes the documented way to use
  this package — write a script against `analyzeProject` — impossible for three of its rules.

  Nothing noticed, because nothing was looking. That is the entire argument for both files.

  The surface test asserts what the entry exports and what it publishes as types, and adds a third
  check the others do not have: **every rule in the registry has an exported issue type**, derived
  from the rule's own id rather than from a second list. A rule added tomorrow brings its type with
  it, and the four spellings where the type is not the id in PascalCase are listed beside their
  reason.

  It also asserts what is NOT reachable. `RULES`, the per-family registries and the `apply*` functions
  stay internal: a rule carries functions over its own issue type and a `read` that takes a compiler
  node, so publishing one would make this package's internals somebody's dependency and every change
  to a rule's shape a breaking change. `ruleCatalogue()` is what a caller actually wants from them.

  `/reference/api` gains a `@ramonda/check` section, and the docs build now fails when an export is
  missing from it. Proved by deleting the section and watching the build name what went.

## 0.8.0

### Minor Changes

- 5c76334: A component writing the document instead of rendering it.

  `document.documentElement.classList.toggle("drawer-open", this.open)` is rendering, done
  imperatively. The class it writes is a second copy of a field the component already holds: kept in
  step by hand, cleaned up on unmount by hand, and remembered by whoever adds the next handler that
  touches the same state. Said in `render()` it cannot drift, because there is only one of it — and
  `html:has(.drawer-open)` reaches the document from a class a descendant renders, so even the page
  itself can be styled from state a component owns.

  Reported: an assignment — with ANY assignment operator, because `className += " open"` is how this
  is usually spelled — to `className`, `textContent`, `innerHTML`, `innerText`, `id` or anything under
  `style`, whether reached by name or by a computed key; and a call to `setAttribute`,
  `removeAttribute`, `toggleAttribute`, `insertAdjacentHTML`, a `classList` method or
  `style.setProperty`, which is how a component usually pushes theme state onto the document. On
  `document`, `document.body`, `document.documentElement`, or whatever a global query hands back.

  **A COMMAND is not this, and the difference is the whole rule.** `scrollIntoView()`, `focus()`,
  `select()` and `getBoundingClientRect()` have no declarative form — they tell the browser to do
  something rather than describing what it looks like — and a rule that caught them would be one
  people switch off. An element you created yourself is not reported either: it is reached through a
  local, and reading what a local holds is dataflow, which this resolver refuses by decision, so that
  falls out of the design rather than needing a case of its own.

  **A warning, not a failure**, per the rule here for adding a rule. Measured across every project in
  this repository: zero reports. What looked like violations were a custom element (`@ramonda/devtools`
  is an `HTMLElement`, not a component), a READ of `textContent`, and a `<style>` built at module
  scope — none of them a component writing what it could have rendered.

- 3dc33e2: A component reading `window.location` where the router already knows.

  The two are the same fact from two sources, and only one is reactive: read from the router, a
  component re-renders when the route moves; read from `window`, it is a snapshot taken once and
  never corrected, so the page quietly goes out of date. The router also keeps a distinction the URL
  hands over as one string — `#tab=film` is route state and `#a-section` names an element — so a hash
  tag with a `value` is the first and one without is the second.

  ```
  [ramonda-check] 1 component(s) reading the browser's URL, not the router's:

    src/Article.tsx:31:20
      <Article> reads `window.location.hash` — the router answers this with `hashTags`.
  ```

  `window.location`, `globalThis.location`, `document.location` and a bare `location`. The report
  names the router's member where one answers the same question and says nothing where none does —
  `location.origin` gets no invented replacement.

  **A read, and only a read.** `window.location.href = "…"` is a different fault with a different
  answer, and `location.reload()` is the one thing the router genuinely cannot replace; reported as
  reads, both would be advice to do something impossible.

  **Two things it deliberately does not report.** A project that imports no router: there `location`
  is the only place the answer lives, and a rule that reports the only thing you could have written
  is a rule people switch off. And a local variable called `location`, which is not the global —
  telling them apart costs no type, because this runs with `noLib` and no `@types`, so the browser's
  own name resolves to nothing while one written in the source resolves where it is written.

  **A warning, not a failure**, which is the rule here for adding a rule: one version that says so,
  the next that refuses. Measured across this repository: zero reports. The router reads
  `window.location` in `urlUtils.ts` because it owns it, and core reads it behind a `typeof` guard for
  SSR; neither is a component with a router above it.

### Patch Changes

- c542e07: The published graph is `dist/ramonda-graph.json`.

  It used to be `dist/graph.json`. Nothing resolves it by name — an app reads the `ramonda.graph`
  field of the package's `package.json` — so **a package already built to any other path keeps
  working**, and there is nothing to migrate.

  The name changed for where the file ends up. It is PUBLISHED: it sits in a stranger's
  `node_modules/@ramonda/core/dist/` beside whatever their bundler wrote, and `graph.json` there says
  neither whose it is nor what it is for. Same argument as the binaries being `ramonda-check` and
  `ramonda-check-bundle` rather than `check` and `check-bundle`. An app writing its own graph needs no
  prefix and does not get one: it picks the path, and nobody else ever reads the file.

  Collision was never a correctness risk and this does not fix one — a foreign `graph.json` in `dist`
  would have been refused out loud rather than believed, because the loader checks `schema`, `scope`,
  the package name and the declaration-file hash before anything is spliced. What it removes is the
  chance of two tools quietly overwriting each other in the one directory every tool treats as its
  own.

  Verified end to end rather than assumed: the four packages emit to the new path, `npm pack` carries
  `dist/ramonda-graph.json`, and `apps/playground-core` — the one project here that resolves a Ramonda
  package through `node_modules` rather than a tsconfig path — still splices `Form`, `Field`,
  `FormProvider` and `FormState` out of `@ramonda/form`'s fragment.

## 0.7.0

### Minor Changes

- 48ec521: A value the caller hands in is a slot, whether it arrived as a prop or as a parameter.

  `<this.props.view />` has never been a defect: nothing in that class can say what it mounts, and
  nothing was meant to. `__h(type, …)` inside a JSX runtime is the same promise written differently,
  and reporting one and not the other made the framework apologise for being a framework — thirteen
  escape hatches across this repository against a plan whose own test is that more than a handful
  means the rule is formulated wrongly.

  A mount whose named value traces to a parameter is now an edge that says what it waits on:

  ```json
  {
    "from": "@ramonda/core/src/jsx-runtime.ts#jsx",
    "kind": "unresolved",
    "via": "parameter",
    "slot": "type",
    "at": "@ramonda/core/src/jsx-runtime.ts:55:7"
  }
  ```

  `parameter` is a new `via` value, which is what the format's split between `kind` and `via` exists
  for: a reader that switches on `kind` is unaffected. It is a second value rather than a flag on
  `slot` because a prop edge is FILLED from what a JSX call site binds and a parameter must never be
  — a package whose `Frame.show(view)` mounts its own argument, spliced into an app writing
  `<Frame view={Foo} />`, would otherwise have `Foo` judged under `Frame`.

  A path works at any depth (`options.wrapper`), a cast is seen through, and `this.use(hook)` makes
  the same promise about a hook. **Thirteen annotations become five**, measured by deleting all
  thirteen and running every project: core keeps none, testing-library two, the documentation site
  one, the playground its two deliberate failed-load demos.

  **What stays a hole**, because reading either means running something: what a CALL returns
  (`bootstrap(wrap(ui), container)`) and whatever a LOCAL BINDING was last assigned
  (`const tag = …; __h(tag, …)`).

  **The cost, plainly.** A mount whose value came from a parameter is no longer an error anywhere, an
  app's own helper included. It is a marked blank rather than a reported one. What it does not buy is
  coverage: nothing fills these — the compiler calls `jsx`, and a wrapper handed through a call
  argument is not a JSX binding.

  **A latent false positive fell out of it, and it is the more useful half.** Judging and walking
  shared one early return, so everything below an OPAQUE component was unreached — and the
  dead-declaration rule read that as "nothing mounts this" with the tag one line above it in the same
  file. The two questions are now separate: what a component provides is unknowable below an opaque
  one, and what it mounts is written in its body and perfectly visible.

  `@ramonda/core` and `@ramonda/testing-library` lose the annotations they no longer need; nothing
  else changes in either.

  **Four faults a review found on this branch, all of them in the new code:**

  - `this.use(hook)` written WITHOUT a cast resolved to the parameter's own symbol and so missed the
    branch that marks a component opaque — silenced but transparent, which is the worst of both: a
    consumer below it reported against a component that may well have been providing for it, and no
    hole left to point at the cause. Only the cast spelling was covered, so the tests passed. Opacity
    is keyed on the value tracing to a parameter now, and **not** on merely reaching that branch:
    widening it is the opposite fault, and `this.use(Form<typeof schema>)` arrives there too.
  - A `ramonda-check-ignore` already written on a site that becomes a slot went silently dead — out
    of the list printed on every run, which exists so the number cannot creep up unread, and an EMPTY
    directive was accepted there while being refused everywhere else. It is read before the edge is
    emitted now.
  - A root's reason was computed from a JSX element that is absent when the argument is not JSX, so
    the edge said it waits on `vnode` while its own `why` said there was nothing to wait on.
  - The format's own documentation for `slot` still described a prop. It says what it now carries,
    and that neither kind belongs in a node's `slots`: the `from` of a parameter edge can be a root
    or a free function, which have no props at all.

  **And two more from a second review, over the fixes themselves.** A spliced fragment filled a
  parameter from a colliding prop name — the fault above, found before it could bite and pinned by a
  vendor package that mounts a method argument. And the exemption for a PROP never read its own
  directive either, so the two symptoms fixed above still held there: both call one reader now.

- 2039753: An app entered only from a server is judged. It used to pass in silence.

  `renderToString`, `renderPage` and `renderStatic` are roots now, alongside `bootstrap` and
  `hydrateRoot`. All five are handed a component and render it; only the browser's two were read.
  Measured on one file with a consumer and no provider above it, changing nothing but the last line:

  ```
  bootstrap(<App />, null)     <Reader> consumes "Theme" — nothing provides it on this path
  renderToString(<App />)      0 root(s) — every consumer has a provider above it
  ```

  The second sentence was never checked. With no root the walk has nowhere to start, the project is
  taken for a library, and a library is judged not at all — so an SSR-only app got a green line over
  code nothing had looked at, which is the failure this package exists to prevent.

  **An entry is called by its own name.** A component method that shares one is not an entry: two
  apps in this repository have a `renderPage(row)` that builds the markup for one row of data, and
  reading the callee by name would make a root out of a row.

  Also fixed while measuring it: `--split` counted a root as a declaration in the first payload. A
  root is a CALL, not a declaration — it is walked through and never counted.

  `@ramonda/core` gains two escape-hatch comments in `hydration/ssr.ts`, where `renderPage` and
  `renderStatic` forward the tree they were handed to `renderToString`. Nothing else changes there.

- 4f097b8: `ramonda-check-bundle` stops calling a correct build broken, and both packages declare Node 24.

  A `.js` file is a script or a module depending on the nearest `package.json`, and a bundler emits ES
  modules into `dist` whatever that file declares — so `"type": "commonjs"` beside ESM output is an
  ordinary arrangement. Read as a script, such a bundle "does not parse", and this tool reported it as
  the one fault it exists to find:

  ```
  [check-bundle] 1 of 1 emitted file(s) do not parse:
      SyntaxError: Cannot use import statement outside a module
  If these contain decorators, the build is not running a transform that strips them.
  ```

  Nothing was wrong with the build. The guard failed it anyway, and named the wrong cause while doing
  so. Every project in this repository sets `"type": "module"`, which is the only reason this was
  never seen here.

  A file that fails to parse as a script, **and fails with one of the four messages that mean
  module-only syntax**, is now parsed again as a module. The second parse never runs otherwise, so a
  decorator still fails both ways and no failure is downgraded — there is a test for exactly that,
  because a retry that accepted anything would buy the false pass back at full price.

  **Breaking:** both packages now declare `"engines": { "node": ">=24" }`, matching the repository
  root and `create-ramonda`. `pnpm` refuses an install that violates `engines` rather than warning, so
  this is a floor and not advice.

  The floor is a choice about the future, not a measurement: `node --check` reads ESM in an untyped
  `.js` on 20.19 and on 22.7+, but **not on 22.0 through 22.6**, where module detection had not landed
  yet — a range that is not monotone, so `>=20.19` would have been a wrong description of it. Rather
  than encode that shape, the supported version is the one that will be current by the time anyone
  adopts this. The parse fix stands on its own regardless: `npm` only warns on `engines`, so the floor
  alone would have left the false accusation reachable.

- 9104bf0: `ramonda-check` follows a component kit destructured out of a factory.

  ```ts
  export const { Router, RouteOutlet, Navigator, Link, route } =
    createRouter(routes);
  ```

  This is the shape `npm create ramonda` scaffolds and the routing docs teach, and every tag written
  from it was reported as a component that cannot be followed. That is an ERROR, so **a scaffolded
  routed project could not run `npm run build` at all** — and because nothing below an unresolved tag
  is judged, most of the app went unexamined with it.

  Nothing is guessed. `componentAt` already answers a direct import from an installed package by
  taking the symbol's name to that package's fragment; the same two facts are present one step apart
  here — the callee is declared in the package, and the destructured key is the name. Only exported
  members match, so a key sharing a name with a package's internals resolves to nothing.

  It reads the fragment rather than the factory's return type, because the type is where the answer
  stops being there: `@ramonda/router` publishes `Router: typeof Router` but `Link:
ComponentClassKind<TypedLinkProps<…>>`, the latter having passed through `as unknown as`. Half the
  kit names its class and half does not, so a type-directed version would have resolved two of four
  and left the two used most.

- 7191ab6: `Link` and `Navigator` are reached through `createRouter`, and nowhere else.

  Both existed in two versions — the kit casts them so `href`, `push` and `replace` take only paths
  your table names — and the untyped one was an equally short import that silently gave up the
  checking the typed one exists to provide. Not one app in this repository was using `createRouter`
  when this was measured, which says the wrong door was not so much chosen as walked through.

  ```ts
  const { Router, RouteOutlet, Link, Navigator, route } = createRouter(routes);
  ```

  **Breaking.** `Link`, `LinkProps` and `Navigator` are no longer exported from the package. `Router`
  and `RouteOutlet` still are: the kit hands those back unchanged, so there is only one of each and
  nothing to pick wrongly.

  A second NAME for each was tried first and abandoned — it worked for `Link` only because HTML had a
  word for the raw thing, and there is none for a navigator. Five members would have meant five
  separate arguments about vocabulary; one door needs none.

  **`href` now takes a query, a fragment, and a filled-in `:param` path.** `route()` is no longer
  required for the ordinary case:

  ```tsx
  <Link href="/users/42" />
  <Link href={`/users/${id}`} />        // an id from a backend
  <Link href="/about?tab=2#top" />
  ```

  The looseness is only behind the `?`: a query needs at least one `key=value`, the path is still
  checked to the letter, and runtime concatenation (`"/a?" + q`) widens to `string` and is refused.
  Measured before it went in — 50 routes and 2100 href sites cost 0.39s of check time against 0.34s
  for a plain `string`, because TypeScript keeps these as patterns rather than expanding them.

  Two known costs, both written down where they bite: a substituted segment is `${string}`, which a
  slash also satisfies, so `/users/a/b` is accepted; and a raw `/users/:id` compiles, since `":id"` is
  a string like any other.

  `@ramonda/check` follows a kit destructured from a factory whose declaration is in the same program,
  not only one that arrives through an installed package's fragment. A monorepo compiles its own
  packages from source, which is why the fragment-only version passed every fixture and still failed
  this repository's own documentation site.

- eb0b34b: `--split` says what loads when, and `--diff` says what a change moved.

  Both are readings of the graph that is already emitted — no second walk over the source, and no new
  fact in the format. That was the argument for making the graph a product, and this is the second
  time it has held.

  **A bundler splits at a dynamic import and nowhere else**, so `--split` splits at a `lazy` edge and
  nowhere else. What a chunk reaches comes out in three parts, each a different claim: already in the
  first payload and free, shared with another split point and downloaded once for both, or its own.
  Collapsing any two of them reports a page as expensive when it is free.

  ```
  [ramonda-check] what loads when — @ramonda/docs

    before anything      16 declaration(s) in 8 file(s)
    loaded on demand     76 split point(s)
    shared between them  55 declaration(s)
  ```

  `--diff <graph.json>` compares the run against a graph written earlier. The number it exists for:

  ```
    nodes  +0  -0        edges  +1  -0
    before anything: 16 → 72 declaration(s) (+56)
  ```

  That is one added import line, measured on this repository's documentation site. A diff of the
  source shows the line; nothing in it shows the fifty-six components that now arrive with the first
  page. Identity leaves the LINE out on both sides, so inserting a line near the top of a file moves
  nothing below it, and a graph of a different package, scope or schema is refused rather than
  subtracted.

  **Routes are deliberately not the unit, and that is a measurement rather than a preference.** The
  plan called this "what one route pulls in". Measured: one app here imports all eleven of its pages
  statically, so every one is in the first payload and opening a route downloads nothing; another
  builds its route table in a loop, so no route in it has a URL this could name. The unit is where the
  code actually splits.

  It counts declarations and names files. It never says bytes — nothing here has weighed a bundle.
  Both flags describe; neither fails a build.

### Patch Changes

- c0df2d1: A kit member whose name answers to two classes resolves to nothing, and a built href takes a
  fragment.

  **`@ramonda/check`** — when a package hands a component back through a factory without exporting it,
  the fragment is read by name. Two exported classes sharing a name were already refused, "rather than
  resolved to whichever came last"; two INTERNAL ones kept the first and said nothing. Internal names
  collide far more often than exported ones — this repository's own documentation app declares
  `class Page` seventy-five times — and a kit member bound to an arbitrary class puts every edge below
  it under the wrong component. That is a wrong answer where an unresolved tag would have been an
  honest missing one. Both are now refused and the tag reports as the hole it is.

  No note is emitted for an internal collision, unlike the exported case: almost none of them is ever
  reached by a destructured key, and a note per collision would bury the runs where it matters.

  **`@ramonda/router`** — `AnyHref` is `Located` over both halves of the union, including the `Href`
  that `route()` builds. Written out by hand, the second half took a query but not a fragment, so
  `` href={`${route("/u/:id", { id })}#top`} `` was refused while `href="/about#top"` was accepted.
  An anchor into a section of a parameterised page is the ordinary reason to write one; the asymmetry
  was an omission, not a decision.

  Two JSDoc claims that this branch had already made false are corrected — `href` no longer requires
  `route()` for a `:param` path, and a raw `:param` pattern is accepted rather than rejected (a known
  cost, documented three lines above where the comment denied it).

  Docs: component examples import `Link` / `Navigator` from `./routes` instead of calling
  `createRouter(routes)` in each file. Every app in this repository mints the kit once and imports it,
  the setup page says to do exactly that, and eight examples across five pages taught the opposite —
  six of them destructuring three names to use one. The sample checker now resolves `./routes` to the
  real package's types, so `this.use(Navigator)` has to genuinely carry `push` and `params`; the
  hand-written `any` shims those examples leaned on are gone.

## 0.6.0

### Minor Changes

- c40698e: A component named among JSX children is reported.

  `{Named}` where `<Named />` was meant. Measured in core before the rule was written: it renders
  **nothing**, and no diagnostic is emitted — a class is a function, so `RMD037`, the check for an
  object among children that is not markup, never sees it. The page simply comes up without the
  component, and nothing anywhere says a word.

  Nothing legitimate has this shape. Handing a component over is an attribute, and `<Slot view={Named}
/>` is a binding rather than a child — the fixture pins that difference.

  `{cond && Named}` and `{cond ? Named : null}` are the same mistake behind a branch, and are reported
  too.

- d3d182b: A ring of mounts that nothing on it can skip is reported.

  A cycle by itself is not a fault, and this is the measurement that decided the rule: the one cycle in
  this repository is a markdown renderer and a code block calling each other, and it is correct. A tree
  renders itself for each child and stops when the data runs out — that is how a recursive structure is
  drawn, and reporting it would report the ordinary case.

  What cannot be right is a ring where every step runs on **every** render: no branch, no callback, no
  loop anywhere on it. Nothing can stop, so the first render recurses until the stack gives out, before
  a page appears, in every build.

  That is decidable, so the rule is. Every edge now carries `always` when its site was proven to run on
  every render of the body it is written in, and the flag is absent when nothing proved it — a site
  this could not read can never invent a fault. `always` is a fact other rules can use: it is the
  difference between _may reach_ and _will reach_, which the provider walk does not need and this one
  does.

  Silent across the four apps and five packages here.

- 58693b4: `ramonda-check-bundle` now ships, and a scaffolded project runs it.

  Ramonda's decorators are TC39 syntax that no engine can parse, so the bundler has to transform them
  away. Which it does is decided by one line — `target` — and `esnext`, the value that reads like a
  modernisation, is the one that leaves them in. The build still succeeds, prints no warning, and
  emits a file that dies with `SyntaxError: Invalid or unexpected token` on the first page load.

  This repository has been guarded against that for a while; a project scaffolded with
  `npm create ramonda` was not. Both now end their `build` with `ramonda-check-bundle`, which parses
  every emitted file and fails the build instead of the browser.

  - `@ramonda/check` gains a second binary, `ramonda-check-bundle <dir-or-file>...`. Nothing about
    `ramonda-check` changes.
  - Both templates end `build` with it, and both `vite.config.ts` files now say what `target: "es2022"`
    is for — the setting was already correct and completely unlabelled, which is how it got removed
    the first time.

- 1384a5f: Two more ways a component is mounted, and the documentation site is finally visible.

  **A function that mounts through the factory and writes no tag at all** is a helper like any other.
  It was recognised by looking for JSX tags, so a function that walks a content tree and calls `__h`
  for every node was not one — its body was never walked, and everything it mounts was unreachable
  while it sat in plain sight.

  **A helper handed OVER rather than called** — `tree.map(toVNode)` — is reached too. Whoever it is
  given to will run it, so what it mounts is reachable from there.

  Measured on this repository's documentation site, which renders its entire content tree that way:
  the walk reached **10 of 153 nodes** when this work started, 90 after the factory and the looped
  route table, and **142 of 157** now. The only thing of its own it does not reach is the SSR entry,
  which nothing calls because the server calls it.

  Four more sites carry an escape hatch, and they are all one shape — a function that mounts whatever
  it is handed. Three are `@ramonda/core`'s JSX runtime, which is that shape by definition, and one is
  `@ramonda/testing-library`'s wrapper. Two more name an element from a parsed content tree.

- 433027f: A declaration no root reaches is reported.

  The first check computed from the graph rather than from the source, and it needed no new pass over
  your code — which is the argument for having a graph at all. The walk already visits everything a
  root mounts, so what it never arrived at is what nothing mounts.

  **Only what it can prove.** An exported one is never reported: an app is entered through what it
  publishes, and an SSR entry is called by the server rather than by your program, so `renderOne` and
  `prerender` would be false positives. What is reported is a declaration nothing outside its own file
  can even name, that no root reaches.

  Two things it took to make it silent on correct code, both measured against this repository:

  **A hook a reached component uses is not dead**, though a hook mounts nothing. The walk follows what
  MOUNTS, and `this.use(Counter)` is never a mount — right for the provider check, wrong for this one.
  Without closing over those, the playgrounds reported three hooks as dead with a component using each
  of them one line away.

  **Another package's internals are its own business.** These apps compile their dependencies from
  source, so an app not using one of core's hooks says nothing about core; before the filter, the
  playground reported core's `Provider` as dead.

  A library is not judged at all: with no root, everything in it is unreachable by definition. Across
  the four apps here the rule is silent.

- ad994c9: A context can say that two of it conflict, and a second one is reported before the app runs.

  Nesting is ordinary: a second Provider shadows the first and the nearer one wins. That is how a
  theme override inside a panel works, and a form inside a form — so a checker cannot simply report
  every context provided twice.

  `createContext(…, { single: true })` is how an author says this one is different. The router's is the
  case, and it now declares it: two Routers both listen to `popstate` and both write history, and the
  first to unmount takes the listener the survivor depends on. `Router.init` already throws when it
  happens — this is the same fault said before anything renders, on every path the source can produce,
  including the branch nobody clicked.

  Like `label` and `optional`, the flag is a declaration rather than behaviour: the runtime reads
  neither, and it changes what is reported rather than what is read. It travels in a package's graph
  fragment, so a context declared single stays single in every app that mounts it.

- 411661b: A route table whose views can never appear is reported.

  Two ways to get there, and a reader fixes them differently: nothing hands the table to a
  `<RouteOutlet>` this build can see, or an outlet does and no root reaches that outlet. Either way
  every page in the table renders nothing — and each page on its own looks perfectly well formed,
  which is why nothing else says a word. A whole section of a site can be gone without one error
  anywhere.

  The second rule read from the graph rather than from the source, and it needed nothing new: the walk
  already knows which outlets it arrived at.

  The pages themselves are not reported as dead code — a page is exported, and an exported declaration
  is a way in. The fault belongs to the table and is reported once, where the table is written.

  A build with no root is not judged, for the same reason a library is not judged for dead
  declarations. Across the four apps here the rule is silent.

- 78139fe: The factory JSX compiles to is an edge, and a route table built by a loop names its views.

  A tag is not the only way to mount a component, and this repository's documentation site uses the
  other one throughout: `__h(Markdown, { tree })` with the component named outright, and
  `__h(component, null)` with it taken from a registry. Neither is a JSX element, so the walk saw
  nothing — and neither was a hole, because nothing looked like an unresolvable tag.

  **Measured, and the number is the point: the walk reached 10 of that app's 153 nodes, and the run
  still said every consumer had a provider above it.** It had judged almost nothing. It reaches 90 now,
  over 242 edges rather than 141.

  Three shapes are read where one was:

  - the factory called with a component named outright;
  - the factory called with a value from a registry written as a literal — the key is decided at run
    time and the map is not, so what MAY mount is the union of its values. A shorthand entry took two
    hops to resolve, and each of them silently emptied the union: the symbol at `{ Counter }` is the
    PROPERTY, and the symbol behind that is the IMPORT;
  - a route table built by a LOOP. `collectRouteTable` read only the JSX written inside
    `createRoutes(...)`, and the documentation site builds its table with
    `table[page.path] = __h(DocPage, { meta: page })` over a hundred paths.

  A tag chosen between two ELEMENTS — `const tag = inline ? "span" : "div"` — is not a component, and
  is not reported. A tag whose value cannot be read as either is a hole like any other; the one in
  this repository carries its reason.

- cc9a466: Fixtures for two arrangements nothing was pressing.

  Both were repaired on the strength of reading the code, and no fixture in the repository had the
  shape — so a regression in either would have gone unnoticed while every test stayed green. That is
  exactly how the `list({ as })` path went stale.

  **Two outlets on one page.** Each `<RouteOutlet>` site keeps its own views, and a view reachable only
  under the provider its own section mounts is not judged from the other outlet.

  **A context that crosses a package boundary.** A package installed from its published files needs a
  context an app compiles from source; the app's provider satisfies it, and the path names the
  package's own internals — `App → Bare → Themed → ThemedBody`, pointing at
  `@acme/ui/src/index.tsx`. A second identity for one context would have failed the build against
  correct code.

  The dangling-reference invariant is stated for an APP's graph now. A library's fragment is pruned to
  its own package, so an edge may legitimately name another package's node — the app splices both and
  resolves it, or records a hole with the reason.

### Patch Changes

- 26a4f74: A component under another name is followed, and the message for one that is not says what it means.

  `const Named = Reader` and then `<Named />` was reported as a hole. It is a plain rename: one hop to
  what the name was declared with, which a loader, a binding and a factory's registry already got — a
  tag was the one place without it.

  The message for a name that genuinely cannot be followed said `resolves to VariableDeclaration`,
  which is the compiler's word for it and reads to everyone else as something else entirely. It now
  says a variable holds it and what it holds cannot be read from where it is declared — or, for a
  parameter, that only a caller can say.

  The hop is bounded, because two constants that name each other are a runtime error and ordinary
  syntax; the cycles fixture caught that within the minute of the hop being added.

## 0.5.0

### Minor Changes

- b5a2ec5: Every package ships its graph, and a graph describes what a project ships.

  `@ramonda/core`, `@ramonda/router`, `@ramonda/query` and `@ramonda/form` emit their fragment in
  their own build and point at it from `package.json`:

  ```json
  { "ramonda": { "graph": "./dist/graph.json" } }
  ```

  An app that installs them rather than compiling them from source now gets their composition instead
  of a hole. Measured on `apps/playground-core`, which has no `paths` entry for `@ramonda/form`: its
  two unresolved `this.use(Form<typeof schema>)` edges are gone, and four of the package's own nodes —
  `Form`, `Field`, `FormState` and the context the form publishes — are in the app's graph.

  **A graph now describes what a project ships, so test files are left out** — `__tests__/`, `test/`,
  `tests/`, `*.test.*`, `*.spec.*`, judged relative to the directory holding the tsconfig. This is a
  change to what the checks read as well: a class written to be checked is no longer reported. It had
  to happen for a fragment to mean anything. Measured: `@ramonda/query` counted 109 components against
  a real 12, `@ramonda/form` came out as an APP because its tests mount one, and core's fragment
  carried a component from a fixture directory.

  Two more things fell out of emitting fragments for real packages:

  **A root is a `bootstrap` that names a component.** `@ramonda/testing-library` calls `bootstrap` on
  a vnode it is handed — that is its whole job — and a call whose argument nothing can name starts no
  tree. Counting it made every package that maps testing-library in its tsconfig come out as an app.

  **A library's fragment describes itself.** These packages compile their dependencies from source, so
  `@ramonda/router`'s fragment carried `@ramonda/core`'s classes too — the same nodes, under the same
  ids, that core's own fragment declares. An app splices one fragment per package and gets each once;
  an edge pointing into another package still resolves, because the id is the same on both sides.

  Across this repository's four apps the graph is now complete but for two edges, and both are
  deliberate demonstrations of a failed load.

- 35ac1ba: Four faults found reviewing the graph work, each reproduced before it was fixed.

  **A package's component that provides its own context through a hook was reported as broken.** A
  hook is how a component publishes a context for its own subtree, and a fragment records that as a
  `uses` edge — the propagation is a rule, not a fact, and the rule ran over this project's own
  classes only. So a package judged its `SelfServing` clean and an app that installed it reported the
  consumer underneath as having no provider: the same code, two verdicts, and the wrong one is the one
  that fails a build. A false positive is the single thing this tool cannot afford.

  **Two constants that name each other crashed the run.** `const A = B; const B = A;` is a runtime
  error and ordinary syntax; following one into the other while reading a tag's props recursed with
  the depth unchanged, so `ramonda-check` died with `Maximum call stack size exceeded` instead of
  reporting anything — and every other check in that run died with it.

  **A route table built inline lost its edges.** `collectRouteTable` reads `const routes =
createRoutes(…)` and nothing else, but the JSX walk skipped every `createRoutes(…)` call on the
  grounds that it was read elsewhere. A table written inside a component was then read by nobody, the
  walk stopped there, and every consumer below it went unjudged — silence, which is the failure this
  whole design is against. Now only a BOUND table is skipped.

  **`ComponentNode.renders` was written in three places and read in none.** The walk moved to a
  per-site structure that carries what each call binds to a slot; the old set carried neither and,
  left in place, would have handed a later rule a quietly different answer.

- ea2a08c: The composition graph, written out with `--graph`.

  Every check this package already makes is one reading of the same thing — which components exist,
  and which one can mount which. That is now a value on the result (`result.graph`) and a file:

  ```bash
  ramonda-check tsconfig.json --graph .ramonda/graph.json
  ```

  It holds facts and never conclusions: nodes and edges, no issues and no paths, since the graph is
  small while the set of paths through it is not. `kind` is what a walk reads — `renders`, `provides`,
  `consumes`, `uses` — and `via` is only how it was written: a JSX tag, children of a wrapper,
  `list({ as })`, a route table, `bootstrap`. Splitting the two is what lets a new way of naming a
  component arrive without touching any reader.

  Every edge carries the place it was written, so a rule computed from the graph can name a line
  without going back to the source. A component is identified by its declaration —
  `<package>/<file>#<Name>` — and an edge that resolved to nothing is kept as `"kind": "unresolved"`
  with the reason: `` `Form` is declared in @ramonda/form/dist/index.d.ts, which this run does not
read ``. A blank left off the map is worse than no map, because it is trusted.

  It is a format rather than an API, versioned by `schema`. Measured on this repository's apps: 155
  nodes and 64 edges for the documentation site, 46 kB, and no difference to the run's ~2 s.

- 57710a9: A class counts as a component when its heritage chain reaches `Component` or `Hook`.

  The membership test read one heritage clause and said yes to a class extending anything at all, on
  the reasoning that a subclass of a subclass still is one. It is — and so was `class MyError extends
Error`. Measured on a fixture of five classes, all five counted; measured on this repository's four
  apps, the number the CLI prints was inflated by every error type and every custom element in scope:
  75 → 72 components in the docs app, 12 → 9, 57 → 53, 33 → 29 in the others, and every class the
  walk now drops extends `Error` or `HTMLElement`.

  The chain is walked by symbols — the base's symbol, through an import alias, to its class
  declaration, and up — so `Deep extends Base extends Component` is still a component. A tighter name
  check would have dropped it. A mixin's heritage clause is a call (`extends withTheme(Component)`)
  and has no symbol to follow, so it reads as "not a component": answering it needs a type, and types
  are outside what this analyzer loads.

- 7b9cc9a: JSX written outside a component class is an edge too.

  `function row() { return <Cell /> }` mounts `Cell` wherever it is called, and nothing owned that tag
  before: JSX outside a class was read only inside a route table or a `bootstrap` argument, and
  everything else was invisible rather than a hole — so a consumer reached only through a helper was
  never judged at all.

  Nothing has to be followed to fix that. The tag is written in the helper, so the edge is read where
  it is; only the owner was in question. The answer is the helper itself, as a node of its own
  (`"kind": "helper"`), with a `calls` edge from every component that reaches it — and the report then
  names it: `App → Bare → row → Cell`. Three spellings are read: a declared function, a const holding
  an arrow or a function expression, and a method of a class that is not a component.

  A route table and a `bootstrap` argument are not helpers. Both are read where they are written, and
  counting them twice would give one mount two owners.

  Four turned up in this repository's own apps, all of them SSR entries — `entry-server.tsx`'s
  `render` and `prerender`, and the docs site's `renderOne`. They render `<App />` into a string
  rather than mounting it, so they were not roots and nothing else saw them either. They are in the
  graph now, as facts, with nothing calling them.

- c7ac716: A component in another chunk is an edge like any other.

  `<AsyncLoad lazy={…} namedExport="Page" />` is the largest edge kind an app has and it is not a
  tag: the documentation site in this repository reaches 75 of its 76 lazily loaded components
  through one attribute, so a walk without it judged a fraction of what the app mounts. Those pages
  are now walked, which means a consumer with no provider above it inside a lazily loaded page is
  reported like any other.

  Nothing is guessed. The module is a string literal — exactly what a bundler needs to split a chunk,
  so a loader this cannot read is one no bundler could split either — and `namedExport` is a literal
  saying which class to take. Three shapes are read, all of them measured in this repository: the
  loader written in the JSX, one hop to a static field or module constant (which is where `RMD020`
  pushes it, since a fresh arrow in the JSX is a new prop on every render), and a literal registry
  indexed by a runtime key, which contributes the union of its values. A loader that fails and
  retries still reaches its module, because the body is searched rather than read as one expression —
  `may reach`, which is the semantics the whole walk is on.

  A specifier built at runtime is kept as an `unresolved` edge with its reason rather than left out.

  The edge is attributed to the component that writes the tag, not to `AsyncLoad`. `AsyncLoad` is one
  shared class and neither provides nor consumes a context, so nothing sits between the two that a
  walk would step over — while hanging the targets off it would put every lazily loaded component in
  an app on one node and make each reachable from every other. `RouteOutlet` is the opposite case and
  keeps its views: it publishes the matched params, so its views have to be below it.

  Measured on the documentation site: 140 edges rather than 64, 76 of them through a loader, and the
  run is unchanged at ~2.05 s.

- 0688194: A list's rows are read where they are written.

  `list({ each, as })` is gone from core — a list mounts a component through the callback it takes,
  and the row's tag is written in the component the list sits in, which is exactly where the row
  mounts. The ordinary JSX walk already reads it, so the machinery that read the `as` option is gone
  with the option, along with the `as` value of an edge's `via`.

  Measured across this repository: no `as` edge survives in any app, and `renders/tag` rises by the
  same amount — the documentation site goes from 29 tags and 5 `as` to 33 tags and none.

  That path had no fixture, which is how it could go stale unnoticed; the new shape has one.

- 2027f6a: A helper written inside another helper owns its own tags.

  A helper's body was walked whole, nested functions included, so a tag written in an inner function
  became an edge from the inner helper AND from the outer one — from the same line, with the outer one
  never writing it. And a helper calling a helper produced no edge at all, because a call was read only
  inside a component's body; the false render edge is what accidentally covered for the missing call
  edge.

  Reachability agreed while the outer function did call the inner one. Define the inner one and never
  call it and the outer still claimed to render its tags, which a rule about components nobody renders
  would read as live.

  Found by an agent's scratch fixture during a review that was stopped before it reported.

- e16a94a: A component is a declaration, not a name.

  Components were held in a map keyed by class NAME, so two classes with one name were one node
  sharing a single set of providers, consumers and children. This repository's own documentation app
  declares `class Page` seventy-five times, one per page: 146 component and hook classes were counted
  and reported as 72, and a provider mounted by one page covered every other page on every path.

  Identity is the declaration site now, and everything that names a component — a JSX tag,
  `list({ as })`, a route table, `bootstrap` — is resolved to its symbol rather than looked up by
  name. An import alias therefore reaches the class it renames: `import { Page as Themed }` followed
  by `<Themed />` is an edge, where a name lookup found nothing at all and the walk stopped there.

  The counts the CLI prints move with it — the docs app reports 146 components rather than 72 — and
  the four apps in this repository report the same issues as before.

- 916a9db: A component handed over as a prop is followed to where it mounts.

  Two halves that meet at the walk. A component declares which prop paths take a component, read from
  its own props type as syntax — and a **path**, not a name, so a slot at depth five is the same
  mechanism as one at depth one with a longer string: `view`, `spec.columns[].cell`. A call site
  records what it hands over, walked to any depth through object literals, arrays, a ternary (both
  arms, because the question is what may reach) and one hop through a module constant, which is where
  `RMD020` pushes anything built the same way on every render. And a tag naming a prop —
  `<this.props.view />`, or `const View = this.props.view` — is an edge that names the prop it waits
  on rather than a missing one.

  **A binding lives on the edge, not on the component.** `<Slot view={Reader} />` in one place and
  `<Slot view={Writer} />` in another are two arrangements; kept on `Slot` each would be reachable
  from the other, and a provider above one would appear to cover the other. The walk carries them
  with the path, so the same component filled into the same slot is judged separately on each path —
  which is the fixture: one `Slot` mounted twice with one `Reader`, under a provider and not, and
  exactly one report.

  Slots are read as syntax, and what syntax cannot answer is left alone rather than approximated: a
  mapped type, and a function that returns a component. A prop typed as a rendered NODE is not a slot
  either, though a node carries a component class inside it — measured, a walk that hunted for the
  marker anywhere reported eight slots in `@ramonda/core` that are not slots.

  A JSX tag written as a member expression is seen now — `<this.props.view />`, `<screens.reader />`.
  Those were invisible rather than holes, because a tag was taken for a component only when it began
  with a capital.

  Nothing in this repository passes a component through a prop at any depth, so no app's graph
  changes: this is for the packages other people write.

- 5940f4e: Seven more faults from a second review, each reproduced before it was fixed.

  **A helper written as a concise arrow lost every edge in it.** `const header = () => <Legend />`
  stores the element as the arrow's body, and the walk iterated the body's CHILDREN — the tag name and
  the attributes, never the element. The helper came out with no edges and no hole either, so a
  consumer reached that way was never judged. It was in this package's own fixture the whole time.

  **A context had two identities, and a package's requirement could never be met.** A local context was
  keyed by absolute file and line while a spliced fragment keys it by its graph id, so a fragment
  consuming a context declared in another package could not be satisfied by the app mounting that
  provider — a false positive against correct code — and an optional context consumed across a
  boundary was reported as a hard failure. There is one identity now, the graph's.

  **A package's helpers were dropped on splice.** `splice` built nodes for components, hooks and
  contexts only and matched no branch for a `calls` edge, so composition that runs through a
  package's own `function row() { return <Cell /> }` was invisible. The report now reads
  `App → Bare → DataGrid → helpedRow → HelperBody`, naming a function the app cannot import.

  **An edge could name a node the graph does not declare.** A fragment is pruned to its own package, so
  its edges may point outward; copying one into an app with no fragment for the other package left a
  `to` matching nothing. Those become holes with the reason, and every fixture is now checked for
  dangling references.

  **A component that mounts itself with another binding was cut as a cycle.** The guard keyed on the
  node alone while the bindings travel per path, so a tree renderer's second arrangement was never
  walked. It keys on the node and its bindings now, with a hard path limit as the backstop.

  **The emitted bytes depended on the machine's locale**, because `localeCompare` ordered the nodes,
  the edges and the source hash. Ordered by code unit now.

  Also: a dead ternary whose two arms were both `undefined`; the author's name re-encoded as an escape
  in four package.json files by a JSON writer; and two changesets that said `patch` where the rule
  while everything is 0.x is minor.

- b8a4ad9: The rest of the second review's findings.

  **A lazily loaded component inside an installed package now resolves.** `classExported` looked the
  class up among this project's own components only, so `<AsyncLoad lazy={…}>` pointing into a package
  compiled from `dist` found nothing and the whole chunk went unjudged. It reads the package's
  fragment now.

  **Two exported classes with one name are refused rather than merged.** A package's surface is keyed
  by the name an app imports, which is the only handle it has; a second class under that name used to
  overwrite the first silently — the name-keyed merge this work removed everywhere else. Neither is
  spliced now, and the run says so.

  **A route table nobody hands to a `<RouteOutlet>` this run can see is named.** The table is skipped
  by the JSX walk because `collectRouteTable` reads it, and that only becomes edges when some outlet
  names the binding — so one handed to an outlet outside the program left every view with no edge and
  nothing saying so.

  **Every `<RouteOutlet>` site is its own node.** Views hung off the shared `RouteOutlet` class, so two
  outlets in one app put every view on one node and made each reachable from the other. Each site
  `uses` the outlet class, so the matched params it publishes still reach the views — which is why
  they were attributed to the outlet in the first place.

  **A fragment carries `opaque`.** A component whose own package refused to judge below it was walked
  by an app as if it were transparent, so a consumer under it could be reported when the hook the
  package could not follow may well have been providing.

  **A class extending a CALL is named instead of dropped.** `class Panel extends withTheme(Component)`
  needs a type to follow, so it is not a component here — and dropping it in silence made the omission
  invisible.

  **`slotsOf` keeps its `seen` set per path**, so `{ left: Panel; right: Panel }` yields `right.cell`
  as well as `left.cell`.

  **A malformed fragment is refused with a reason** rather than throwing out of the splice, and the
  hook fixpoint says so when ten passes are not enough instead of quietly under-propagating.

  One finding was tried and reverted, with the measurement kept: running the three non-composition
  checks over test files again — which is what `main` did — fails `@ramonda/core`'s own build on
  `class Bad { fn = () => … }`, a fixture written to be bad because it is what its test is about. A
  gate that fails on those is one people switch off. The cost of leaving it is written down where the
  exclusion is.

- 8678567: The CLI is reachable on a fresh install.

  `pnpm install` creates a package's bin links from what is on disk at that moment, and this package's
  bin WAS its build output — so on a clean checkout it warned, skipped the link, and every build that
  calls `ramonda-check` failed with `sh: 1: ramonda-check: not found`. It worked on a machine that had
  already built the package once, which is why it passed locally and failed in CI on the first run.

  The bin is a committed launcher now, which imports `dist/cli.js`. A file that is always present can
  always take the link, and the build output is reached through it.

- 05c28dc: A component this cannot follow is an error.

  The walk goes quiet below a name it cannot resolve, so everything under it is unjudged and the build
  passes over a page that may be broken. That is the one thing this package cannot afford, because its
  whole value is that a report is a real broken path rather than a maybe — and that only holds while
  the map has no unmarked blanks.

  The constraint is not this tool's to impose. A bundler can only split what it can see statically, so
  whatever this cannot resolve could not have been code-split either: the shape was already trouble
  for another reason.

  **The escape hatch is a record.** When the source is right and this is the one that cannot see it,
  write the reason on the line:

  ```tsx
  // ramonda-check-ignore the caller hands us the tree to mount, which is what this helper is for
  bootstrap(wrap(ui), container);
  ```

  Line-scoped, never file-scoped — a file-scoped suppression blinds a whole file with one line, which
  is exactly what somebody in a hurry reaches for. The reason is mandatory: a directive with nothing
  after it is refused. And every annotated site is listed on every run, whether or not anything
  failed, so the number cannot creep up unread.

  A tag naming a prop is not one of these. `<this.props.view />` is unresolvable from the class alone
  by design, and the walk fills it from what the caller binds.

  Messages carry the fix as CODE rather than as advice, because most of what this reports on will be
  written by an agent, and an agent acts on a patch far more reliably than on a sentence.

  **Measured across this repository: three sites need the hatch**, all in `@ramonda/testing-library`
  and all the same shape — a helper that mounts whatever the caller hands it, which is its whole job.
  Those three carry their reason now. The two in `apps/playground-core` are demonstrations of a failed
  load, which is what they are for.

- 48b2345: A package publishes its own graph, and an app splices it in.

  An installed package is a `.d.ts` and nothing else, and this reads source — so its components, its
  hooks and the contexts they need vanished at the package boundary, silently. It is measurable in
  this repository today: `apps/playground-core` has no `paths` entry for `@ramonda/form`, so
  `this.use(Form<typeof schema>)` reaches `dist/index.d.ts` and the whole package drops out of the
  graph.

  A package closes it by emitting its graph in its own build and saying where it is:

  ```json
  { "name": "@acme/ui", "ramonda": { "graph": "./dist/graph.json" } }
  ```

  ```bash
  ramonda-check tsconfig.json --graph dist/graph.json
  ```

  A package has no root, so its graph comes out with `"scope": "library"`: nothing in it can be judged,
  because "unreachable" and "no provider above" are questions only whoever mounts it can answer. What
  it carries is a **fragment** — its surface marked `"exported": true`, and its internals as well.
  That is the difference from a summary. A summary would say _DataGrid requires Query_ and an app
  would have to trust it; a fragment is spliced in and walked, so the report names the real path
  through the package: `App → Bare → DataGrid → PagedBody`, where `PagedBody` is a class the app
  cannot import and has never heard of.

  **A stale fragment is refused rather than trusted**, which is the failure this design calls worse
  than no map. The fragment fingerprints the declaration file a consumer can actually see — the source
  hash is no use to somebody who has `dist` and nothing else — so a package rebuilt without
  regenerating its graph is reported and left out, and no verdict is invented from it. A fragment also
  carries the package's version, because two versions of one package can be installed at once: the
  node ids collide while the graphs differ.

  Nothing in this repository publishes a fragment yet, so no app's graph changes.

## 0.4.0

### Minor Changes

- 2af155f: Two things: a rule for the form field nothing at runtime can report, and a walk that had gone dark

  **A component that READS a form field it was handed without watching it.** Such a component never
  re-renders — its message never appears, and a write from anywhere else never reaches its input.

  ```text
  [ramonda-check] 1 component(s) reading a form field they do not watch:

    src/TextField.tsx:9:23
      <TextField> reads `bind` from a field in its props, so it will
      never show a change to it — the component does not re-render at all.
  ```

  It cannot be a runtime diagnostic at all, which is why it belongs here: the form would have to know
  who is rendering, and nothing in the running page distinguishes "the owner is reading its own field"
  from "a child is reading a field it will never hear about again". The fix is `@ramonda/form`'s `Field`
  hook.

  Only a READ is reported. A component that writes through the field — `set` from a click handler — is
  correct as written, and one that passes it down without reading it is a layout. Both stay quiet, along
  with the owner reading its own fields. Run against this repository's three apps, 160 components: no
  reports.

  **And a fix worth more than the rule.** `this.use(Form<typeof schema>, …)` is an instantiation
  expression rather than an identifier, so it did not resolve — which marked the owning component
  _opaque_, and a component is opaque exactly when the walk STOPS beneath it. Every context consumer
  under a form, a query or any hook written with its type argument named had quietly stopped being
  judged. The pin is unwrapped now, and a fixture holds the shape: with it, the missing provider is
  reported; without it, the report is silence.

  And every issue type `AnalyzeResult` carries is nameable now. `DuplicateDecoratorIssue` and
  `UnwatchedFieldIssue` were not exported, so a script written against `analyzeProject` — which the
  reference tells people to write — could type a variable holding a context issue but not one holding a
  duplicate decorator.

## 0.3.2

### Patch Changes

- a711652: A duplicate decorator report says what the second declaration actually does

  One report, four faults, four pieces of advice — because "one of them never runs" is true of exactly one
  of them, and naming the wrong one sends a reader after a difference that is not there.

  **`refuses`** — `@Host`. It throws (RMD045): two element names have no union, so there is no live
  declaration to look for.

  **`displaces`** — `@catchError`, `@ShouldUpdateOnPropsChange`. One wins, the rest are dead code, and the
  report says WHICH is live.

  **`merges`** — `@StableProps`. Both take effect and the result is the union (RMD046); nothing is lost and
  only the spelling is redundant.

  **`redundant`** — `@state`, `@compute`, `@persist`, `@memoizedHandler` on one MEMBER twice. Measured in
  core rather than assumed: a doubled `@state` renders once per write with the right value, and
  `@compute`'s body runs once for two reads. Nothing is displaced, so the advice is "delete the extras",
  not "work out which line is live" — that would send somebody after a difference that does not exist.

  Counting the redundant kind per class reported `<Search> declares @state 5 times` against this
  repository's own documentation app, where five different fields each carry one. It is per member now, and
  the report names the member: `RedundantTwice.n carries @state 2 times`.

  `@watchProp` is deliberately not in either set: several on one method is the supported way for one
  handler to follow several props, and each application does real work.

## 0.3.1

### Patch Changes

- 8634bbe: A duplicate single-use decorator names the declaration that is actually in effect

  The report said "the last wins" for every one of the four decorators it watches. That is true for
  `@catchError`, a MEMBER decorator, and false for `@ShouldUpdateOnPropsChange`, `@Host` and
  `@StableProps`, which are CLASS decorators — so on three of the four it pointed at the line that works
  and told you to delete it.

  One rule underneath both: the declaration applied last is the one that stands. A member decorator
  initialises top to bottom, so the **lowest** is applied last. A class decorator applies bottom-up, so
  the **highest** is. Measured in `@ramonda/core` — `CatchErrorDecorator.test.tsx` watches which handler
  receives the error, `PropsGateInheritance.test.tsx` watches which gate is asked — because the two
  directions are opposite and neither is guessable from reading.

  `DuplicateDecoratorIssue` therefore carries `kind: "class" | "member"`, read off the node the decorator
  was found on rather than from a table of names: `@ShouldUpdateOnPropsChange` was a member decorator
  before it was a class one, and a table would still be saying so.

## 0.3.0

### Minor Changes

- a4ac681: Reports a single-use decorator declared twice on one class

  `@catchError`, `@Host`, `@ShouldUpdateOnPropsChange` and `@StableProps` each answer a question that
  has one answer. Declared twice, the last one wins and the others never run — silently, and the one
  being read may be the dead one.

  The framework reports what it can at runtime (RMD032 for `@catchError`), but only once the component
  mounts, which is the gap this package exists for: a class behind a condition nobody clicked ships
  with the fault and nothing has said a word.

  A SUBCLASS declaring its own is not this. That is an override — the way a role is specialised — so
  only declarations on one class body are counted.

### Patch Changes

- 2d71ce2: Every fixture is on the JSX runtime real projects use

  They were all on the classic one — `"jsx": "react"` with `"jsxFactory": "h"`, naming a factory the
  framework does not export (core has `__h`, and both `create-ramonda` templates configure
  `jsxImportSource: "@ramonda/core"`). So the analyzer was only ever proved against a configuration
  nobody has. TypeScript emits the same JSX AST either way, but "should" is not "does", and one of the
  fixtures now asserts a missing provider is found with the right PATH — which needs the JSX tree
  walked — under `"jsx": "react-jsx"`.

  No behaviour changed. The `h` stub the fixtures declared for themselves is gone with them.

- fb3f4a3: The analyzer is now proved against the JSX runtime real projects use

  Its fixtures were all on the CLASSIC runtime — `"jsx": "react"` with `"jsxFactory": "h"`, a factory
  the framework no longer exports (core has `__h`, and an app is configured with
  `jsxImportSource: "@ramonda/core"`). So nothing had ever run the analyzer against
  `"jsx": "react-jsx"`, which is the configuration every real project has. TypeScript emits the same
  JSX AST either way, but "should" is not "does".

  One fixture is on the automatic runtime now, and asserts a missing provider is found with the right
  PATH — which needs the JSX tree walked, so it is the fact rather than the assumption. The same
  fixture also stopped writing its components as `h(...)` calls and writes JSX, like every other one
  and like the code it stands for.

## 0.2.0

### Minor Changes

- e623571: `@ramonda/check` finds class fields holding a function literal, and its bin is now `ramonda-check`

  Ramonda binds every method to its instance, so `onPick = (id) => this.select(id)` buys nothing over
  `onPick(id) { … }` and costs one closure per instance. The check reports each one, and says which of
  the two fixes applies: a body that reads `this` wants to be a method, a body that does not wants to
  leave the class.

  It reads the source because nothing else can. At runtime the two are indistinguishable — by the time
  anything could look, the framework has written a bound function onto the instance under every
  method's name, and a field holding `debounce(this.save, 200)` is a function there too. That one is
  legitimate: a wrapper cannot be written as a method. Only the source tells a function literal from a
  call that returns one. `static` fields are not reported either — one per class, so nothing to save.

  **The bin is renamed** from `ramonda-check-context` to `ramonda-check`, because it no longer checks
  only contexts. Update the `build` script: `ramonda-check && …`. `npm create ramonda` writes the new
  name.

  `@ramonda/query` had one of these itself — `Query.observe` was an arrow field and is now a method.

## 0.1.0

### Minor Changes

- ef51691: New package **`@ramonda/check`** — proves every context consumer has a provider above it, before
  the app is ever opened.

  The runtime diagnostic (RMD003) can only speak when a branch actually renders, so a consumer
  behind a condition nobody exercised — or in a chunk nobody loaded — ships with the fault
  undetected. The commonest way to get there is a reorder: the provider moves, the consumer stays,
  and the page still renders because the context quietly falls back to its default.

  ```
  $ ramonda-check-context

    src/App.tsx:57:11
      <UserPage> consumes "Theme" — nothing provides it on this path:
      App → Sidebar → UserPage
  ```

  **It only reports what it can prove.** Anything it cannot resolve — a component chosen from a
  variable, a registry, a prop — makes it go quiet for that path rather than guess, which is what
  makes it safe to fail a build on: a report is a real broken path, never a maybe. It follows JSX
  (children of a component belong to that component), `list({ as })`, route tables through
  `<RouteOutlet routes={…}>`, and contexts a hook carries for its owner.

  Scaffolded projects run it as the first step of `build`, so a lost provider fails the build
  instead of reaching a browser. Existing projects: add `@ramonda/check` as a dev dependency and put
  `ramonda-check-context && ` in front of your build script. `typescript` is a peer dependency — the
  analyzer uses your compiler, so it reads your own syntax and config.

### Patch Changes

- 514c42e: `ramonda-check-context` no longer loads the TypeScript lib and `@types/*` declarations it never
  reads.

  It asks the checker exactly two things — `getSymbolAtLocation` and `getAliasedSymbol` — both of
  which are binder work over the files it walks. It never asks for a type, so `Array`, `Promise`, the
  DOM and every installed `@types` package were megabytes of parsing for nothing.

  Measured: this repo's docs app (68 components) went from **2.4s to 1.6s**, and a four-file fixture
  from 214 source files to 2 — 610ms to 3ms. The checker runs FIRST in an app's `build`, so that time
  was on every build.

  The reported result is identical: same components, same contexts, same issues. A project that does
  not compile is still `tsc`'s news to break, not this tool's.

- d1e56fc: Two regular expressions replaced with linear scans. Both were the same shape — `+` anchored at
  `$`, which cannot match when the string does not end in the run it is looking for, so the engine
  retries from every position and backtracks the whole run each time.

  **`normalizePathname` (router)** is the one that mattered: it reads
  `window.location.pathname`, so the string comes from whatever URL someone was handed. Measured on
  `"/".repeat(n) + "a"` — 30k slashes took 942ms, 60k took 3.7s. A link with enough slashes hung the
  tab that opened it. The scan handles 200k in about a millisecond.

  **`create-ramonda`** trimmed dashes off a derived package name the same way (`/^-+|-+$/g`); only a
  folder name reaches it, but it is published source, and two loops are the right way to trim
  anyway. Output is unchanged on all 17 shapes checked.

  **`ramonda-check-context`** derived the tsconfig's directory with a regex; it now uses
  `path.dirname`, which is what the operation is called. Reported by CodeQL. The analyzer's result is
  unchanged — same components, same contexts, same issues, verified against an absolute path, a
  relative one, and one already ending in a separator.

  Separately, two `console` calls built their message by interpolation and passed a value after it.
  A console treats its first argument as a **format string**, so a `%s` inside the interpolated part
  consumed the argument that followed — and in both cases that argument was the payload:

  ```
  of /about%s failed:  →  "of /aboutupstream down failed:"   (the error never printed)
  ```

  `createIsrCache`'s default `onError` lost the reason a rebake failed; the devtools log row lost the
  data you clicked it to see. Both now use a `%s` placeholder. Reported by CodeQL for the first one.
