# @ramonda/check

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
