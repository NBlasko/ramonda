# @ramonda/check

## 0.14.0

### Minor Changes

- 2b7e7ea: `createContext(defaults, { stableProps })` — a context declares which keys are values

  A key holding an object literal is a new object every time the provider's callback runs, and a new
  object is a changed key — so every consumer of it wakes, however unchanged the contents are.
  Measured in `ContextValueIdentity.test.tsx`, counting a consumer that reads only `conf` while a
  DIFFERENT key of the same provider moves three times:

  | the provider                                          | consumer renders |
  | ----------------------------------------------------- | ---------------- |
  | `() => ({ conf: { dense: true }, tick: this.tick })`  | **4**            |
  | the same, with `stableProps: ["conf"]` on the context | **1**            |

  The declaration already existed as `@StableProps`, and a context could not reach it. `createContext`
  returns a class rather than a declaration site, so the only way to attach a decorator was to write a
  subclass that did nothing else:

  ```tsx
  @StableProps("conf")
  class ConfProvider extends ThemeProvider {}
  ```

  Now it is said where the context is made, which is where the answer lives — whether `conf` is a
  value or an identity is the context's own knowledge, and it is true for every provider of it:

  ```tsx
  const [ConfProvider, ConfConsumer] = createContext(
    { conf: { dense: false }, tick: 0 },
    { stableProps: ["conf"] }
  );
  ```

  **It is one mechanism, not two.** The option writes the same list the decorator writes, on the same
  class, read by the same lookup. The subclass spelling still works and is still type-checked.

  **It can do one thing the decorator cannot.** A context's keys are the default value's keys — a
  Provider publishes nothing outside them, so no consumer could read a key outside them. That makes a
  name that is not one of them a mistake this end can SEE. It is refused twice: by the types, against
  `keyof` the default value, and at runtime for a caller who has none. A decorator on a class knows
  only the type it was handed.

  The comparison itself is unchanged, including what it will not do: **functions are never covered**,
  because two closures with the same body are not equal by any comparison that is safe to make, so a
  listed function key is left exactly as it came and `RMD022` still reports it. Contents that really
  move still arrive — this is a comparison, not a freeze.

  **`@ramonda/check` reads the new spelling**, and had to before the advice could recommend it — a
  rule that cannot see a declaration reports the fix. `fresh-object-in-hook-props` and
  `fresh-object-in-props` now ask one question that answers for both spellings, and
  `fresh-object-in-hook-props`'s advice points at the option instead of at a subclass. The call is
  identified through core rather than by the letters at the call site, so `import { createContext as
makeContext }` is read exactly the same — the same lesson an aliased `@StableProps` taught this rule
  once already, when it reported the very key a child had declared.

- 83c6685: `function-used-as-a-tag` — a plain function where a component belongs

  Ramonda's unit is the class. A function has nothing to construct, no state and no lifecycle, so in
  tag position it names nothing the framework can keep hold of. `RMD011` reports it once the line runs.

  **The reason this is a rule at all is measured, not assumed.** `JSX.ElementType` is deliberately
  undeclared, so TypeScript applies its default rule — a tag must return one `JSX.Element`:

  | the function returns        | the compiler      |
  | --------------------------- | ----------------- |
  | several nodes               | refused, `TS2786` |
  | anything that is not a node | refused, `TS2786` |
  | exactly ONE node            | **accepted**      |

  The accepted shape is how a function component gets written out of habit, so the likeliest spelling
  was the only one nothing typed caught. The report says which side of that line each finding is on,
  so a reader meeting two messages about one line knows why there are two — and says NOTHING about
  the compiler when it cannot tell. That third state was found by running the rule against a fixture
  that already existed: `(props) => props.value` as a tag returns a string, so `TS2786` refuses it,
  and a two-state answer had printed _the types let this shape through_.

  All three are reported rather than only the third: this package does not typecheck, by design, and
  runs over projects whose types are loose or absent — a rule that answered only where `tsc` is silent
  would change its mind depending on somebody's build.

  **None of this restricts arrays.** A component returning `[<td/>, <td/>]` is the framework's own
  headline case and compiles; so does `{rows()}` in an expression slot. Only tag position is
  constrained, and only because that is where the default rule applies.

  **An alias is one hop, and the fault survives it.** `const Row = SideBar` then `<Row />` is the same
  function in the same position; the first version read only the initializer's shape and went silent
  on it. The chain is cycle-guarded.

  Silent on a class, on an alias for a class, on a value read off something (`<kit.Link />`, which is
  the router kit's shape), and on a call in an expression slot — which is the answer, not the fault. A
  function is welcome to return JSX; what it may not do is stand where a component belongs.

- f04f1a2: `ruleCatalogue()` carries each rule's `advice`

  The documentation site builds a page per rule out of it — 84 pages where there was one table — so
  the terminal and the page say one thing and neither can drift from the other.

  **Deliberately the advice and not the docstring**, although the docstrings are the better prose and
  there are 8,751 lines of them. A docstring argues with the PAST: which shape was rejected, what a
  measurement disproved, why the obvious fix is wrong. That is right beside the code, where it stops
  somebody undoing a decision, and wrong for a reader meeting the rule cold — who does not care what
  was, only how it works now. `advice` is already the reader's text.

  One rule's advice had to change to earn that: `row-without-a-key` said _"Each line above says which
  of the two you are looking at"_, which points at nothing on a page. One of eighty-four, so the
  corpus was already almost medium-independent — and a test now keeps it that way, because the next
  person writing advice will be looking at a terminal.

- 23d6f4a: A swapped `ref` is honoured at once, and building one in a render is reported

  `<TextArea ref={cond ? a : b} />` did not hand the node over when `cond` flipped. The old ref kept
  pointing at a live node and the new one stayed empty until something else happened to update that
  field — measured, and found by reading the one unhit branch left in `base/TextArea.tsx`.

  `helpers/arePropsBagsEqual.ts` ignored `ref`, for a reason that was true when it was written: a
  component's ref was pointed at its host element at creation and never read again, while an inline
  `ref={createRef()}` handed the child a new object every parent render — one wasted child render per
  parent render, measured, with nothing to say so. **"Never read again" stopped being true.** `Select`
  and `TextArea` take the element's ref for themselves, so each hands the CALLER's ref the node by hand
  and re-checks it on every update. With `ref` out of the comparison there was no update to re-check
  on: the component was never queued and `rawProps` was not even replaced. `Select` was saved only by
  always having children to rebuild.

  `ref` is compared like every other prop now. A stable `ref={this.field}` costs nothing — the value
  is identical, so nothing is notified. And it fixes a second case nobody had noticed: `ref` used to be
  subtracted from the key COUNT on both sides, so `<Child ref={r} />` becoming `<Child />` read as the
  same shape and the ref was never released.

  **The wasted render is no longer silent, which is what that exclusion was really for.** Two new
  reports, one on each side of the line:

  - `RMD061` at runtime, when a `createRef()` is reached from a render, a `@compute`, a `@memoized`
    member or a hook's props callback. One message rather than `RMD021`'s four, because unlike a
    random number the fault does not differ by phase: a ref belongs on a field in every one of them.
  - `ref-built-where-it-cannot-be-kept` in `@ramonda/check`, which says the same thing before the line
    runs — including in a branch nobody has rendered. It follows what a render REACHES, so a helper two
    files away and a base class's method are covered, and it judges `createRef` by where the binding
    came from rather than by its name.

  The callback form is untouched and belongs on a field: `createRef<T>((node) => this.arrived(node))`
  is how `Select` and `TextArea` learn their element has appeared. What must not move is the ref.

- 19745a7: `object-among-the-children` — a plain object written where markup was meant

  `vdom/h.ts` walks an element's children and replaces anything that is an object but not a vnode,
  a list descriptor or an array with a hole: _"an object that is not a vnode has nothing the diff can
  do with it"_. `RMD037` names it in a development build.

  The failure is SILENT and it looks like data. Nothing throws and nothing is red — the page renders
  without the thing, and the eye goes to the fetch, the state and the condition long before it goes to
  the one child that was never markup. Almost always the line stopped a word early: `{item}` where
  `{item.name}` was meant.

  Reported wherever the object is written: in the child, in a `const` one line up, in a module
  constant, or on one arm of a branch — that arm really is dropped whenever it is taken.

  **A module constant counts here, and is the FIX in `fresh-object-in-props`.** Both walk the same
  `follow`, and the difference is the question. "Is this value rebuilt?" — a module constant is the
  answer. "What IS this value?" — it is still an object, and the runtime still drops it.

  Silent on an ARRAY, which the runtime flattens into the children rather than dropping; on a CALL,
  which may hand back a vnode, and this rule's claim is that the page is missing something; and on a
  prop, a field read, a vnode, a string or a number.

  Reports nothing across the documentation app, the packages and the playgrounds.

- b4dbb73: `ramonda-check` reports a lens path that walks through a gap

  Only the LAST hop of a `focusOn` path creates what it names. `focusOn(state).get("profile").set(p)`
  writes a profile whether or not one was there; `focusOn(state).get("profile").get("name")` has to
  walk through the profile to reach the name, and if `profile` is `null` there is nothing to walk. The
  lens says so at runtime — `RML001`, which throws in development — and the new rule
  `lens-path-through-a-gap` says it before the line runs.

  The pair is the point. A path through a gap is written for the state as you picture it: a profile
  that is loaded, an address that is filled in. The gap is the case you were not picturing — a fresh
  account, a failed fetch, a first render — so the throw arrives on somebody else's machine while the
  rule arrives on the line as you type it. TypeScript does not object either way, and that is not a
  hole in the types: `keyof (Profile | null)` still offers `name`, so the chain type-checks because
  the chain is legal. Whether the value is THERE is a question about the value.

  Only a WRITE is reported. A read through a gap is what `value()` and `values()` are for — they
  answer `undefined` and `[]` by design and raise nothing — so the chain has to end in `set`, `update`,
  `merge`, `remove`, `and`, `push` or `insert` to be judged at all.

  A guard silences it, because a guard is what makes the write correct:

      if (state.profile) focusOn(state).get("profile").get("name").set("Ada");

  The shapes that count are the ones a guard is actually written in: the `if`, `!== null`, `!= null`,
  `&&`, a ternary, the early return, `!!`, `Boolean(…)`, a `const` the value was read into, and a
  longer path through the same hop (`state.profile?.name` can only be truthy if the profile is there).
  Two boundaries are held deliberately and asserted: a COMPARISON through an optional chain proves
  nothing, because `undefined !== null` is true when the value is missing, and a `let` can be
  reassigned between the read and the guard.

  An inverted guard is the fault at its clearest rather than an excuse for it: after
  `if (state.profile) return;`, in the `else` of a presence check, and inside `if (!state.profile)`,
  the gap is PROVEN — and each of those is reported.

  The walk carries on PAST a proven hop to whatever gap is deeper. Every one of those mechanisms was
  shown to fail the suite when broken, which is how three false alarms and four silences were found in
  the first place.

  It reads DECLARATIONS, not types, because this package may not ask the compiler for one: the root
  has to resolve to something with a written annotation, each hop's property has to be findable on an
  interface or type literal, and "may be missing" is the annotation as written. An array index, a
  computed key, a generic instantiation, an inferred root, or a `focusOn` that is not the lens's — each
  stops the walk without a word. It fails the run, like every rule here.

  `importedFromCore` became `importedFromPackage` underneath, which is what lets the rule tell the
  lens's `focusOn` from an app's own function of that name, alias and re-export included.

  Four dead branches are gone, and one of them was hiding a real message

  `@onWindow` and `@onDocument` resolved their target with a `typeof` check, and `Listener`'s `on:
"window"` did the same. An effect does not run on the server, so nothing could reach the empty side
  of any of them — and `RMD041`, the diagnostic that reported it, was a section in the reference for a
  fault the public API cannot produce. All of it is removed: the two resolvers answer the global, the
  `Listener` hook's two words do too, and a resolver that CAN come up empty is still the hook's
  `on: () => …`, whose `listen()` returns `false` and hands the caller something to act on.

  `base/Context.ts` looked like a fifth case and was not. Two of its `holder` fallbacks are live, and
  measuring said so: the RMD056 **throw** survives the production build while the name it prints is
  DEV-only, so production reads "this component" — and a class expression assigned to nothing has a
  `constructor.name` of `""`, which `??` does not catch. So `[RMD056]  mounts ThemeProvider twice`
  went out with no subject and a double space where the subject had been. One helper now answers both
  absences, every use is `||`, and two suites pin it: an unnamed class in the dev run, and the whole
  message in the production one — where the context's `label` turns out to be stripped too, so the
  report reads `Provider` rather than `ThemeProvider`.

- b42a785: Every rule fails the run, and there is a documented way to say "not here"

  `ramonda-check` had **nine errors and seventy-seven warnings**, and seventy-two
  of the warnings said in their own advice that they would become errors "in a
  later version". Nothing was tracking that, and a version that keeps saying it is
  a version that has decided not to.

  **Every rule is an error now.** The promise is kept rather than repeated, and the
  sentence that made it is gone from all seventy-two.

  **Because a warning that never fails anything is worse than an error with an
  escape hatch.** A warning is ignored in silence and nobody knows it was. An
  exemption is written down:

  ```tsx
  // ramonda-check-ignore this div is a backdrop; the real exit is the button beside it
  <div className="scrim" onclick={this.close} />
  ```

  That mechanism already existed and was not documented anywhere. It goes on the
  line the report names or the line above it, it works for every rule, **the reason
  is mandatory** — an empty directive silences nothing and is itself reported — and
  every annotated site is printed back on every run. A reason that has stopped
  being true cannot sit there unread.

  **The CLI no longer has two report loops.** One printed warnings and one printed
  errors, and with nothing warning, `tsc` refused the first as provably dead. They
  are one loop that prints every rule that reported; severity decides the exit
  code, through `failingRules`, and nothing else. A filter would have had one arm,
  and the arm it dropped is the one a future warning rule would land in — which
  would then report nowhere at all.

  **The certificate loses a claim, from four to three.** `quiet` said "no rule
  warns about anything it ships", and nothing warns any more, so it is a claim
  nobody can fail — which is the bar the certificate's own source sets for whether
  a claim is worth printing. What it was reaching for is what `plain` already
  says: nothing needed an exemption written beside it. `ClaimId` is
  `"complete" | "plain" | "current"`.

  **And the cost landed exactly where the documentation said it would.**
  `row-without-a-key` was the one rule that reports on correct code — an inferred
  identity that works — and as an error it failed this repository's own
  documentation app in seven places. Six had an identity to write down and now
  write it; one is a table row that is an array of cells and carries none, and it
  carries the directive instead. One of the six was a real fault: a comment in the
  search box claimed "keying by URL keeps those rows" beside code that keyed by
  nothing and worked only because the inference agreed with it.

  A `minor`, because pre-1.0 a breaking change is a minor. Nobody is on this yet,
  which is the argument for doing it now rather than at 1.0: promoting a rule is a
  breaking change, and the cheapest moment for one is while there is nobody to
  break.

- 8158025: `params(pattern)` the routing cannot answer

  `nav.params("/users/:id")` is a claim about which route a component is standing on. The router
  already refuses it at runtime — `assertPattern` throws in every build, naming both the pattern
  asked for and the route actually matched. This says it before anything renders, on every
  arrangement the source can produce, including the branch nobody clicked.

  **Neither of the two things that look like they should catch it can.**

  The types check the pattern against the paths your TABLE declares — `params<Pat extends
ParamPath<C>>` — never against the route this component is under. Measured on
  `apps/playground-ssr`: a page mounted at `/users/:id` reading `params("/guide/:slug")` compiles
  without complaint, because both are real paths in that table.

  The context checks cannot either, and this is the more interesting half. The params context is
  declared `optional` on purpose: `{}` is a REAL answer for a nav bar, a header or a footer beside the
  outlet, and `Navigator` holds that consumer for everyone — so reporting the missing provider would
  accuse the exact arrangement the router documents. The fault is which METHOD is called, not which
  context is consumed, and no rule about contexts can draw that line.

  **Two faults, one finding**, because they are the same mistake at two distances, and each line says
  which it is:

  - nothing routes to this component at all — the read belongs in the routed page, or it wanted
    `pathname`;
  - something does, and the pattern names a DIFFERENT route from the one that mounts it. This is the
    one nothing else could reach: a child of a routed page IS under an outlet, so the coarse question
    answers yes while the router throws the moment the page opens. It works because the table's KEY
    now travels down with the view — the key being the only place a route's `:params` are written, and
    it used to be read and discarded.

  **One failing arrangement is enough.** A component rendered inside a routed page AND beside the
  outlet is reported: the second place has no matched route, and the read throws there. Both faults
  answer that way, and making them disagree was a real bug caught reviewing this — the wrong-route
  half reported a component whose routes disagreed, while the no-outlet half stayed silent unless the
  component was NEVER routed.

  **What it will not claim.** A component every arrangement satisfies. One rendered both beside the outlet and inside a routed page is silent — it is correct on a
  path it is mounted on, which is why the answer travels with the PATH rather than living on the
  class. `params()` with no argument is never judged: it names no pattern and claims no route, which
  is the documented door for a component written against no one route. A pattern that is not a
  literal is skipped, because what it claims cannot be quoted back to the reader.

  Three silences make it safe to fail a build on: no root (a library has no arrangement to judge), an
  outlet that spreads props this cannot read (it may be handing over any table in the program), and a
  component no root reaches at all (that is the unreachable-declaration finding, and its fix is to
  mount the component, not to move the read).

  **Every finding names the path from a root** — `App > RouteOutlet > Page > Widget`. A component
  that reads params may come from ANOTHER package, and then the read's own file is a line the reader
  cannot edit: measured on a plant, a library component was reported at its own source while the thing
  to change was the app's tag under the wrong route.

  **Measured limits, each pinned in the fixture.** A route table whose keys are computed — a loop
  writing `table[page.path]` — names its paths at runtime: the views are known to be routed, and under
  what is not, so nothing is claimed about their reads. Same for a pattern in a `let` or built by
  concatenation. A navigator handed over as a prop is not recognised, because there is no
  `this.use(Navigator)` on that class to recognise it by. A pattern or a table key held in a `const`
  IS followed, one hop — extracting routes into constants is the tidier way to write this, and reading
  only literals meant the tidier the code, the less was checked.

  The navigator is identified through the router's own `knownAs`, so a kit member destructured out of
  `createRouter` and an import under another name are both read — measured on the real SSR playground,
  where `Navigator` arrives through the kit.

- 54de9bb: `props-written-by-the-receiver` — a component or hook assigning to its own props

  `RMD004` and `RMD015` report this at runtime, and the report is the smaller half of what happens:
  `core/debug/renderPhase.ts` says the write is _"stopped by the proxy, which throws in every build"_.
  So this is not a wasteful shape that still works — it is code that cannot run, which is why the rule
  is an **error** rather than the usual warning for a new one. The test is whether any version of the
  shape was meant, and a write that always throws was never the plan.

  **One rule for two codes.** `RMD004` is a component's props and `RMD015` a hook's; the runtime
  separates them only because the two proxies are installed in different places. From the source they
  are one sentence.

  Four spellings, all reported: a plain assignment, a compound one (`+=`), a `delete`, and an
  increment. Followed one hop through a local — `const p = this.props; p.label = …` is the same object
  under the same proxy — and through a cast, because `(this.props as Record<string, unknown>).x = 1`
  writes exactly what it looks like it writes.

  Silent on three things, each for its own reason:

  - **Mutating what props point AT.** `this.props.meta.seen = true` sets a key on `meta`, not on the
    props bag, so the proxy never sees it and nothing throws. A real fault of another kind — an object
    the parent owns, changed behind its back — and naming it this one would report a throw that does
    not happen.
  - **A destructured value**, which is a local.
  - **Another object that happens to be called `props`.** The name is not the subject.

  Reports nothing across the documentation app, the packages and the playgrounds, apart from one
  deliberate site in `playground-core` whose whole purpose is to make `RMD004` fire — which now
  carries its reason, recorded and printed on every run rather than silently ignored.

- 513cc7f: `--graph-html` — the composition graph as a picture, in one file

  `--graph` already wrote everything: measured on this repository's documentation app, **168 nodes and
  259 edges**. A hundred kilobytes of JSON answers a diff's question and not a person's, which is what
  the shape of the app actually is.

  ```
  $ ramonda-check tsconfig.json --graph-html app.html
  [ramonda-check] graph drawn to app.html — 168 nodes, 259 edges, 14 that nothing points at
  ```

  One self-contained page — no server, no network, nothing to install. It is a READER for the graph,
  not a second analysis: it adds no data and decides nothing the checker had not already decided.

  Three things it shows that the JSON does not:

  - **Distance from a root**, as the row a node sits in, so "what mounts this?" is read by going up.
  - **What nothing reaches**, in a band of its own rather than drawn beside the roots. "Nothing mounts
    this" and "this is an entry point" are opposites, and putting them in one row would erase the
    distinction the `unreachable` report exists for.
  - **A render that may never happen** — `always: false` — dashed. The analyzer already makes that
    distinction and nothing else surfaced it.

  No layout library, and that is a judgement rather than a purity rule: a force-directed cloud of 168
  nodes hides the one thing worth seeing here, which is depth. `--graph` is untouched — the JSON is
  what `--diff` compares, and a diff does not want markup.

- 4c0351c: Three exports removed, none of which had a caller

  A count of the public surface against everything in this repository that could use
  it — both apps, the scaffolder, and both templates — found 99 of 223 names with no
  consumer. Most of that is not a finding: `FormState` is a hook a user mounts and
  `seedRequest` is called by a user's server, so of course the framework does not
  call them itself. Three were different.

  **`matchRoute` is removed from `@ramonda/router`.** Nothing called it — not the
  router, not the apps, not the templates; its only appearances were its own export
  line and its own test. The outlet matches with `matchCompiled`, and `matchRoute`
  took an array of pattern strings, which is not a shape anything here produces. It
  was a convenience for a shape nobody has.

  **`parseUrl` is no longer exported from `@ramonda/router`.** It is
  `parseUrlString(location.href)` with the argument taken away, and taking the
  argument away is exactly what made it browser-only — the one caveat its
  documentation had to carry. The function stays inside the package, where `Router`
  uses it for the initial state and for back and forward; a consumer that wants the
  URL it is on hands `location.href` to `parseUrlString`.

  **`filesOf` is no longer exported from `@ramonda/check`.** The whole
  implementation is `new Set(ids.map((id) => id.split("#")[0])).size`, and the fact
  it encodes — that a declaration id is `file#name` — is stated on the checker's
  page. A caller who wants the count writes the line. It stays internal, for the
  CLI's `--split` output.

  **And the coverage check now looks both ways.** It could already fail on an
  export missing from the API reference; it could not fail on a reference row for
  something that is not exported. Removing these three proved why that matters —
  one stale row survived the edit and was found by hand. A row's first cell is
  read as a claim, and a claim that nothing exports fails the build.

  Pre-1.0, so this is a `minor` that removes API. Nothing in this repository used
  any of the three.

- af70b29: `lazy-imports-that-collide` — two `lazy` functions written the same way, loading different modules

  `AsyncLoad` keys its module cache on the SOURCE of the `lazy` it is given: `cacheKeyFor` reads
  `props.lazy.toString()`. That is right for the ordinary case and wrong for one —
  `() => import("./Panel")` is a single string and a **different module in every directory it is
  written in**, so two of those land on one cache entry.

  `RMD049` already reports it, and the runtime resolves it safely: it PROVES the collision by
  comparing both loaded modules, then mints the newcomer a key of its own. But it can only do that
  once both sites have actually rendered, in a development build, in one session. From the source both
  are visible at once.

  Mirrors the runtime's boundaries rather than inventing its own. Silent on:

  - **the same text in one directory** — it names one module, and `claim()` fires only when the two
    load _different_ things;
  - **a bare specifier** — `import("@acme/panel")` is the same package wherever it is written;
  - **an explicit `cacheKey`** — the app's own claim about identity, which the runtime believes;
  - **any element that spreads** — this is settled by an attribute that is NOT written, and a spread
    may be carrying it.

  Followed one hop through a name, because a module-level `const loadPanel = () => import("./Panel")`
  is what the documentation recommends — and a name is the spelling most likely to be copied between
  files, so reading only the attribute would have gone silent on the shape most at risk.

  Reports 0 across the documentation app, the three playgrounds, the router, the query and the form
  packages.

- 42abeed: `--certify` — what a package may claim about the graph it ships

  Every package already ships its graph: `ramonda.graph` in `package.json` points at a fragment, an
  app splices it in and WALKS it, and the fragment fingerprints the declaration file it describes so a
  stale one is refused rather than trusted. What was missing is the other half — how much of that map
  can be believed.

  ```
  [ramonda-certify] @ramonda/router 0.11.0

    Covers 6 component(s) and hook(s), 4 of them exported.

    ✓ complete  every component it names, it can follow
    ✓ plain     nothing needed an exemption written beside it
    ✓ quiet     no rule warns about anything it ships
    ✓ current   the graph fingerprints the declaration file it ships
  ```

  **There is no score, and that is the design rather than a simplification.** A number tells a
  publisher where they stand and nothing about what to do; the honest answer to _how far should I go_
  is a list that gets shorter. So an unheld claim comes FIRST and carries the work — the file, the
  line, and where a hole has a spelling to suggest, what to write instead, which the analyzer already
  produces for every hole it records.

  **The graph ships either way.** A certificate that gated it would give a publisher who cannot
  qualify a reason to ship nothing at all, and the consumer would lose twice: no map AND no warning.

  **Three things the measurement found, each of which would have broken it:**

  - **Claims must be scoped to the package's own files.** Before that filter, `@ramonda/form`,
    `@ramonda/query` and `@ramonda/router` each reported two written exemptions — and all six were the
    same two lines in `@ramonda/testing-library`, dragged into their programs by their test files.
    Three packages would have carried somebody else's excuse.
  - **Scoping by path PREFIX is not the same question**, and it is the one that looks right.
    Everything under `app/node_modules/@acme/ui` is "inside" the app by string. What decides is the
    file's own nearest `package.json`, so the fixture puts the faults in a package NESTED inside the
    certified one.
  - **A package with nothing in its graph prints no claims at all.** Every one would hold — there is
    nothing to fail them with — and a tick reads as approval whatever sentence sits beside it.
    Measured: `@ramonda/lens`, `@ramonda/server` and `@ramonda/build` would each have printed four,
    making _ship no components_ the cheapest route to a perfect certificate there is.

  An APP gets the report with its subject named rather than withheld: nobody installs an app, so the
  claims are for its author and not for a consumer.

  **What it cannot do, and it is written into the module.** A publisher writes their own graph, so
  nothing here proves that graph is a truthful reading of the source; `current` proves it matches the
  declaration file SHIPPED, which is a smaller claim than it looks. What makes a certificate earned is
  that a third party can REPRODUCE it — npm provenance attests which commit and which public workflow
  built a tarball, and from there anyone can run this command on that commit and compare. Trust the
  process, not the file.

### Patch Changes

- 1c9c9b8: Every example spells a handler the way the framework accepts it

  A host element's event handler is `on` plus the DOM's own event name, lowercase — `onclick`,
  `oninput`, `onsubmit`. The capitalised form is refused by the types, and the refusal names the
  spelling to use.

  The prose had not followed. Nine docstrings across four packages wrote the capital, and two of
  them are strings a developer reads rather than comments: RMD020's fix text, printed whenever a
  function is built inside `render()`, offered `onClick={this.submit}` as the shape to move to — and
  a reader who copied it got a compile error from the framework that had just told them what to
  write. `link-without-a-destination` named the same spelling in the line it prints beside an `<a>`
  with no `href`.

  Nothing could catch it. A comment is not typechecked, a fix string is not code, and the gate that
  would have refused the spelling — the documentation's own typecheck — skips a one-line example.
  `pnpm check:events` closes that: it reads the event names out of TypeScript's `lib.dom.d.ts`, the
  same declaration the handler types are mapped over, so it cannot fall out of step with what the
  types accept.

  Two lines that assert RMD020 "names the handler" were passing on the fix text rather than on the
  name, and had never checked what they claimed. They read the attribute now.

- e22db98: `Timeout` and `Interval` say whether they are running, and a labelled player is no longer reported

  **`pending` and `done`.** `pending` is true from `start` until the call fires or `stop` clears it;
  `Timeout` also has `done`, whether the call has happened. Both are reactive, so a render that reads
  one is re-rendered when it flips — which is why they are `@state` on the hook rather than a getter
  over the private handle, since a getter would read correctly and never wake the render that read it.

  The state was always there and always `protected`, so a component that wanted to show "Undo" while a
  deadline ran kept its own flag beside the timer and wrote it in three places — `start`, `stop`, and
  the body, and a fourth if the body restarted it. Every one of those is a chance for the flag and the
  timer to disagree with nothing to say so.

  Both false is the third answer a caller needs, without a third field: nothing started yet, or `stop`
  cancelled it before it fired. `Interval` has no `done` — it does not finish, so there would be
  nothing for it to mean. And neither flag costs a hydration byte: nothing arms on the server, so both
  stay at their initializer and the serializer writes only what moved off one.

  **A label silences `media-with-no-captions`.** The rule asked for one in its advice and did not
  accept it in its code: "a song without words needs a label beside the player rather than a track:
  the title, the performer, the length. What is being asked for is not a transcript of every sound, it
  is that the page not be silent ABOUT the sound." Measured on
  `<audio src="/song.mp3" controls aria-label="Chopin, Nocturne op. 9 no. 2, 4:33" />` — reported, with
  advice telling the author to do what they had already done.

  `aria-label` or `aria-labelledby` now silences it, on `<video>` as well. An EMPTY label does not:
  that is a label written and nothing said, the same care the `muted` escape takes about
  `muted={false}`. A label computed at runtime counts, because the direction this rule errs in is
  silence rather than a false report about working markup.

- 093e4ac: The graph hands each declaration over once, and says the honest thing about a library

  Two faults, both found by DRAWING the graph rather than by reading it.

  **A declaration could appear twice.** `@ramonda/router`'s `Link` and `Navigator` were each in the
  graph two times, byte for byte identical: a node reaches the list down more than one path, and the
  two are different objects, so the identity check that skips spliced nodes did not catch them.
  Measured on this repository's documentation app — 168 nodes of which 166 were distinct.

  It matters beyond a tidy file. `--diff` compares graphs BY ID, so one of each pair was invisible to
  it, and anything reading the graph into a map by id silently kept one and dropped the other. Nodes
  are now deduplicated by id AND position, which is what makes it safe: two nodes that genuinely
  collide are two different declarations with different positions, so both still survive — that case
  is deliberate and the graph reports it.

  **`--graph-html` claimed the undecidable about a library.** A library graph has no roots — the
  format says so and says why: _"unreachable and no-provider-above cannot be decided without knowing
  what mounts it"_. Every node therefore landed at no depth, and the page drew all of them under
  "nothing reaches these", asserting exactly what the analyzer refuses to assert. Measured on
  `@ramonda/router`: six nodes, zero roots, six false claims.

  A library is banded by what an app can NAME instead — exported or internal — and the "only what
  nothing reaches" filter is disabled there, with the reason on it.

- 4817cb0: Three rules say which runtime code they answer

  `alsoReportedAs` is how the reference cross-links a static rule to the diagnostic that reports the
  same fault once the line runs. Counted across the framework: **53 runtime codes, 30 already paired,
  23 with no rule at all — and three that had a rule and never said so.**

  - `fresh-object-in-hook-props` answers `RMD022`, which is the same value built twice in a hook's
    props callback.
  - `parent-with-a-foreign-child` and `tag-needs-its-parent` both answer `RMD028` — the same
    misplacement read from either end: a container holding a child its content model forbids, and a
    tag written outside the parent it requires. Declared as a pair, with that reason, because the
    catalogue refuses a second claimant nobody wrote down.

  A reader who meets `RMD028` in a console now finds both halves from the reference instead of
  neither.

- 0212501: Three rules whose one-line summary was the thing a reader judged them by

  The summaries go into the reference table, so they are what somebody reads before ever running the
  rule — and all three were describing something other than what the rule does.

  **`attribute-that-does-nothing`** said "an attribute is written whose name reaches the DOM verbatim
  and that nothing reads", which sounds like it covers every unread attribute. It reports a closed list
  of six camelCase names — `httpEquiv`, `acceptCharset`, `defaultValue`, `defaultChecked`, `innerHTML`,
  `textContent` — and never touches a `data-*`. The summary names them now, and the advice says so
  outright: a `data-*` written for a CSS selector or a test hook is what `data-*` is for.

  **`fresh-object-in-props`** spent most of its summary listing WHERE the object could be built — in the
  attribute, an arm of a ternary, behind a `??`, a local one line up, a helper it calls — which is not
  what a reader needs. What they need is that it is rebuilt every render, and what to do: a field, a
  `@compute`, or `@StableProps` on the child. The summary says that instead; the advice, which was
  already thorough, is unchanged.

  **`media-with-no-captions`** said "so its content exists only as sound", which for a song is not a
  fault, it is the point. It now names what is actually wrong — nothing on the page says what is in it
  — and the advice speaks to music directly: a song with words carries them as `descriptions`, one
  without needs a label beside the player rather than a track. What is asked for is not a transcript of
  every sound, it is that the page not be silent about the sound.

  No rule changed what it reports.

## 0.13.0

### Minor Changes

- c468786: A component owns a range of nodes rather than being one element, and `@Host` is gone with the
  element it named.

  A component's markup is what its `render()` returns, and nothing else. One element, several, or
  none — a component that renders `null` has state, a lifecycle and hooks and no nodes at all. So two
  `<td>` from one component sit inside the `<tr>` where an element would be foster-parented out in
  front of the whole table, and a component that exists only to toggle other components costs the page
  nothing.

  The host element was never for the author. It was the diff's ANCHOR, and it charged for that
  everywhere else: the tag was declared away from the markup, `display: contents` removed the box but
  not the node so `.card > p` could not reach through a component, and a component could not produce
  two siblings. The anchor does not have to be a node — `DiffAndMerge`'s ordering pass never searched
  for one, it builds the target order for a block and walks it backwards — so a component is now a
  third kind of `RecordEntry` beside `ListRegion`, and `isRegion` stays blind to which kind.

  **Removed:** `@Host`, `@onElement`, `ref` on a component, and the `<ramonda-host>` element.
  `RMD010`, `RMD042` and `RMD045` leave with the faults they described, and so does `@ramonda/check`'s
  `listener-on-the-default-host`. Write the element in the render, put the listener and the ref on it,
  and give a custom element a dashed tag — `JSX.IntrinsicElements` now accepts one, because `@Host` did.

  **Server markup carries a comment pair per component**, with its state blob on the opening one:
  `<tr><!--c7 {"state":{…}}--><td>…</td><td>…</td><!--/c7--></tr>`. Served markup is text and nothing in
  plain HTML says where one component's run of nodes ends, so the server says it — in comments, because
  a comment is the only thing the parser leaves alone inside a `<tr>`. Hydration consumes and removes
  them, so a hydrated page holds exactly what a client render would have produced, and a client render
  never writes one. The blob moved with them: it used to be `data-ramonda-state` on the host element.

  **Measured, not asserted.** `RenderCost` counts DOM operations, and a list of 200 component rows costs
  what 200 element rows cost — two insertions to append or prepend, two to swap, `N - 1` to reverse,
  nothing for a fresh array of the same rows. An empty component filling in costs what a plain
  conditional hole costs, so the sibling search it has to do costs no DOM operation. The child record is
  kept per region owner rather than per component, so it does not grow with a list.

  `@ramonda/router`'s `Link` writes its `<a>` in the render, where the href and the click handler that
  has to agree with it sit together. `@ramonda/testing-library`'s `renderHook` finds its host through
  the record, and `@ramonda/core/testing` gains `getComponentsIn` for that — which is also the only way
  to find a component that renders nothing, since no node points at one.

- 694e8de: The tag rules read `<Select>` and `<TextArea>` as the elements they are

  `<select>` and `<textarea>` are refused by core's own types, because neither can be written
  correctly as a tag: a select's choice is decided by the order its options reached it, and a
  textarea's value is its CHILD rather than an attribute. `Select` and `TextArea` settle both — and
  left the checker meeting a COMPONENT where the tag used to be.

  Measured: `<Select aria-hidden="true" httpEquiv="refresh">` with no label at all was reported by ONE
  rule, while the identical faults on an `<input>` beside it were reported by four. Every rule keyed
  on a tag went quiet for the two elements an author now has no other way to write.

  **A table, not a walk.** The obvious answer is to read the component's `render` and see what it
  builds, and it works inside this repository and nowhere else: an application resolves `Select` to
  core's `.d.ts`, a declaration with no body. There is no render to read. A reader built that way
  would pass every fixture here and do nothing for the people the rules are for.

  **Identity is the name core EXPORTS**, through `resolve.coreName` — so core's `Select` under an
  alias is reported and an application's own component of the same name is its own business. That
  reader hangs on the resolver precisely so it reaches everywhere the resolver does, which is why this
  needed no new parameter threaded through the element pipeline.

  `control-with-no-label` needed a second fix and it is the standing lesson again: the element family
  reads its tag through `contextFor`, while the id table walks the JSX itself and asked `tagOf`
  directly — so it decided `<Select>` was not a form control at all. One question, two readers, and
  only one of them had been taught.

- 21cf5a5: New rule: `parent-with-a-foreign-child`

  `<ul><div>…</div></ul>`, `<select><span>…</span></select>`, `<table><div>…</div></table>`. This is
  the **mirror** of `tag-needs-its-parent`, and neither answers the other: that one asks whether a
  child is in the right parent, this asks whether a parent holds the right children. A `<div>` is
  legal almost everywhere, so nothing about it is wrong until you see where it sits.

  **A list is not styling, it is a COUNT.** Assistive technology announces "list, 5 items" and offers
  a way to step through them, working that count out from the `<li>` children. A stray element breaks
  the run: some readers announce the wrong number, some end the list early and start a second one. A
  reader told there are three items where there are seven is worse off than one told nothing, because
  it is confidently wrong.

  `<table>` and `<select>` are stricter again — the parser MOVES a foreign child out of the element,
  so the tree the browser builds is not the tree in the source. Hydration then reports that as
  `RMD007`, a server/client mismatch, and sends the reader looking for a clock or a random number that
  is not there. That is the same trap `tag-needs-its-parent` documents from the other side.

  **Nobody writes this on purpose.** It arrives when a row gets wrapped for layout, or a tooltip is put
  around one, and nothing on screen changes because the CSS was on the row all along.

  Only a tag written OUT and known to be wrong is reported. A component child or an expression may
  render exactly the right tag — `{rows.map(row => <li …/>)}` is how every real list is built — and
  both are left alone. The tags a container takes BESIDE its main one are in the table rather than
  assumed away: a `<table>` with its caption and colgroup, a `<select>` with an `<optgroup>` and an
  `<hr>`, a `<dl>` with the `<div>` wrapper the specification allows in one, a `<picture>` with its
  sources.

- 4a686a3: `--fix --dry-run` answers with its exit code, so a gate can use it

  It is the shape `biome format --check` and every tool like it uses: nothing is written, and the exit
  code says whether anything would be. `1` means there is a fault here whose answer this package
  already knows.

  That is what makes `--fix` usable in a gate, and the repository now runs it as its own step. A
  warning is a judgement somebody may reasonably defer, which is why a normal run exits `0` on one. A
  warning with a MECHANICAL answer is not that — there is no version of "later" that improves
  `class` instead of `className`.

  The step is separate rather than folded into the existing run, and it stops rather than falling
  through to the report: one question, one answer. A step that also printed every unrelated warning
  would be read as the whole check, and it is not.

  Proved against the project the gate actually checks, rather than a fixture: planting one `class` in
  `apps/docs` made the step exit `1` and name the file, `--fix` returned that file byte-identical to
  what it was, and the step went back to `0`. Its exit codes are pinned by a test that runs the built
  CLI as a process, because a gate step that silently stopped failing would be worse than no step.

- b48d042: `function-built-in-the-markup` — a function literal written into a JSX attribute

  `RMD020` has reported this at runtime for a long time, as its `handler` verdict: a development
  build renders every component twice in one tick, and a function built in place comes back with the
  same source and a fresh identity. Nothing said it before the code ran, so the docs shipped a
  `reference/api.md` row demonstrating the very pattern the framework reports, and the gate was green
  over it.

  **Measured on the element, not argued.** `<button onclick={() => this.n} />` under a component
  whose state changes makes **3 `addEventListener` and 3 `removeEventListener` calls over three
  re-renders** — one pair per render, which is exactly the churn the runtime's message names.

  **It agrees with the runtime rather than having its own opinion.** With `strictRender` on,
  `<AsyncLoad lazy={() => import(…)} errorFallback={({ retry }) => …} />` makes `RMD020` name
  `AsyncLoad.lazy` and `AsyncLoad.errorFallback` — the same two props, at the same sites, this rule
  reports.

  **It fires on a host element, where `fresh-object-in-props` does not.** Its sibling asks whether a
  CHILD can skip a render, so a host hands nothing to a component and is left alone. A listener is
  attached to a real node, and `<button onclick={() => …}>` is the commonest spelling of this fault —
  a rule silent on host elements would be silent on nearly all of it.

  **A CALL is never followed, and that is the rule's most important silence.**
  `onclick={this.pickRow(row)}` is the recommended answer: `@memoized` caches by its arguments per
  instance. `onclick={debounce(this.save, 200)}` has nowhere else to live. Following either would find
  the arrow inside and report the fix — the same trap `arrow-fields` is pinned against one level in.
  Also silent: a bound method, a field holding an arrow (that is one identity per INSTANCE, and
  `arrow-fields` reports it where it is written), a property read, a prop, a module const in this file
  or an imported one, `key` and `ref`, and a prop the child declared with `@StableProps`.

  **The spread boundary was written down backwards first, and measuring settled it.** The reading that
  what the author WROTE stands whichever side of a spread it is on is true of a misspelling and not of
  this. Measured both halves: `<button onclick={written} {...{ onclick: fromSpread }} />` clicked runs
  ONLY the spread's handler, and `{...{ onclick: undefined }}` after it runs NEITHER. A listener that
  never reaches the element cannot be removed and re-added, so only an attribute after the LAST spread
  is reported.

  Both spellings of an event name are read through the shared `eventTypeOf`, so `on:my-event` is a
  handler exactly as `onclick` is.

  A warning: the page is right either way, and what it costs is work. The first thing it found was one
  in this repo — `apps/docs`'s `DocPage` built its `errorFallback` in the markup, and it is a bound
  method now.

- 6860818: New rule: `label-that-names-nothing`, and one walk where there were three

  A `<label>` is an association, not styled text, and HTML gives it exactly two ways to make one:
  `htmlFor` naming a control's id, or a control written inside it. With neither, the element renders,
  looks completely right, and does nothing.

  Two things are lost. The control it was meant for has no accessible name — which is
  `control-with-no-label`'s report at the other end of the same missing pair — and **clicking the text
  no longer focuses the field**, which is the affordance everybody uses without thinking about it, and
  which is hardest on the people with the least room to absorb it: a large click target is the
  difference between a usable form and an unusable one for somebody with a tremor.

  It is worth having separately from the control's end because the two ends are written in different
  files by different people. A form component owns the control; a design system owns the label.

  Silent on an `htmlFor` written at all — whether it points at a real id is
  `reference-to-an-id-that-is-not-there`'s question, and two reports on one line is how a reader
  learns to skim past both — on a control this cannot SEE (`<label>Name<TextField /></label>` is the
  ordinary way a form is written), on anything in an expression, and on an element that spreads.

  **And one walk where there were three.** `click-with-no-keyboard-path`, `media-with-no-captions` and
  now this one all ask "is the thing I am looking for inside here, and if not, could a component or an
  expression be hiding it" — the questions differ and the walk does not. It took a third caller before
  anybody noticed the first two were the same shape, which is this package's standing lesson arriving
  on time for once. `descendantIn` answers all three, with three outcomes rather than two: `found`,
  `unreadable`, `none`. Every caller treats the first two alike, and they are kept apart because they
  are different facts.

  Verified behaviour-free: no finding changed anywhere in the fixtures when the two existing rules
  moved onto the shared walk.

- 39c7d39: New rule: `live-region-that-contradicts-its-role`

  `role="alert"` and `role="status"` are live regions with a politeness built in: an alert is
  `assertive` and interrupts whatever the reader is being told, a status is `polite` and waits for a
  gap. An explicit `aria-live` beside either **replaces** that — and there are only two values it can
  take, so writing one is always either redundant or a reversal.

  **An alert made polite waits.** A validation error, a failed save, a session about to expire —
  announced when the reader happens to pause, which on a form being filled in may be minutes later or
  never. The author picked `alert` precisely because the message could not wait, and then made it
  wait.

  **A status made assertive interrupts.** A live result count cutting across every keystroke, and the
  usual outcome is that the reader turns the page's announcements off entirely — which takes the real
  messages with them.

  Nobody writes `role="alert" aria-live="polite"` meaning both. It arrives when `aria-live` is added
  "to be safe" beside a role that already had it, or when a shared component takes a politeness prop
  that the alert case forgot to override. Either way the source says two things and the reader hears
  one.

  **Agreement is untidy and is not reported.** `role="alert" aria-live="assertive"` says one thing
  twice; this package reports faults rather than habits. `aria-live="off"` is a stronger claim than a
  politeness — it says the region is not live at all — and belongs to whoever wrote it. A politeness
  this cannot read, a role that is not a live region, and a spread that may replace either half are
  all silent.

  `log` and `timer` are covered with `alert` and `status`, for completeness rather than because
  anybody has been caught by them.

- 5810dac: `dom-writes` sees a destructured document, and `unserializable-state` reads a type annotation

  Two class rules nobody had planted a shape for. One gap each, and both were a spelling one rule
  knew and its neighbour did not.

  **`dom-writes` was silent on `const { body } = document`.** `body.style.overflow = "hidden"` bottoms
  out at an identifier, so the walk found no `document` and said nothing — one class below the dotted
  form it reported. The checklist asks for a destructure to be planted whenever a rule matches a
  global, and this one had never had one planted. It follows a `const` a few hops now, in this file
  only, which is the same bound `late-request-read` takes a local under.

  **`unserializable-state` read only the initializer.** A field with none says what it holds in its
  type ANNOTATION — read as SYNTAX, `Map<string, T>` being the name `Map` written in the file, never
  as a question to the checker. `persist-of-a-lossy-value` read it and this one did not, which is the
  same question about the same hydration blob answered two ways. The shape is not exotic:
  `@state rows!: Map<string, number>` assigned in `@created` is how a value arriving from a fetch is
  written.

  The reader moved to `lossyValue.ts` as `lossyFieldValue`, so the two rules cannot drift again. A
  field carrying BOTH decorators is still the ungated rule's alone — one line, one report.

- b3c2b84: A name written and left EMPTY names nothing, in every rule that asks

  `aria-label=""`, `aria-labelledby=""` and `title=""` give the accessibility tree no name at all —
  the attribute is there and the element is still anonymous. Four rules read them by PRESENCE alone,
  so an author who wrote a name and left it blank was treated as having named the thing:
  `unnamed-image`, `unnamed-frame`, `empty-heading-or-link` and
  `landmarks-that-cannot-be-told-apart`.

  **The id table had already worked this out and kept it to itself.** Its own note records the
  measurement — `<input aria-labelledby="" />` had no name and was reported by nothing, "because the
  attribute that names nothing had answered for the one that would have" — and it fixed its own
  reader while four rules beside it went on asking the old way.

  That is this package's standing fault, and it was five copies deep: the same three attribute names
  written out five times, three of them under the same identifier and two character for character.
  There is one list and one reader now, in `naming.ts`.

  **`alt` is deliberately not in it.** It names an image and only an image, and it is the one naming
  attribute where empty is a STATEMENT rather than an omission: `<img alt="">` is the documented way
  to say "decoration, skip me". `unnamed-image` passes it in separately and it is still asked by
  presence, so a decorative image stays silent.

- 6af8c9c: New rule: `more-than-one-main`

  HTML allows one `main` element that is not hidden, and it is the only landmark with that constraint.
  It has it because `main` is a **destination** rather than a description: "skip to main content" is
  the first thing a keyboard reader presses on a page, and a screen reader's landmark list is how
  somebody moves around one without scrolling through it.

  With two, that destination is ambiguous and tools resolve it differently — some jump to the first,
  some list both under the same name — and whichever the reader picks, half the page is now somewhere
  they have to find by hand. It looks completely correct to anybody using a mouse.

  `<div role="main">` counts, because the accessibility tree does not care which spelling was used.
  That is the shape it is most often written in: a layout component owning a `<main>` and a page
  component adding a `role` to its own wrapper, neither author seeing the other's.

  **One RENDER, not one project.** Two route views may each own a `main` and are never on the page
  together; reporting that would be reporting the ordinary way a routed application is written. The
  bound is `duplicate-id`'s, and `ProjectRule`'s own note names this exact case as the reason the
  project subject may claim only negative existence.

  Only the SECOND is reported — the first is the one a reader almost certainly meant, and the report
  names its line so the two can be compared without hunting.

  Silent on one landmark per arm of a ternary (that is one on the page, which is what `alwaysPresent`
  is computed for), on `hidden` — the specification's own escape — on an element that spreads, since
  the spread may be carrying that `hidden`, and on a `role` it cannot read. `hidden={false}` is the
  source saying out loud that the element is shown, and excuses nothing.

- 5cc085f: New rule: `half-built-keyboard-path` — the rule an existing one asked for by name

  `click-with-no-keyboard-path` reports a click on a plain element with no `role`, no `tabIndex` and
  no key handler. It goes quiet the moment any of those appears, and its own comment says why: _"A
  half-built path is somebody's decision to build it by hand, and picking at it is a different rule
  from this one."_ That rule did not exist, so the half-built path was reported by nobody.

  `<div role="button" onclick={save}>` is somebody taking on work the platform does for a `<button>`.
  The role is the announcement — a screen reader now says "button" — and the rest has to be written
  out. Two ways it stops short, and they fail differently:

  - **No `tabIndex`.** A reader is told there is a button and cannot get to it at all. The mouse
    works, so it looks finished to whoever wrote it.
  - **`tabIndex` and no key handler.** Tab lands on it, the reader presses Enter, and nothing happens
    — worse than not reaching it, because they were told it is a button and given every reason to
    believe they used it correctly.

  The two rules enter on the same condition — a pointer handler on an element that is not natively
  interactive — and split on whether the author had started. `INTERACTIVE` and the two event readers
  are shared between them, because two rules dividing one territory have to agree about where the
  territory begins.

  A pointer handler is required, which is what makes the report certain rather than a guess about
  intent: `<div role="button">` with nothing wired to it may have its handler attached through a ref.
  Silent on a role it cannot read, on a role chain, on a role that is not a widget, on a real control
  inside, and on a spread that may be carrying either missing half.

  `ACTIVATED_BY_THE_USER` in `aria.ts` leans SHORT, which is the opposite of `ROLES` beside it: a rule
  reads this one to report an element whose role IS in it, so an entry too many reports markup that
  never needed a keyboard path.

  **Two silences the review measured into it**, because the first version reported the W3C's own
  authoring patterns. A `listbox` takes the arrow keys and its options carry a roving `tabIndex={-1}`;
  a `toolbar` and a `tablist` do the same. Read as elements on their own, every child there is a click
  with no key handler — the canonical three produced FOUR reports against markup that is the
  recommendation.

  So the roles OWNED by a composite parent — `option`, `tab`, `menuitem`, `treeitem`, `radio` and the
  two menu checkbox roles — came out of the table, leaving the ones a user operates on their own. And
  a key handler on any ancestor in the render counts as the keys being handled, which is what covers a
  `role="button"` inside a toolbar.

- b3c2b84: New rule: `region-with-no-name` — a landmark declared and never exposed

  `region` is the one landmark role the specification makes conditional on a name. WAI-ARIA is
  explicit — _authors MUST give each element with role `region` a brief label_ — and an unnamed one
  is not put in the landmark list at all. The element is a generic box, exactly as it would have been
  with no `role` typed on it.

  That is an intention that failed rather than markup that misleads, and it is invisible: nothing on
  the page looks wrong, nothing ever will, and the attribute the author wrote does nothing.

  **A bare `<section>` is NOT this report.** `<section>` maps to `region` only when it has a name and
  to `generic` when it does not — the mapping working as designed. Reporting it would report ordinary
  correct markup on nearly every page ever written. The line is the WRITTEN role: typing
  `role="region"` is asking for a landmark.

  Silent on a role it cannot read, on a role chain whose winner is not a question about this element,
  on a name it cannot read (somebody naming it), and on a spread that may be carrying the name.

  **`landmarks-that-cannot-be-told-apart` gives `region` up.** It fires only when NEITHER of two
  landmarks of a kind is named — which for `region` is exactly the case where neither IS a landmark.
  Measured on a plant: both rules named the same two lines, and only one of them was saying something
  true. One fault, one report.

- 72ab1a6: New rule: `role-that-fights-the-tag`

  `<a href="/pricing" role="button">` and `<button role="link">` are opposite halves of one mistake:
  the element **keeps its behaviour** and changes only what is announced about it. So the reader is
  told what to expect and the element does something else.

  **A link announced as a button** loses Space. A button activates on Space as well as Enter, and a
  reader who has been told "button" will press it — on a link that is the browser's scroll shortcut,
  so the page jumps down and nothing else happens. It also leaves the list of LINKS a screen reader
  offers, which is how somebody surveys what a page connects to.

  **A button announced as a link** gains an expectation of a destination: a URL in the status bar, a
  middle click that opens a tab, "copy link address" in the context menu. None of those exist, and
  none of them fail loudly — the menu item is simply absent or copies nothing.

  Both are invisible to anybody using a mouse, and both survive review because the page behaves
  exactly as intended for the person testing it.

  The answer is never the role. The element carries the behaviour and the role only describes it, so
  writing one that disagrees cannot bring the behaviour with it.

  **An anchor with no real destination is not this**, and that boundary is the rule's own: `<a
role="button">` and `<a href="#" role="button">` are somebody building a button out of an anchor —
  `link-without-a-destination`'s conversation, not this one. An `href` this cannot READ goes quiet
  with them, and that was a correction: the first draft reported it, on the argument that writing
  `href={where}` means the author has a destination. Planted, it does not hold — `where` may perfectly
  well be `"#"` — and the silence contract wins, as it does everywhere else here.

- b7201ca: New rule: `presentation-role-on-focusable`

  `role="presentation"` — and its synonym `none` — says the element is scaffolding: expose what is
  inside it, not it. ARIA resolves the conflict when that cannot hold, and **a focusable element is
  the case**: it keeps its implicit role and the presentational one is dropped. So the author asked
  for the element to leave the accessibility tree and it did not, with nothing at build time and
  nothing at runtime to say so.

  What a reader gets is the shape the author was trying to avoid — they tab onto something announced
  as a button, a link or a text box that was meant to be invisible scaffolding. Which of the two the
  author wanted, the element gone or the element focusable, is not a question this can answer, and the
  report says so rather than guessing.

  Written from the spec's presentational role conflict resolution, and it shares `focusableByTag`
  with `aria-hidden-on-focusable`, its sibling claim about the same element — the two have to agree
  about what "focusable" means or the same `<summary>` is focusable to one and not the other.

  **The boundary is drawn where the spec stops being uncontested.** That resolution has a second half
  — a global `aria-*` on the same element also drops the role — and it is deliberately not reported.
  `<div role="presentation" aria-label="…">` is written on purpose often enough that reporting it
  would be reporting a tradeoff rather than a fault, and one member of that set makes it plainly
  wrong: `aria-hidden="true"` takes the element out of the tree anyway.

  A warning, matching the sibling: the page is not broken, the element keeps its default semantics,
  and this is an intention that failed rather than markup that misleads.

  Takes the family's spread guards: silent when
  a spread could replace the role, and silent on a tag-focusable element that spreads at all, since
  the spread may be carrying the `tabIndex={-1}` that settles it.

  Also cleans five imports the branch's own refactors left unused — `ts` in `aria-with-no-subject`,
  `unknown-aria-attribute` and `attribute-that-does-nothing`, `RuleContext` in
  `persist-of-a-lossy-value`, and three element readers in `aria-hidden-on-focusable`. Found by the
  gate's linter, which the earlier sweep had only been pointed at the files it already knew about.

- c07afff: Three accessibility rules now report past a spread, because a spread cannot un-write a name

  The element family goes quiet on `<img {...rest} />` for a good reason: the spread may CARRY the
  `alt` the rule is about, and nothing static can say whether it does. That argument is about an
  attribute that is ABSENT, and it was being applied to three rules about attributes that are
  plainly written down.

  - `unknown-aria-attribute` reads a NAME. `<div {...rest} aria-lablled="Filters" />` is misspelled
    on the tag, and no object spread on either side of it can take a name off.
  - `aria-with-no-subject` reads a name on a fixed set of TAGS. A spread cannot turn a `<meta>` into
    something a screen reader exposes.
  - `unknown-role` reads a VALUE, so it takes the guard itself and reports only from the side a
    spread cannot reach over: `<div {...rest} role="buton" />` ends up with `buton` because the last
    attribute wins, while `<div role="buton" {...rest} />` may end up with whatever `rest` carries
    and is left alone.

  `ElementContext` grows `overwritable(name)` for the third of those — whether a spread is written
  after the attribute — so the order question is answered once rather than per rule.

  Ten more rules were then asked the same question, and seven of them were silent for the same
  reason: `class-instead-of-classname` and `tag-needs-its-parent` (which read a written name and a
  tag, and report on either side of a spread), and `positive-tabindex`, `access-key`, `aria-value`,
  `aria-hidden-on-focusable` and `role-takes-no-name` (which read what the element will BE, and
  report only from the side a spread cannot reach over).

  The line between the two is NOT name-versus-value, which is what it looked like at first. Measured
  through `renderToString`: `<span aria-hidden="true" {...{"aria-hidden": undefined}} />` renders
  `<span></span>` — a later spread carrying `undefined` really does remove an attribute. What decides
  it is what the rule is about. A misspelling is in the source whether or not the browser sees it; a
  claim about the rendered element is not.

  Two rules also had to give up a report a spread could ADD its way out of: `<button aria-hidden>`
  with no `tabIndex` written, and a role taken from the TAG, are both settled by an attribute that
  is not there — and a spread on either side may be carrying it.

  Measured on the six real projects in this repository: no new findings. The silence the guard
  exists for is unchanged — `<img {...rest} />` still reports nothing.

- c6acda6: New rule: `aria-state-the-role-does-not-have`

  `<div role="button" aria-checked={on}>` is the shape. ARIA defines every non-global state as
  belonging to particular roles and exposes it only there — `aria-checked` belongs to `checkbox`,
  `radio`, `switch` and their kin, and a `button` is none of them. The attribute lands in the DOM,
  updates as the state changes, and is announced by nobody.

  The author is usually one word from correct, which is what makes it worth reporting: they built a
  toggle, reached for `role="button"` because that is what it looks like, and wired up the state that
  would have worked on `role="switch"`.

  **This is the other half of `aria-state-with-no-role`.** That one asks about an element with NO role
  and is certain because a `<div>` has none; this one asks about a role that is WRITTEN and is certain
  because the role is right there in the source. Between them they need no table of implicit roles for
  HTML at all — which is the reason both could ship.

  ## The data is attribute-first, and that is the safety argument

  The specification documents this twice: each role lists the states it supports, and each state lists
  the roles it is used in and inherits into. Reading it **role-first** means getting inheritance right
  for every role in ARIA — `checkbox` from `input` from `widget` — and a superclass property missed
  anywhere is a report against correct markup. Reading it **attribute-first**, the inheritance is
  already flattened into one short list per attribute, each checkable by eye.

  The fixture proves it where it matters: `role="treeitem"` takes `aria-checked`, `aria-level` and
  `aria-selected` from three different places in the role hierarchy, and `columnheader` takes
  `aria-sort` and `aria-colindex` from two. All five are silent.

  **Partial on purpose.** Only attributes whose role set is small, famous and stable are carried;
  `aria-orientation`, `aria-readonly`, `aria-required` and `aria-activedescendant` are not, because
  their sets are long and their inheritance is fiddly. And every doubt inside a list is resolved by
  INCLUDING the role: an extra one costs a missed report, a missing one costs a false report, and
  those are not the same price.

  Silent on an unknown role (`unknown-role`'s report), on a role it cannot read, on a fallback chain,
  on global attributes, on an attribute not in the table, and on a spread that may replace either
  half.

  Measured over all nine real projects here: no findings.

- be53712: New rule: `aria-state-with-no-role`

  ARIA divides its attributes in two. A GLOBAL one — `aria-label`, `aria-hidden`, `aria-describedby`
  — is exposed on any element in the accessibility tree. Every other one is defined BY a role and is
  exposed only where that role supports it: `aria-expanded` belongs to `button`, `combobox` and a
  handful more; `aria-checked` to `checkbox`, `radio`, `switch`, `option`; `aria-selected` to
  `option`, `row`, `tab`.

  Written on a bare `<div>`, none of them says anything at all. There is no role for the state to be a
  state OF, so assistive technology has nothing to announce. `<div aria-expanded={open}>` beside a
  custom dropdown is the commonest shape of it — the author wired the value up correctly and it
  reaches nobody.

  The fault is invisible in every way a fault can be: the markup is valid, the attribute lands in the
  DOM and shows in the inspector, the value updates as the state changes, and nothing anywhere
  reports it.

  **Narrower than the spec, deliberately.** The full question — does this element's role support this
  attribute — needs a role for every tag in HTML and a supported-properties list for every role in
  ARIA. Both are large, both are easy to get subtly wrong, and being wrong here means reporting
  correct markup. So it asks the half that is CERTAIN: a `<div>` or a `<span>` has no implicit role,
  and with no `role` written either the element has none, full stop. No table of roles is consulted
  because none is needed, and the other half is left to a later rule that can afford the data — where
  a silence costs a missed report rather than a false one.

  Silent on a `role` it cannot read, on a tag with an implicit role of its own, on a misspelling
  (which is `unknown-aria-attribute`'s report and gets one, not two), and on an element that spreads,
  since the spread may be carrying the role.

  `aria.ts` gains the specification's global list and the two tags certain to have no implicit role.

- 4a389cb: New rule: `table-with-no-headers`

  A table is read visually by POSITION: the eye follows a column up to its heading and back down, and
  that costs nothing. A screen reader cannot do that. It announces cells one at a time, and the header
  association is the only thing that lets it say "Price, £4.50" instead of "£4.50", read out of a grid
  the reader can see nothing of.

  With no `<th>` anywhere there is no association to make, so every cell is announced bare. Past three
  or four columns the table is not merely harder to read — it is unusable, because nothing says which
  column any value came from.

  It is also the most invisible fault in this package: `<td>` and `<th>` are one letter apart, they
  are styled by the same CSS often enough that the table looks identical either way, and nothing at
  runtime says a word.

  **A LAYOUT table says so and is never reported.** `role="presentation"` and `role="none"` are
  exactly how an author declares that a table is not data, and the accessibility tree honours it —
  reporting one would be reporting the documented way of writing the thing this rule does not care
  about.

  **And the silence is deliberately large.** A table whose rows come from `{rows.map(…)}` or from a
  component may have its headers in there, and that is how most real tables are built — so
  `unreadable` and `found` are one answer. A rule that guessed would report the commonest correct
  table there is. A table with no rows at all, or holding only a `<caption>`, is scaffolding rather
  than data and is left alone too.

- 18ce6ac: New rule: `autocomplete-that-fills-nothing`

  A browser matches `autocomplete` against the HTML specification's list of autofill field names and
  against nothing else. A token that is not on it is **not a near miss the browser corrects** — the
  whole value is ignored and the field never fills. `autocomplete="fullname"` looks exactly as
  deliberate as `autocomplete="name"` and does exactly nothing.

  It fails in the quietest way an attribute can: the markup is valid, the attribute is in the DOM,
  nothing is logged, and the only symptom is a form that does not fill — which reads as the browser
  being unhelpful rather than as a typo in the source.

  **Who it is for, because it is not only a convenience.** Filling an address by hand costs a person
  with a motor impairment real effort and real errors; somebody using voice control may have no other
  way to enter a long string accurately; and anybody on a phone is retyping a card number they have
  already given a browser once. It is also WCAG's _Identify Input Purpose_, which asks for exactly
  this vocabulary and no other.

  `shipping`, `billing`, `home`, `work`, `mobile`, `fax` and `pager` say WHICH address or number and
  are not fields on their own. A value that is only one of those gets its own sentence in the report,
  because naming a group and no field is the commonest near miss and reads as complete.

  **The ordering is deliberately not policed.** The grammar is an optional `section-*`, an optional
  group word, an optional contact word, the field name, and an optional trailing `webauthn`. This asks
  the part that is unambiguous — is there a field name at all — and says nothing about the order in
  front of it, because being wrong about those rules would mean reporting a value that fills perfectly
  well. `section-blue billing cc-number` and `username webauthn` are both silent.

  Silent on a value it cannot read, on an empty one, on `on`/`off`, on a `<div>` (which no browser
  fills), and on a spread that may replace the attribute.

- dc494bd: An id written out on a spreading element is an id

  The project family — `fragment-link-to-nowhere`, `reference-to-an-id-that-is-not-there`,
  `control-with-no-label`, `named-only-by-a-placeholder` — reports an ABSENCE: "nothing in this
  project carries this id". The table it reads used to skip any element that spread anything at all,
  **including an `id` spelled out on the very same tag**. An id missing from that table is a report
  against correct markup, and this is the family where that is worst.

  Measured on a plant: `<h2 {...rest} id="pricing">` with `<a href="#pricing">` beside it, and the
  link was reported as going nowhere. So was `<label htmlFor="email">` whose
  `<input {...rest} id="email">` was one line below it. Three of four references reported, every one
  pointing at an id written a line above.

  Both orders are now recorded, and that is the OPPOSITE asymmetry to the one the element rules take.
  There, widening what is reported can only add false reports, so an attribute a spread could reach
  over has to be given up. Here, widening the set of known ids can only PREVENT a report — which is
  the same sentence that already keeps a literal `id` written on a component tag.

  The half of the old stance that was right is unchanged, and pinned: a spreading element is still
  never asked about its own REFERENCES, is still not judged for its own NAME, and an unreadable `id`
  on one still does not silence the family.

  Everything else this family was walked through came back clean: an id and a reference each one hop
  from where the rule looks both resolve, and a `<label>` on a base class answers for a control in a
  subclass.

- ef2bd61: `unnamed-image` now covers an image declared by its ROLE

  `<svg role="img" />` and `<div role="img" />` are announced as images and have no `alt` to fall back
  on — the attribute does not exist on those tags — so `aria-label` is the only way to name one.
  Measured on a sweep: both were reported by nothing, while the `<object>` and `<area>` beside them
  were reported by this same rule.

  It is how an inline icon is written whenever the icon MEANS something rather than decorating, which
  is exactly when it needs a name.

  Every existing way of naming one still answers, a name this cannot read still counts as somebody
  naming it, and an `<svg>` with no role is not declared to be anything — the rule asks what the
  source SAYS the element is, and answers nothing where it says nothing.

  ## Measured and deliberately NOT built: a role outside its required context

  The same sweep found `role="option"` outside a `listbox`, `role="tab"` outside a `tablist`, and
  `role="listitem"` outside a `list` — the ARIA counterpart of `tag-needs-its-parent`, which reports
  the tag version of exactly that fault.

  It is not provable here, and the reason is worth writing down rather than rediscovering. The
  required context may come from an ancestor's written `role`, from an ancestor TAG's implicit role
  (`<ul>` is a `list`), or **from outside the render entirely** — a `<div role="tab">` inside a
  `<Tabs>` component whose own markup supplies the `tablist`. The walk stops at that component
  boundary, and a render's own root is itself inside whatever mounted it. So "no ancestor provides the
  context" is a claim this analyzer cannot make, and a rule that made it would report the ordinary way
  a tab strip is built.

  It belongs with the full role-to-properties table as work that needs data this cannot yet afford,
  where a silence costs a missed report rather than a false one.

- ac0aca8: New rule: `aria-that-contradicts-the-tag`

  `<input required aria-required="false">`. `<button disabled aria-disabled="false">`. The HTML
  attribute is doing its job — the form will refuse to submit, the button will not take a click — and
  the ARIA one **overrides what a screen reader is told about it**. The reader hears that the field is
  optional and then cannot submit, or that the button is available and then nothing happens when they
  press it.

  It is worse than either half missing. A control with nothing said about it leaves a reader to find
  out by trying; a control that says the opposite of what it does sends them looking for a fault
  somewhere else on the page. Somebody told a required field is optional does not go back to it — they
  go hunting through the rest of the form.

  Nobody sets out to contradict themselves. It arrives when ARIA is added "to be safe" beside markup
  that already said the same thing and the value lands on the wrong side of a condition, or when
  `required` is added later to a field whose `aria-required="false"` nobody re-read. Both leave a page
  that works perfectly for anybody using a mouse.

  Six pairs, from the HTML accessibility mappings — the ones where the HTML attribute is a plain
  boolean and its ARIA counterpart a boolean token: `required`, `disabled`, `checked`, `readonly`,
  `hidden` and `open`.

  **Agreement is untidy and is not reported.** `aria-required="true"` beside `required` says one thing
  twice; this package reports faults rather than habits. And anything the source does not settle on
  both halves is left alone — `disabled={busy} aria-disabled={busy}` is the correct way to write a
  pair that moves, and is exactly what a rule that guessed would report.

  Found by planting a broad sweep of markup and reading which lines nobody spoke about — the third
  finding from that method, after the empty `<button>` and the empty naming attribute.

- 63fdf14: A one-sided global asked about before it is touched is not a fault

  `process` does not exist in a browser, so isomorphic code checks first — and checking is the
  CORRECT way to write it. `server-env-in-shared-code`, which is an **error**, reported five shapes
  that cannot crash:

  ```tsx
  typeof process !== "undefined" ? process.env.REGION : ""; // reported
  typeof process !== "undefined" && process.env.REGION; // reported
  if (import.meta.env.SSR) return <p>{process.env.DB_URL}</p>; // reported
  if (typeof window === "undefined") return <p>{process.env.DB_URL}</p>; // reported
  if (typeof process === "undefined") return null; // and everything after it
  ```

  The last two are the most standard ways anybody writes this, and the early return is how a
  `render()` is written far more often than a nested `if`. A build failing against working code is
  the one thing this package cannot afford.

  `side-guard.ts` answers it once for everyone — `narrowedTo(node, "server" | "client")`, built
  alongside `insideADevGuard` and taking the same three climbing shapes plus their inverted forms,
  plus the early return that a dev guard never needs. `typeof` on an undeclared identifier is the one
  expression in the language that cannot throw, so the test is by NAME and that is right rather than
  lazy: a reader writing it is asking about the global whatever else is in scope.

  `client-only-request-read` was found to need the same answer. A request read narrowed to the server
  inside a click listener never runs, so "the browser reads a value it does not have" is untrue and
  the report goes.

  `browser-url` and `dom-writes` were asked and deliberately left alone: neither is about a crash.
  `browser-url` is about a snapshot that never updates, and a guard does not make it reactive.

  The rest of the family came back clean — a subclass is not reported a second time for a base's
  shared member, and it inherits the base's `{ env: "server" }` marking.

- b492d9c: `unguarded-async-lifecycle` asks both of its questions properly

  The rule asks WHICH decorator a member carries and WHETHER its awaits are caught. Both were
  answered by matching text, and measured on a plant both were wrong — five real faults reported by
  nothing.

  **Identity.** The decorator was compared as a bare name, so `import { created as onCreate }` and
  `@core.created()` both went quiet on the identical fault, and an app's own function called
  `created` would have been judged as the framework's. It now reads through `lifecycle-env`'s own
  `coreDecorators`, so the two rules cannot answer one question about one decorator two different
  ways. The NAMESPACE form was missing there too, and fixing it in the shared reader fixed it for
  both.

  **The guard.** It was satisfied by any `try` anywhere in the method, or by any property called
  `catch`. Four faults hid behind that:

  - a `try` around something else entirely, with the fetch below it bare;
  - `await a().catch(…)` followed by a second, unhandled `await`;
  - `try { await … } finally { … }` — a `finally` runs on the way PAST a rejection and does not stop
    one;
  - an await inside a `catch` clause, which its own `try` does not protect.

  The question is about the AWAITS, so it is asked of each one: an await is handled when it sits in
  the TRY BLOCK of a `try` that has a `catch`, or when what it awaits ends in `.catch(…)`. One
  unhandled await is the report, because one is all it takes. A nested function is its own timeline,
  the same line `late-request-read` draws.

  `async-render` was walked and left alone. `render() { return aPromise; }` is the same crash, and
  reading it needs the RETURN TYPE of a call — the dataflow this analyzer refuses, and the type
  system refuses that spelling exactly as hard as it refuses `async render()`.

- 5ba5d6b: A route table is followed to the outlet that takes it, however either one was written

  `<RouteOutlet routes={routes} />` with both names written out was the only arrangement the
  analyzer could read. Five shapes beside it were measured on a planted fixture, and every one of
  them was a report against correct code:

  - the table held on a FIELD — `<RouteOutlet routes={this.table} />`
  - the table taken through a LOCAL a line up
  - the table handed over inside a SPREAD — `<RouteOutlet {...props} />`, long form and shorthand
  - the outlet renamed — `import { RouteOutlet as Outlet }`, or
    `const { RouteOutlet: Outlet } = createRouter(routes)`, which is what a typed kit looks like
  - `createRoutes` renamed — `import { createRoutes as makeRoutes }`

  In each of them the tag named no table, so the table looked handed to no outlet at all: three
  false `unmounted` reports on one fixture, and four pages reported dead beside them.

  A declaration is now followed to its initialiser, which answers the field, the local and the
  object property with one walk, and a binding is matched by the name at its SOURCE — the import
  specifier's or the binding element's `propertyName` — rather than the one the file gave it. Name
  and not module on purpose: a router kit is a SHAPE, so a third-party `createRouter` returning a
  `RouteOutlet` is a real one, and a module test would refuse it.

  A spread nothing can read now silences the whole check rather than guessing. `{...someCall()}`
  may be handing over the very table about to be reported, and a checker that cannot tell a missing
  outlet from an invisible one may not report either.

  Measured: `apps/docs`, 155 components, 1.29 s before and 1.36 s after — the alias question is
  asked of every tag. Skipping the lowercase host tags was tried and came back 1.36 s, unchanged, so
  it is not in the code.

- 7a22b15: New rule: `false-on-a-boolean-attribute` — the word that turns it on

  A boolean attribute is true whenever it is PRESENT. The parser never reads the value, so
  `disabled="false"` puts `disabled` in the document and the control cannot be used — the opposite of
  what the line says, and of what whoever wrote it meant.

  The fix is the boolean itself: `disabled={false}` removes the attribute, and removing it is the only
  way HTML has of turning one off.

  **The static twin of RMD029.** `@ramonda/core` reports this while it runs, and only for markup that
  renders; this is the same fault found in a branch nobody has opened. Both read
  `BOOLEAN_ATTRIBUTES` from `@ramonda/dom-facts` — put there so a second copy would not be made — so
  they cannot come to disagree about which names are boolean.

  Three spellings reach the element identically and all three are reported: written out, written in
  braces, and held one NAME away in a `const`. Silent on the fix (`disabled={false}` and
  `required={condition}` both remove the attribute), on `"true"`, on a spread that may replace the
  value, and on the two kinds of attribute this is NOT about — an `aria-*` is an enumerated string
  where `"false"` is a real value, and a `data-*` is data something reads back.

- 8db365c: New rule: `aria-hidden-around-something-focusable`

  `aria-hidden` takes a subtree out of the accessibility tree. It does **not** take it out of the tab
  order — nothing about it touches focus — so a `<button>` inside stays tabbable while ceasing to
  exist for the software that would announce it.

  What that does to a reader is worse than either half alone. They press Tab, focus moves, and their
  screen reader says **nothing at all**: there is no node left for it to describe. Focus is somewhere,
  the page has changed under them, and they have no way to find out where they are or what pressing
  Enter would do. It is the one accessibility fault that leaves somebody genuinely stranded rather
  than merely underserved.

  The commonest way to write it is a modal: the dialog opens, the page behind it is hidden from
  assistive technology with one attribute, and every control back there is still in the tab order — so
  the first Tab takes the reader out of the dialog and into a void.

  This is the sibling of `aria-hidden-on-focusable`, which asks whether the element CARRYING the
  attribute is focusable. This one asks whether anything inside it is. Together they are the whole of
  the fault; separately each is a sentence a reader can act on, which is why they are two reports
  rather than one with a flag — and the fixture pins that they never report the same line.

  Both fixes are silent, which matters because reporting one would be reporting the fix: `inert`,
  which the platform added for exactly this and which removes the subtree from the tab order and the
  accessibility tree together, and `tabIndex={-1}` on the control inside. So are an `<a>` with no
  `href`, an `<input type="hidden">`, an unreadable `aria-hidden`, and a subtree holding a component
  or an expression — `found` is the only answer that speaks, and guessing at what a component renders
  is how a rule reports a page that is correct.

- b212e52: New rule: `landmarks-that-cannot-be-told-apart`

  A screen reader offers landmarks as a LIST — it is how somebody moves around a page without
  scrolling through it, and for a reader who cannot see the layout it is the closest thing to glancing
  at a page. A landmark with no accessible name is announced by its kind alone.

  So a page with a primary navigation and a footer navigation offers "navigation, navigation", and the
  reader has to enter one to find out which it is, come back out, and try the other. With three —
  primary, breadcrumb, footer — it stops being worth using at all, and the feature that exists to make
  a page navigable has made it slower than reading straight through.

  The fix is one attribute and the page looks identical afterwards, which is the whole reason this is
  worth reporting: nothing about the rendered page will ever remind anybody.

  **Only when NEITHER is named, which is the sharp line.** Two unnamed landmarks of one kind cannot be
  told apart — that is a fact about the list, not a preference. One named and one unnamed CAN be:
  "navigation" and "Footer navigation" are two different entries. The convention is to name both, and
  this deliberately enforces the ambiguity rather than the convention.

  All of them are reported, not all-but-one: every one needs a name before the list can be read, which
  is the opposite of `more-than-one-main`, where one is allowed and only the extras are wrong. `main`
  is absent from the landmark set for that reason — two of those are that rule's report, and naming
  them would not make two mains correct.

  **What counts is deliberately not the whole set.** `<nav>` always is a landmark wherever it sits,
  and an explicitly written `role` is certain because it is in the source. `<header>`, `<footer>`,
  `<section>` and `<aside>` are absent: whether they map to a landmark at all depends on where they
  sit in the sectioning tree, and being wrong about that means reporting correct markup. The certain
  half now, the rest when the data can be afforded.

- cc63fa1: A dev guard is recognised in two more shapes, and both guard walks became one

  `insideADevGuard` decides whether dev-only code is dev-only, and `listener-added-by-hand` is what
  asks it. Two shapes were missing, and both made that rule report **correctly guarded code** —
  telling its author to reach for a decorator, which cannot be made dev-only at all:

  - `if (!__DEV__) return;` and everything after it. The early return is how a `render()` is written
    far more often than a nested `if`.
  - `if (import.meta.env.DEV)`. `__DEV__` is the spelling this repository asks for and documents, and
    it is not the only one available — a bundler provides `import.meta.env.DEV` itself, and somebody
    arriving from one reaches for it without thinking. Reporting their working code over a second
    spelling is worse than tolerating the second spelling. `guardsDev` is shared, so
    `dev-guard-as-an-expression` now asks for the `if` form of that one too.

  **And the two guard walks became one.** `side-guard.ts` shipped an hour earlier with its own copy,
  on the stated argument that a dev guard never needs an early return because dev-only code goes
  INSIDE its guard. That was wrong within the hour — measured on a plant, the early return was exactly
  what `insideADevGuard` was silent on. The shapes now live in `guard-walk.ts`; each file only says
  what its own CONDITIONS mean.

  It takes two predicates rather than one and a negation, deliberately: a condition can say three
  things — this, the opposite of this, or nothing — and inverting one predicate would read every
  unrecognised condition as proof of the opposite.

- A boolean attribute is read as PRESENT, not as what its string says

  `truth` had one answer for two kinds of attribute. An `aria-*` is an enumerated string where
  `"false"` is a real value; an HTML boolean attribute is on whenever it is written down, whatever
  is on it. `required="false"` is a required field.

  That is not a reading of the spec, it is what this framework does: `core/Attribute.ts` removes an
  attribute for the VALUE `false` and keeps the STRING `"false"`, because removing it is the only
  way to turn `disabled` off — and its own comment names `aria-` as the exception for exactly this
  reason. The checker now mirrors that instead of running a second rule beside it, reading
  `BOOLEAN_ATTRIBUTES` from `@ramonda/dom-facts`, which is where that list was put so a second copy
  would not be made.

  Three rules were wrong on one line of markup, each measured with a plant:

  - `<main hidden="false">` was counted as a second visible landmark by `more-than-one-main`. It is
    hidden, so there is one.
  - `<video muted="false">` was asked by `media-with-no-captions` for captions it has no sound to
    need.
  - `<input required="false" aria-required="false">` — the exact contradiction
    `aria-that-contradicts-the-tag` exists to report — was reported by nothing.

  Two reports against correct markup, and one real fault nobody was naming. `required={false}` is
  unchanged and stays silent: written that way the attribute never reaches the element, so there is
  nothing on it to contradict.

  Asked of the VALUE rather than of the literal, so `required={FLAG}` with `const FLAG = "false"`
  answers the same as `required="false"` — written for the literal alone it gave one line of markup
  two answers depending on how it was spelled.

- 544f436: New rule: `element-html-removed` — a tag HTML dropped, still rendered by every browser

  These are not typos. Each was a real element once, each still parses, and most still paint
  something on the screen — which is exactly why they survive in a codebase: nothing breaks, so
  nothing draws attention to them. What they no longer have is a specification saying what they MEAN,
  so an accessibility tree has nothing to map them to and a future browser owes them nothing.

  **Two of them are worse than obsolete.** `<marquee>` and `<blink>` MOVE, and moving content that
  cannot be paused fails WCAG 2.2.2 outright: a reader who needs time on a line cannot get it, and for
  some people motion is a vestibular trigger. The report says so in a different sentence from the one
  it gives the others, because "this fails a success criterion" and "this was tidied out of the
  standard" are not the same news.

  Each entry carries a REPLACEMENT rather than a correction, which is what separates this from
  `attribute-that-does-nothing`: these names were right once, so the answer is what to write now
  (`<abbr>` for `<acronym>`, `<s>` or `<del>` for `<strike>`, CSS for `<center>` and `<font>`).

  The table leans SHORT like every table this package reports FROM — a name too many is a report
  against markup that is fine — so `<isindex>`, `<nextid>` and `<plaintext>` are left out. Nobody is
  typing those into a new component, and a table nothing consults is a table that drifts.

- 7a709c1: Every finding can carry a written reason — not just the three module rules that asked for one.

  `ramonda-check-ignore <why>` used to reach exactly three rules, because it was a method on
  `ModuleContext` that each rule called for itself. Its own note said why that is the wrong shape — "a
  guard every rule needs is a guard a rule can forget" — and thirty class rules were the ones who
  forgot. So when a class rule was wrong there was no way out but restructuring correct code, and
  `server-env-in-shared-code` is an ERROR: measured on this very branch, an aliased
  `@created({ env: "server" })` stopped excusing a `process.env` read and the reader's only option was
  to rewrite code that was already right.

  It is applied where every family's findings already meet, in `collect`, so no rule can be the one
  that did not ask. Class, element, tree, project and module rules all take it, and the reason is
  recorded under the rule's own name — printed on every run, so it cannot quietly stop being true.

  **An EMPTY directive now buys nothing.** It is reported, as it always was, and the finding stands.
  `ramonda-check-ignore` with nothing after it used to silence the site and leave a note, which made
  the note the price of switching a rule off. The package's own sentence is that a silence is not a
  record, and a directive that records nothing has bought a silence with nothing. It matters more now
  that the mechanism reaches every family: one worth abusing for thirty rules is not the same as one
  for three.

  `ModuleContext.unlessAnnotated` is gone, and with it the per-rule context `applyModule` built — the
  reason for building one per rule was the annotation, and there is nothing left that varies.

- bbadebb: `--fix` writes the answers the checker already knows

  Most advice cannot be applied by a machine: "give it a name" needs a person to know what the thing
  is called. A few faults are not like that — `httpEquiv` becomes `http-equiv` and there is nothing to
  decide — and for those, printing a sentence and making somebody type it was work the tool could have
  done.

  `ramonda-check --fix` applies them. `--fix --dry-run` says what it would apply and touches nothing.

  **The bar for a rule carrying an edit is one answer, and it must be the right one.** Not "the usual
  fix", not "what they probably meant". A wrong edit costs a reader a revert, and their trust in every
  edit that was right along with it. So `--fix` is never "this run is now clean" — everything needing
  a person is still reported, and still counted.

  Three things the fixer does to stay honest:

  - **Overlapping edits are dropped, not merged.** Two rules wanting the same characters disagree
    about what those characters should say, and picking the first, or the longer, or the one whose
    rule is registered earlier, is a coin toss wearing a rule's name. The run says how many it left.
  - **Edits are applied back to front**, so an earlier one cannot move a later one's offsets.
  - **A file is written once, or not at all.**

  Six rules carry an edit, across three kinds:

  |                                            |                                |
  | ------------------------------------------ | ------------------------------ |
  | `class` → `className`                      | `class-instead-of-classname`   |
  | `httpEquiv` → `http-equiv`, and three more | `attribute-that-does-nothing`  |
  | `playbackrate` → `playbackRate`            | `misspelled-element-property`  |
  | `aria-labelledBy` → `aria-labelledby`      | `unknown-aria-attribute`       |
  | `disabled="false"` → `disabled={false}`    | `false-on-a-boolean-attribute` |
  | remove `selected`                          | `option-that-cannot-choose`    |

  And every one of those rules reports faults it does NOT fix, which is where the bar lives:

  - `class` beside an existing `className` — which of the two they meant to keep is not written down.
  - `class` on a COMPONENT — the rename reaches the prop, and the answer is in that component's file.
  - `innerHTML` — its answer is "put it in the children", a change of shape rather than a span.
  - `aria-requred` — one edit from a real name is a GUESS, and the report says so with a question mark.
    Only the CASE fix is carried, and only in SVG: `setAttribute` lowercases for HTML, so
    `aria-labelledBy` on a `<span>` genuinely works and is not a fault at all.
  - `disabled={NO}` with `const NO = "false"` — whether that name has to stay a string elsewhere is
    not knowable from the line.

  The loss check caught the change to its own inputs, which is the job it was written for: every
  finding of the first rule to carry an edit read as LOST, because the claim had gained a field while
  the rule reported exactly as before. `edit` is a span, and a span moves whenever a fixture gains a
  line above it — so it is normalised away like `line` and `column`, with the gap that leaves written
  down beside it.

- 9493ff8: `empty-heading-or-link` now covers the BUTTON, which was in the gap between two rules

  `control-with-no-label` skips `<button>` on purpose and says so: a button is named by what is inside
  it, so asking it for a `<label>` would be asking for the wrong thing. `empty-heading-or-link`
  covered the two tags that carry text and not the third. Measured on a plant:
  `<button onclick={close} />` was reported by nothing, while the `<a href="/x" />` beside it was
  reported.

  That is the icon button — the ✕ that closes a dialog, the pencil that edits a row — and it is
  written more often than an empty link and an empty heading together. A screen reader announces it as
  "button" and nothing else, with no way to find out what it does short of pressing it. Nothing on
  screen will ever remind anybody, because it looks finished.

  The rule's existing walk answers it unchanged: an `aria-label` or `aria-labelledby` names it, text
  inside names it, one readable word beside a hidden icon is enough, and content this cannot read —
  an expression, or a component child — is left alone.

  **`<input type="submit">` and `type="button"` are NOT this**, and that is a boundary rather than a
  limitation. Those are named by their `value` and by a browser default, so an unlabelled submit reads
  as "Submit" rather than as nothing; they belong to `control-with-no-label` and its documented line.
  Only the `<button>` ELEMENT is named by its content.

  `EmptyHeadingOrLinkIssue.kind` gains `"button"`, and the report gets its own sentence for it.

- ed22995: `selected` on an `<option>` is refused, and reported where a type cannot reach

  The choice belongs to the select, not to the option. `Select` applies it by walking EVERY option and
  setting each one from its `value` — on and off, for all of them — so an option that asked to be
  chosen is turned off again a moment later. The attribute is not competing with `value` and losing
  sometimes; it does nothing, while being the one line on the page that looks like it chooses.

  **`@ramonda/core` refuses it in the types**, the same way it refuses the `<select>` tag itself: the
  error arrives at the call site, in the editor, with the answer in it —
  _"the choice belongs to the select — write `<Select value={x}>`, which sets this on every option"_.

  **`@ramonda/check` reports it too**, as `option-that-cannot-choose`, because a type is a defence
  only while nobody casts it away: a `@ts-ignore`, a props bag widened somewhere, a JavaScript file.
  That is the same pairing core and check already keep for RMD029 and RMD039.

  The rule asks whether the attribute is THERE, not what it says — and the first version did not,
  which the branch's own review caught. It asked for a readable TRUE, reasoning that `selected={false}`
  says the opposite and is not overwritten into anything it was not already. That reasoning is about
  HTML, and this is not about HTML: `Select` sets the choice from its `value` unconditionally, so
  `false` is overwritten exactly as `true` is.

  Worse, it missed the shape the fault is usually written in. `selected={o.id === value}` is somebody
  controlling the choice from the OPTION side — precisely the belief the rule exists to correct — and
  it was silent for it, because the value cannot be read. Found by walking the rule against the
  checklist's Part A and planting a module const, a helper call, a ternary and a row field: three of
  the four were silent.

  Still silent, on purpose: a spread may carry the attribute or replace it, so a spreading option is
  not asked about at all; and an `<option>` with no `<Select>` above it is nobody's report, because
  nothing is deciding for it.

  This is the fault the refused `<select>` tag could not reach. The tag is refused because HTML keeps
  the LAST of competing `selected` claims and gives an unclaimed select its first option — so the same
  markup meant different things depending on the order the options arrived in, which is not an order
  anybody writes.

- 4c70cce: `analyzeProgram` — the same analysis, over a program you already have

  `analyzeProject` reads a tsconfig and builds a program. The program IS the cost of a run — the
  rules themselves are close to free — so a tool holding its own programs had to pay twice, and look
  at something slightly different from what it had type-checked.

  Written for `scripts/check-examples.mjs`, which now asks a second question of every documentation
  example. It has always proved they COMPILE; it had never asked whether the example is one the
  framework itself would report. That is how `reference/api.md` came to demonstrate the inline arrow
  `RMD020` reports, with a green gate over it.

  **And running it found a rule reporting its own advice.** `fresh-object-in-props` follows a call to
  see whether a literal is built inside it, and skipped `@compute` because caching is the whole of
  what it does — but not `@memoized`, which is the answer for a value built per ROW. So
  `concepts/caching.md`, whose entire subject is `@memoized` as the fix for that report, was reported
  by it. The walk stops at a `@memoized` call for that question now, and
  `unkeyable-memoized-argument` is what keeps the assumption honest.

  **Whose question it is decides that, and getting it wrong lost a different report.** Written into
  the walk itself the skip made EVERY question stop at a `@memoized` call — including
  `unserializable-state`, which is not about whether a value is rebuilt but about what it IS. Caching
  changes nothing there: a `Map` behind a cache is still a `Map` the hydration blob cannot carry, and
  that rule is an ERROR going quiet on the exact value it exists for. It is
  `Looking.throughMemoizedCalls` now, decided by the question and required rather than defaulted, and
  both directions are planted.

  The examples the pass found and that are now fixed: three function literals in the markup
  (`composition/lazy.md` twice, `composition/error-boundaries.md`), six form controls with nothing
  naming them, a `<div>` with a click and no keyboard path, and two `<ul>…</ul>` elisions that are
  not valid markup for anyone who copies them.

- 0c6c61b: New rule: `misspelled-element-property` — a name one capital away from working

  A few pieces of element state live in a PROPERTY and have no attribute of that name at all: an
  `<input>`'s `indeterminate`, and a media element's `volume`, `playbackRate` and `currentTime`.
  There is no `playbackrate` content attribute for `playbackRate` to be the lowercase form OF, so
  each has exactly one spelling and anything else is a different name.

  `putAttribute` matches the table exactly for that reason, and the consequence is silent:
  `playbackrate={2}` matches nothing, falls through, and is written into the document as an attribute.
  Nothing reads it, the video plays at normal speed, and the line looks right.

  **The types accept both.** `RamondaArgs` has an arm keyed on `Lowercase<string>` so any real
  lowercase HTML attribute passes without being enumerated — `playbackRate` typechecks because the
  element's DOM properties are another arm, and `playbackrate` typechecks because it is lowercase.
  That is what makes this worth a rule rather than a note: it is the RIGHT name in the wrong case,
  written by somebody who reasonably expected HTML's usual indifference to it.

  `@ramonda/dom-facts` gains `propertyOnlyNames(tag)` beside the existing `keptInAProperty`. Core
  needs to know whether ONE spelling is the property; the checker needs the names themselves to say
  what was meant, and a checker with its own copy of them is the second list that table exists to
  prevent. Its note hands this half over by name.

- 89d0c74: A keyboard path is recognised in both spellings of an event name

  `click-with-no-keyboard-path` knew one. The framework takes two — `onclick`, and `on:click` which
  hands the name through verbatim for a custom event with a dash or a capital that the first form
  cannot reach. `core/Attribute.ts` decides it, and the new `eventTypeOf` mirrors that rather than
  inventing an answer.

  Measured on a plant: `<div on:click={open}>` was not recognised as a click handler at all, and —
  worse — the key handler in `<div onclick={open} on:keydown={onKey}>` was invisible, so an element
  whose keyboard path is written on the same line was reported as having none.

  `client-only-request-read` had this right and now reads through the same helper, so a fourth rule
  cannot drift.

- 2847429: Two rules read what an attribute SAYS rather than that it is there

  The last two rules on the audit list, and both gaps were the same shape: an attribute's PRESENCE
  read as its meaning, where the source says the opposite out loud.

  **`<video muted={false}>` has sound.** The rule went quiet on `muted` being written at all — right
  for `muted`, and right for `muted={quiet}`, since anything unreadable has to stay quiet as the
  direction that cannot report working markup. It was wrong for the one spelling that settles the
  question the other way, and that video's content exists only as sound with nothing to read instead.

  **`placeholder=""` names nothing, and reading its presence as a name put the report on the WRONG
  RULE.** `named-only-by-a-placeholder` told the author their placeholder is the only name this
  control has — on a control with no name at all — while `control-with-no-label`, whose sentence that
  is, stayed quiet because a placeholder was written. The report moves to the second rule, which is
  not a silence but a correction: the fault was always there and the wrong rule was describing it. A
  placeholder this cannot READ still counts as a name, because `placeholder={t("email")}` is somebody
  putting words there and only an empty literal is the source saying otherwise.

- a93b53b: Both decorator rules answer "who wrote this decorator" the same way

  `duplicate-decorators` resolved it. `decorator-that-adds-nothing`, which sits on the same line, read
  the written IDENTIFIER — and measured on a plant that was wrong three ways at once:

  - `import { state as reactive }` beside `@persist` went quiet on the identical pair;
  - `@core.state` beside `@core.persist` went quiet too;
  - an app's OWN decorator called `persist` beside core's `@state` was **reported** — somebody else's
    code, told one of its lines does nothing, for the framework's rule.

  It reads through `lifecycle-env`'s `coreDecorators` now. Two rules answering one question about one
  decorator two different ways is the drift a shared reader exists to prevent, and one of the two is
  always the wrong one.

  **And the namespace half was missing from the resolver itself.** `@core.Host` twice on one class
  was invisible to `duplicate-decorators` while the aliased form was reported. `coreExportName` reads
  a namespace access directly now — that spelling is the one place the module's own name for a
  binding is written down verbatim at the call site. It had been patched inline in `lifecycle-env` an
  hour earlier; that copy is gone.

### Patch Changes

- ad46613: `late-request-read` sees a request taken onto a field

  `ctx = requestContext()` written as a FIELD is the same take one scope out. The initializer runs at
  construction — on the server, inside the synchronous section `renderToString` has not yet cleared —
  so the take itself is correct, and every read of it below an `await` is late. Nothing reported one,
  while the identical `const ctx = requestContext()` a line lower was.

  It is the shape somebody writes precisely to stop calling `requestContext()` over and over, which
  is what made the silence expensive: the tidier the code, the less the rule saw. The report says
  which door was used, because the take is on a line the reader is not looking at.

  Bounded exactly as the local is — only an initializer that IS the call, nothing followed and
  nothing inferred.

  The rest of the boundary was re-tested rather than trusted, since the rule defends its own
  narrowness as a division of labour with the runtime's RMD053 while arguing two paragraphs earlier
  that RMD053 is not a sufficient backstop. It came back sound: a `try`, a `finally` and a loop body
  are all correctly below the await; an `await` inside a nested function correctly does not yield the
  body around it; and a value taken before the await — destructured, or read into a local — is
  correctly in hand afterwards and is not reported.

- f8bf479: `media-with-no-captions` reads a `<track kind>` held in a name

  The rule walked the track's attributes itself and accepted only a string literal, so
  `<track kind={CHAPTERS}>` with `const CHAPTERS = "chapters"` counted as a usable track and silenced
  the report — while the identical `kind="chapters"` on the line above it was reported. The same
  claim, spelled two ways, answered two ways.

  It reads the child through `contextFor` now, which follows a name to the value it holds. That was
  the fourth private attribute walk of a shape the shared readers exist to prevent, and it is the
  last one.

  Two facts stop hiding behind one `undefined` while it is being fixed: a track with NO `kind` defaults
  to `subtitles` and carries the words, while one whose `kind` cannot be read is a track nothing here
  can judge. Both still silence the rule, and `descendantIn` now hears which is which. A `<track>`
  beside a spread joins the second group — the spread may carry the `kind`, or replace the one
  written.

  Also written down, because it reads like an oversight and is not: a `<audio muted>` is still
  reported where a `<video muted>` is not. That escape is about the decorative background loop —
  autoplaying, silent by design, nothing to hear at any point. A muted `<audio>` is audio somebody
  will unmute with the controls, so the words are still coming.

- a5085ee: `Listener` — a listener the app arms and disarms, which the framework still removes

  `@onWindow` and `@onDocument` attach for the owner's whole life. That is right for most listeners and
  wrong for the ones this exists for: a `keydown` while a dialog is open, a `pointermove` while a drag
  is happening, a `scroll` armed after something loads.

  Written by hand, each of those is an `addEventListener` and a `removeEventListener` that have to
  agree with each other AND with teardown — three places for one fact, which is exactly where the leak
  lives and why `listener-added-by-hand` reports it.

  ```tsx
  private escape = this.use(Listener, () => ({
    on: "document",
    type: "keydown",
    run: this.onKey,
  }));

  @mounted open() { this.escape.listen(); }
  close() { this.escape.stop(); }
  ```

  One hook instance is one listener, and teardown removes it. Nothing to remember, no handler
  reference to keep in step. It is deliberately the shape `Interval` and `Timeout` already have.

  **The target is NAMED rather than handed over.** `window` does not exist on the server, so a prop
  holding the value would be evaluated where there is nothing to evaluate. `"window"` and `"document"`
  are resolved at arm time; a function is the third form, for a target the app owns
  (`() => this.box.current`), and a ref that is not attached yet answers `null` so the listener refuses
  rather than attaching to nothing. `@onWindow` resolves its target the same way and for the same
  reason.

  **What is read WHERE.** The type, the target and the options are captured when it arms, because
  `removeEventListener` matches on the triple of type, function identity and capture — a `type` re-read
  at teardown after a signal changed it would ask the DOM to remove a listener that was never added
  and silently leave the real one attached. `run` is read when the event FIRES, so a handler chosen by
  a signal takes effect without re-arming. That is the same split `Timeout` and `Interval` keep.

  **`Armed` is extracted, not copied.** Knowing whether arming can be made safe right now is forty
  lines of measured reasoning — including two earlier attempts that asked which SIDE the render was on
  and both had a window where a timer armed in the SSR process and fired there. A second copy of that
  for the listener would have been the drift this codebase keeps paying for, so `Timeout`, `Interval`
  and `Listener` now share one answer.

  `listener-added-by-hand`'s advice named this as a gap in the framework. It now names the hook.

- 9b1c4ef: `--fix` no longer shifts every edit in a file that starts with a BOM

  A byte-order mark is the one place the two readers of a file disagree. TypeScript **strips** it, so
  every offset a rule produces is relative to the text without it; `readFileSync` keeps it, as a single
  `﻿`. Slicing the kept text with the stripped text's offsets put every edit one character early.

  Measured on a real file: `<div class="card">` came back `<divclassNames="card">`, having eaten the
  space and left the `s` behind. Silent, valid-looking, and in a tool that writes somebody's source.

  The mark is stripped before the offsets are used and put back on write, so the file keeps whatever it
  had. CRLF needed no such handling and was checked at the same time: TypeScript keeps `\r\n` in its
  text, so those offsets already agree.

  Pinned by a test that asserts the whole resulting string rather than that something changed — a
  regression here corrupts a file rather than failing loudly.

- 0beac11: An empty naming attribute no longer answers for the name it lacks

  `<input type="text" aria-labelledby="" />` has no accessible name at all, and was reported by
  **nothing**: the attribute that names nothing had answered for the one that would have.
  `aria-label=""`, `title=""` and whitespace behaved the same way. A screen reader announces every one
  of them as "edit, blank" and stops.

  It is the same shape as `placeholder=""` two branches above it in the same reader, found the same
  way and fixed the same way: **when a rule reads an attribute's PRESENCE as its meaning, ask what it
  SAYS.** Three answers and not two — written with something, written empty, and unreadable.

  A name this cannot READ still counts. `aria-label={t("email")}` is somebody naming the control and
  guessing at the string would report one that is correctly labelled; only an empty literal is the
  source settling the question the other way.

  Found by planting a broad sweep of obviously-wrong markup and reading which lines nobody spoke
  about — the ladder's own method, pointed at the gaps BETWEEN rules rather than at one rule's shapes.
  That is the second finding from that sweep; the first was the empty `<button>`.

- 0072896: `half-built-keyboard-path` stops reporting a composite widget built across components

  The rule already knew the container may own the keyboard: a `listbox` takes the arrow keys while its
  options carry a roving `tabIndex={-1}`, and a `toolbar` and a `tablist` do the same. That was fixed
  for the case where the container and its children sit in ONE render.

  They usually do not. `<Toolbar>` renders the `role="toolbar"` and the `onkeydown` and takes the
  buttons as children, which is how anyone actually builds one — and from inside the rule that ancestor
  is a capitalised tag with nothing written on it. So the recommended shape was reported, and the
  half-fix looked identical to a whole one from in here.

  A COMPONENT ancestor now means the same as a key handler on an ancestor: do not report. What it puts
  around its children is decided in another file, and guessing is how a rule reports correct code.

  The cost is a real report lost when that component ancestor is a plain `<Layout>` handling no keys at
  all. That is the trade this package takes every time — a false report against a widget built
  correctly costs more than a missed one against a widget built wrongly.

  Found by walking the merged rules against the checklist rather than by a test. The rule passed
  everything it had.

- 473588c: Nothing a reader is shown names a decorator this framework no longer has

  The first release without `@Host` was about to ship text that still sends people looking for it.

  **RMD041's advice described a feature that was removed**, and the docs page for it described a
  different one that never existed. The runtime message blamed `@onElement` on a component whose host
  element was missing; the reference page blamed a selector that matched nothing, and there has never
  been a selector. Both now say what is actually true: a listener decorator resolves its target when its
  effect runs on mount, `@onWindow` and `@onDocument` are the only two and they answer with `window` and
  `document`, so reaching this means an effect ran where there is no DOM at all.

  **`@ramonda/form` shipped a `@Host` example in its published types** — the first example a reader of
  `Field` meets, using a decorator that is gone. It writes its own `<label>` now, which is what the
  framework asks for.

  The same sweep over every surface a reader can see: five more places in `@ramonda/core`'s published
  `.d.ts`, a `flushSync` error naming `@onElement` among the things that might be writing state, and
  ten spots in `@ramonda/check` and `@ramonda/router`. One was not prose: core's DOM-nesting check
  still stepped around a `RAMONDA-HOST` parent, which no longer exists, so the branch is gone.

  `@ramonda/check` no longer knows the name either. Its `CLIENT_ONLY_DECORATORS` entry for
  `@onElement` is gone, and so is the reason for keeping it: the fixtures declare their OWN stub of
  `@ramonda/core`, so the decorator there was a specimen rather than a migration being tested. The stub
  stops declaring it, the fixture that used it uses `@onWindow` — a decorator that exists, and the same
  thing to the rule under test — and `fixtures/host-listeners/`, seven uses of it that no test loads at
  all, is deleted.

  **And the same question asked of every diagnostic, not just this one.** Comparing all 53 shipped
  messages against their reference entries turned up no other contradiction — RMD041 was the outlier —
  but three entries had gone stale in the same way a rename does. RMD047's heading still said "memoized
  handler"; `@memoized` takes any method, and its own shipped title already says "member". RMD021's
  heading said the same thing, and so did a runtime message from the purity guard and the label
  `@ramonda/check` prints for the decorator. RMD006 predates the `Timeout` and `Interval` hooks and only
  offered the mount-armed decorators.

  Nothing checks that a diagnostic's `fix` and its reference entry agree, which is how RMD041 came to
  have two different wrong explanations of itself. A gate for that is not in here — it is worth
  deciding on separately.

- 976fd40: Findings from the branch's own review

  Fresh code is the least-examined code on a branch, and this was a long one.

  **Two rules answering "is this focusable" two different ways.** `aria-hidden-on-focusable` asks it
  of the element the attribute is ON; `aria-hidden-around-something-focusable` asks it of an element
  INSIDE that subtree. The second had written its own walk over the raw JSX attributes, and it
  disagreed twice — measured with a plant, both times reporting markup that is correct:
  `<input type={HIDDEN}>` where `const HIDDEN = "hidden"`, because a walk that accepts only a string
  literal does not follow a name to the value it holds; and `<button {...rest}>`, where `rest` may
  carry the `tabIndex={-1}` that takes it out of the tab order. There is one reader now,
  `inTheTabOrder`, and it answers three ways rather than two: proved in, proved out, and not
  provable here.

  `descendantIn`'s matcher can say `"unreadable"` for the same reason, so a caller's uncertainty
  travels out with the walk's own instead of being flattened into "none".

  **Two exports nothing outside their own file used** — `narrowsTo` and `attributesOf`. An export is
  a promise, and this package curates its surface on purpose.

  **Three silence assertions pointing at nothing.** `foreign-child`'s list of containers that must
  stay quiet named a comment, a closing tag and a blank line, so four of the ten silences it claims
  to check were never checked. A negative assertion passes whatever it points at, which is what makes
  getting the line right the whole of its value.

- ccc64fe: Every package's npm page carries the same four facts, and `homepage` points at its own docs

  The README is published, so this is a change to what a reader lands on. Measured before it was
  written: of eleven published packages, five carried no licence, three named no install command
  anywhere, one had no badges, and two linked to no documentation at all. `create-ramonda` and
  `@ramonda/devtools` had no README whatsoever — their npm pages were blank.

  Those facts are now generated from the sources that already held them — the package name, its
  `peerDependencies` (required ones appear in the install line; `bguard` is declared optional and
  so does not), and `homepage`, which now points at the package's own documentation section rather
  than at the site root. npm shows `homepage` beside the package, so that is a better npm page on
  its own as well as the one source the README link is written from.

  Nothing below the generated region changed. Each README keeps its own voice, and its own headings.

- e13c34c: `context-consumed-above-its-provider` orders two halves in one field by the calls, not by the field

  Both provider rules turn on one fact — field initialisers run in declaration order, furthest
  ancestor first — so the walk is where a gap would be. Walked, and most of it held: a base that
  consumes with a subclass that provides is correctly the fault ACROSS FILES, a base that provides
  with a subclass that consumes is correctly the arrangement rather than the fault, and neither a
  `readonly` modifier nor a `static` field between the two changes anything.

  One shape fell through. `pair = { reads: this.use(C), writes: this.use(P) }` is constructed left to
  right and is the same fault as two fields in that order, but ordering was by the FIELD's start
  position — one node for both halves — so the comparison settled nothing and the rule fell through
  to silence. The `this.use` calls carry their own positions now. That is meaningful because one
  field is one file; across the heritage chain it is still `rank` that orders, which is the whole
  reason `rank` exists.

  `one-provider-per-component` needed nothing: a SECOND provider is the fault wherever it sits, so it
  was already right about two in one field and about one on a base with another on the subclass.

- d70b075: `parent-with-a-foreign-child` counts text, not only tags

  `<ul>Items:<li>one</li></ul>` is the same fault with no tag in it. The content model of these
  containers takes ELEMENTS, so words written straight inside are as foreign as a `<div>` — and in a
  `<table>` the parser moves them out exactly as it moves a foreign element, so the tree the browser
  builds is not the tree in the source.

  **The whitespace between children is not that**, and it is the thing this would have broken first if
  written carelessly. Every one of these containers is written across several lines, so the newline
  and the indentation are JSX text nodes on every well-formed list in existence. Only text with
  something in it once trimmed is content, and the well-formed list is asserted silent beside the
  faulty one.

## 0.12.0

### Minor Changes

- 0c59cf7: `head-tags-collide` and the context pair read a value one name away.

  **`head-tags-collide` could not read options kept in a module** — `this.use(Head, PAGE_HEAD)`
  reached no object literal at all, so a description written both ways inside it was invisible. Page
  metadata living in a module of its own is the ordinary arrangement, and the whole argument for this
  rule is that nothing else can see the collision: the type permits it, `tsc` says nothing, and by the
  time the runtime has built its map the losing tag has left no trace.

  A `{ name: ROBOTS }` identity is now read the same way. `this.which` still is not, and that is a
  different case rather than the same one — a field can be written again, so the identity really is
  not knowable.

  **A Provider under a local name is the same Provider.** `resolve` already followed an IMPORT alias,
  so `ThemeProvider as Publishes` was never a question; a second `const` in the file was, because the
  declaration behind it is a `VariableDeclaration` rather than the `BindingElement` the pair was
  destructured from. `one-provider-per-component` and `context-consumed-above-its-provider` both read
  through this, and both were silent on it.

  No change to what is reported on any project in this repository.

- d60daaf: A core decorator is identified by resolution, not by the name written on the member.

  `hasDecorator` compared a bare name and asked nothing about where the decorator came from — the one
  identity question in this package that did not resolve. Fourteen call sites across nine rules read
  `@state`, `@compute`, `@persist`, `@created`, `@destroyed` and `@memoized` through it, so it failed
  in both directions at once:

  - **`import { state as reactive }` made every class rule go quiet.** Measured with two components
    that are the same component written twice: the plain one produced two reports and the aliased one
    produced nothing, from any rule.
  - **An app's own decorator called `state` was judged as core's**, which is the shape `own-list.ts`,
    `own-head.tsx` and `own-helper.tsx` exist to keep out of three other rules.

  `resolve` now carries `coreName` on itself — a callable with one property — rather than a second
  function threaded beside it. `resolve` already reaches all two dozen helpers that needed this, and a
  parameter a caller can forget is the shape that silenced every tree rule for a commit. Two
  long-standing optional resolvers became required in the same pass: `staleFieldsOf` and
  `stateFieldsOf` no longer answer a narrower question when nobody hands them one.

  **It costs nothing, measured rather than assumed.** A file with 400 components: 0.58 s before,
  0.58 s after. `apps/docs`, 151 components: 1.25 s before, 1.25 s after. The checker memoises symbol
  lookups, and decorators are few beside everything else a run already resolves.

  No change to what is reported on any project in this repository.

- 39e567b: A lifecycle decorator imported under another name is read as the lifecycle it is.

  `lifecycle-env.ts` looks a decorator's name UP in a table of what each one does — so the local name
  was not merely a weaker key than the exported one, it was the wrong key. `import { created as
onCreate }` read as `onCreate` found nothing in that table, so `@onCreate({ env: "server" })`
  excused nothing, and `server-env-in-shared-code` reported the `process.env` read inside it as
  browser code. **A false report at error severity, on correct code**, and class rules carry no
  `ramonda-check-ignore` — so the only way out was restructuring code that was already right.
  Measured both ways: reported without the fix, silent with it.

  `coreExportName` answers the lookup half of the question `importedFromCore` answers the comparison
  half of, and both follow a re-export.

  **A known limit, now pinned by a test rather than left to be discovered.** `hasDecorator` — which
  fourteen call sites across nine rules read `@state`, `@compute`, `@persist`, `@created`,
  `@destroyed` and `@memoized` through — still matches the name written on the member and asks nothing
  about where it came from. So an aliased `@state` makes every class rule go quiet, and an app's own
  decorator called `state` would be judged as core's. `aliased-decorators.test.ts` measures both
  components and records it; closing it means threading resolution through those call sites and the
  helpers under them, which is a decision rather than a repair.

- 12972a2: Five rules identified a framework export by the name the FILE gave it, not the name the module
  exports.

  `import { requestContext as rc }` renames the binding, and so does an app's own module doing
  `export { Head } from "@ramonda/core"`. Every one of these rules tested the local name FIRST and
  only then asked which module it came from, so both spellings went quiet:

  - **`late-request-read`** and **`client-only-request-read`** on `requestContext` and `requestKey`
  - **`head-tags-collide`** on `Head`
  - **`context-pair`**, which both context rules read through, on `createContext`

  `importedFromCore` takes the exported name now and checks it where the chain reaches core — so an
  alias and a re-export both resolve, while an app's OWN function of the same name still has its own
  declaration, no chain to core, and is still left alone. That last part is the whole reason these
  rules resolve rather than match a name, and it is unchanged.

  **`late-request-read` also reads the held context two more ways.** `const { headers } = context` and
  `context["cookies"]` below an `await` reach the same getters on the same object as `context.headers`
  does, and both were silent. The destructure report quotes the line — `{ headers } = context` — rather
  than a dotted form that is nowhere on it.

  No change to what is reported on any project in this repository.

- 7da9d2d: Four more element readers follow a name to its declaration, which closes two false reports and two
  project-wide silences.

  `attr` and `numberAttr` already did this — `role={ROLE}` where `const ROLE = "button"` is the same
  fact as `role="button"`. Every reader beside them was still literal-only, and none of it is visible
  from a rule's own source: each of these rules calls a helper whose name says it reads the attribute.
  Measured by planting the same shape into all of them.

  **Two rules were reporting correct markup.**

  - `heading-skips-a-level` read a `role` literally, so `<h3 role={PRESENTATION}>` — which is not in
    the outline at runtime — was reported as skipping a level. The same blindness missed
    `<div role={HEADING} aria-level={6}>`, which is a real skip. `stringAttr` now follows a name, and
    takes a `resolve` rather than defaulting one.
  - `control-with-no-label` reported `<input type={IMAGE_TYPE} />` as an unlabelled control. An image
    input is named by its `alt` and is `unnamed-image`'s subject, where it was already reported.

  **Two silences that scaled with the project.** The id table read only literals, so a project that
  keeps its ids in one module — the ordinary way to make two references agree — marked every one of
  them unreadable, and one unreadable id anywhere silences
  `reference-to-an-id-that-is-not-there` for the whole project. Measured: a mistyped `aria-labelledby`
  and a fragment link to nowhere, both reported by nothing. The same fault in two more spellings:
  `@Host("section", () => ({ id: OVERVIEW_ID }))`, and `({ id })`, which was read by nothing at all.

  Also: `trueAttr` follows a name, so `aria-hidden={HIDDEN}` is the fourth spelling of a fact whose
  other three were already read — `aria-hidden-on-focusable` and `empty-heading-or-link` both went
  quiet one hop away. `aria-level="6"` is read as a number where it is written, and now through a name
  holding `"6"` as well.

  No change to what is reported on any project in this repository — `apps/docs`, the three
  playgrounds, `router`, `query` and `form` produce byte-identical output before and after.

- 7dddee5: `unsplittable-import` no longer reports a template the bundler can read, and `unexposed-env-read`
  reads both spellings of an env variable.

  **A FALSE REPORT on a documented feature.** `` import(`./pages/${name}.js`) `` is not a path a
  bundler cannot read — Vite turns it into a chunk per matching file. Measured with Vite 7 rather than
  reasoned about, and the boundary measured with it:

  | written                              | modules transformed | chunks emitted                   |
  | ------------------------------------ | ------------------- | -------------------------------- |
  | `` `./pages/${w}.js` ``              | 4                   | `a-*.mjs`, `b-*.mjs` — **split** |
  | `` `./pages/${w}` `` — no suffix     | 1                   | none                             |
  | `` `pages/${w}.js` `` — not relative | 1                   | none                             |
  | `import(specifier)`                  | 1                   | none                             |

  So a template splits only with a RELATIVE head and a non-empty tail after the last substitution, and
  that is exactly what is left alone now. The last three rows are the rule's own claim confirmed:
  nothing is emitted, and at run time there is nothing to fetch.

  **`import.meta.env["VITE_API_URL"]` is the same read as `import.meta.env.VITE_API_URL`**, and the
  rule saw only the dot. A key held in a `const` — what a project with more than two of them does — is
  the same read one hop further, and is read now too. A key nothing settles is still not judged, and
  neither is the public prefix or a name the bundler provides itself.

  No change to what is reported on any project in this repository.

- b592062: The three key rules read a list whose row callback was lifted out of the JSX.

  `rows.map(renderRow)` is the same list `rows.map((row) => …)` is, and the row inside `renderRow` is
  the same row — but all three rules read only the inline form. So a list stopped being checked at
  exactly the moment it grew big enough for somebody to extract the row, which is the list most likely
  to have a real key fault in it. Measured: four unkeyed rows and one index key, all silent.

  - **`row-without-a-key`** and **`index-as-key`** now share one walk, `rules/row-callback.ts`, rather
    than a copy each — two spellings of one question are two answers waiting to disagree about the
    same list. The report lands where the ROW is written, so an extracted callback handed to three
    lists is one report at the element that needs the key.
  - **`index-as-key`** also reads a key through a local one line up: `` const rowKey = `row-${i}` ``
    followed by `key={rowKey}` is the same position, moved for readability. A `const` inside a
    function only — a module-level one cannot mention the index at all.
  - **`duplicate-key-among-siblings`** compares a key held in a `const`: two siblings written
    `key={FIRST}` claim the same key exactly as two written `key="first"` do.

  The reverse lookup is memoised per file on a `WeakMap`. Asked per row it is one walk of the whole
  file each time — measured on a file with 400 extracted callbacks, 0.55 s becomes 0.95 s and the
  shape is quadratic in the file. Memoised, the same file runs in 0.55 s, which is what it cost before
  any of this, while reporting 400 faults that were invisible.

  No change to what is reported on any project in this repository.

- 93b8ea9: `unserializable-state` and `persist-of-a-lossy-value` say WHERE the value is built.

  `@state rows = level1()` reported that the field holds a `Map` and gave the reader nowhere to go.
  Both rules now name the place, and the INNERMOST one: `level1` is already on the line being read, so
  the report says `level3`. `built in \`makeCache\``, `built in \`SHARED\``, and nothing at all when
  the value is written on the line itself.

  `unserializable-state` was then walked through the whole checklist, which is what turned this up.
  Everything else about it holds: the value a cast, a module `const`, a helper, a chain of three, a
  helper handing back one it HOLDS, a ternary or a `??` away is reported; a field a base declares is
  reported once, at the base; a hook's state crosses the same blob; and a plain field, a `@compute`
  and a JSON-safe value are all silent. The browser-only half of the gate covers the followed values
  too — the gate is about the project, not about how the value was spelled.

- d2ac4a1: New rule: `dev-guard-as-an-expression` — a `__DEV__` guard written as `&&` or `?:` where an `if`
  would do the same thing.

  **Not a dead-code rule, and the measurement is the reason it says so out loud.** With esbuild and
  `__DEV__: false`, the `&&` form is DROPPED where an unminified `if (false) { … }` keeps its whole
  block and its string literals; with `minify: true` — which every package here uses — both vanish
  identically. Whoever reaches for the operator to help the bundler is not helping it.

  The `if` is asked for because a flag with two spellings has to be read twice by everything that
  reads it, and this repository has already paid for that: `dev-guard.ts` was written against the `if`
  alone, so `listener-added-by-hand` reported dev-only code for being written the other way.

  **Only where an `if` is a REPLACEMENT.** A statement, and nothing else — `const name = __DEV__ ?
displayName(x) : ""` uses the value and an `if` produces none, so it is left alone. Five of those
  are written here, in `core` and `lens`. And `if (__DEV__ && ready)` is a conjunction inside the
  `if`, which is the shape being asked for rather than an instance of the fault; 149 of those are
  written here.

  A warning today and an error in a later version. Zero findings across every project in this
  repository — measured, and in this case that is the whole population: the statement form is written
  nowhere.

- 7abb708: New rule: `listener-added-by-hand` — a component reaching for `window.addEventListener` itself.

  `@onWindow` and `@onDocument` attach on mount and detach on unmount, and there is nothing to
  remember. A hand-rolled listener has to be removed by hand, and one that is not outlives the
  component that added it: the handler keeps running, reading state nobody is showing and holding the
  component and everything it closed over alive. Open and close the same view ten times and there are
  ten of them.

  Nothing reported this before — measured, a component calling `window.addEventListener` in `@created`
  AND in `render()` produced no findings at all, and no rule in the package mentioned
  `addEventListener`. The harm was measured against the real runtime rather than argued: a listener
  registered in a `render()` is **6 listeners over 6 renders**, none removed. The report says which
  member it is in for that reason.

  Removing the listener by hand is not an answer to this and neither is `{ once: true }`: the
  decorator takes the same options and does both halves. That is where this differs from
  `interval-with-no-cleanup`, which still accepts a raw timer paired with a `clearInterval`.

  **One thing the decorator cannot do, and the advice says so rather than papering over it.** A
  listener the app ARMS — on a click, after a fetch — cannot be written with `@onWindow`, which
  attaches for the owner's whole life. There is no hook for it yet, so the rule reports the raw call
  and the advice names what the reader is left with. `Interval` and `Timeout` are the same problem
  already solved for timers: hooks the app starts and stops, which the framework still clears when the
  owner goes.

  **The one place a decorator genuinely cannot be used is `if (__DEV__)`, and that is the escape.** A
  decorator is code on the CLASS, so no guard can remove it: a dev-only listener written with
  `@onWindow` would attach in production too, on every mount, for an event nothing dispatches.
  Verified in `packages/query/dist/index.prod.js`, where the methods that add and remove one compile
  to `publishToDevtools(){}` and the listener does not exist — while `@onWindow("online")` on the
  `Query` hook is plainly there in the same file. `@ramonda/query` and `@ramonda/form` both need this,
  and both already say so in their own source.

  So inside a `__DEV__` guard the hand-rolled call is right, and the only question left is the
  ordinary one: does anything remove it. A `||` is not a guard, and the `else` of one is the
  production half; neither counts.

  **The escape is a fact rather than a promise**, which is deliberate and matters beyond this rule: a
  `ramonda-check-ignore` is the author's claim about a line and can be written anywhere, while a
  `__DEV__` block can only be got by making the code really vanish from the build. `rules/dev-guard.ts`
  carries that reasoning and is available to any rule that needs it.

  Also silent: a listener on anything that is not `window` or `document` — an `AbortSignal` dies with
  its request and an element with the element, and no decorator covers either — and module scope,
  which lives as long as the module.

  A warning today and an error in a later version. Nothing in this repository trips it, with the
  silence on `@ramonda/form` proved to be earned rather than accidental by taking its `__DEV__` guard
  away and watching the rule report it.

- ceb0feb: `browser-url` finds the same read spelled three other ways.

  - **`self.location.pathname`.** `self` is the third name for the global object and the package's
    other rules about one already list it; this had `window`, `globalThis` and `document` only.
  - **`const { pathname } = window.location`.** A read of exactly that member, with the member's own
    name on the left of it. The report quotes the line rather than rewriting it into
    `window.location.pathname`, which is text the reader would go looking for and not find.
  - **`window.location["hash"]`.** The dotted read with brackets round it.

  All three are reads the router already answers, in a project that has one, and all three were
  silent. A write and a method call are still not reads, and a local called `location` is still not
  the global.

  No change to what is reported on any project in this repository.

- 8515f48: The class family follows a value one name away — three rules, one of them a false report.

  - **`state-mutated-in-place` reads what a `@state` field holds through a name.** The rule mirrors
    the runtime mutation guard on purpose, and the guard wraps a plain array or object whatever
    produced it — so `@state rows = makeRows()` is the same array `@state rows = []` is, and
    `this.rows.push(row)` is the same silence. Reading only the initializer meant four spellings of
    one fault with only the first reported: a helper, a module `const`, a branch, and an object built
    anywhere but on the line.
  - **`interval-with-no-cleanup` follows the id out of the local it passes through.** A FALSE REPORT:
    `const id = setInterval(…); this.tick = id`, on a component whose `@destroyed` clears `this.tick`,
    was reported as an interval nothing could ever reach. The id escapes the local the moment it is
    assigned to a property, and where it lands decides whether anything clears it.
  - **`watch-of-a-prop-that-is-not-there` reads a selector kept in a `const`.** `@watchProp(BY_USER)`
    is handed the same function `@watchProp((p) => p.userId)` is. A `const` only, and only through to
    a function literal — a `let` can be written again and a call has no single answer, and this rule's
    cost of being wrong is telling somebody a prop they can see does not exist.

  `clock-read-while-rendering`, `stale-field` and `unwatched-fields` were walked through the same list
  and hold: a clock read is found in the render and behind a helper in another file, `new Date(iso)`
  parses and stays silent, and both of the others already ask the base classes.

  No change to what is reported on any project in this repository.

- 3022508: `server-env-in-shared-code` finds `globalThis.process.env`, and quotes a bracketed key.

  `globalThis.process.env.API_KEY` is the same `ReferenceError` on the page as `process.env.API_KEY`,
  and it was silent — the check required `process` to be a bare identifier. There is deliberately no
  "resolves to nothing" test on `globalThis`, unlike everywhere else in this package: the checker knows
  that name whatever the lib settings are, so the test would silence every one of these. It is a
  reserved binding rather than a global anyone can shadow, which is what makes leaving it off safe.
  Node's `global` still takes the test.

  A destructure and a bracketed key were already found, because the match is at `process.env` rather
  than at the member — but `process.env["REGION"]` was quoted as `process.env`, which is less than the
  reader wrote. It carries the key now. A destructure still quotes `process.env`, which is exactly
  what is on the right-hand side of one.

  No change to what is reported on any project in this repository.

- 3427a68: The `@Host` props callback is part of the render.

  `@Host("nav", (self) => ({ className: … }))` runs every time the component renders and is in no
  member body, so `entryPoints` did not reach it and a clock or a random read there was found by
  nothing. Walked with `insideTheClass` false, exactly as a static is: the callback is handed the
  component as a parameter rather than through `this`, so only the reads that depend on nothing are
  worth finding.

  Every rule that reads a render goes through this walk — `clock-read-while-rendering`, `dom-writes`,
  `late-request-read` and the rest — so it is one change for all of them.

  No change to what is reported on any project in this repository.

- 4c38be4: `row-reads-a-plain-field` finds core's `list` under an alias and through a re-export.

  It used to scan a file's imports for a binding called `list` and take the FIRST one, which is wrong
  in two ways. A file importing it twice — `import { list, list as rows }` — got whichever name came
  first, so calls through the other were invisible. And a re-export was invisible entirely:
  `export { list } from "@ramonda/core"` in an app's own `ui` module hands on the framework's own
  binding, and the rows it builds are cached exactly the same way.

  Resolved through the alias chain now, which takes nothing away: an app's own function called `list`
  has its own declaration and no chain leading to core, so it still resolves to itself and is still
  left alone.

  `importedFromCore` does the walking, so `Head`, `requestContext` and the context pair all follow a
  re-export now too. It needed one more question of the checker — `resolveStep`, a single hop along an
  alias chain — because neither existing resolver can answer this: `resolve` jumps to the end, where
  the path differs per project, and `resolveLocal` does not move at all, where the specifier says
  `./ui`. Stepping is the only way to read the chain the reader actually wrote.

  No change to what is reported on any project in this repository.

### Patch Changes

- faf19f8: A node from an installed package appears once in the graph, in a place that does not move with the
  process.

  Two faults, one line. A kit destructured out of a factory — `const { Router, Link } = createRouter(routes)`
  — binds each member to a local symbol, which is how the walk resolves `<Link />`, so the node a
  package's fragment brought in was in `components` as well as in the spliced list. `buildGraph` emitted
  both: **the same id twice, with two different places.** Measured on this repository's own fixtures —
  three duplicated ids in `kit`, two in `kit-ambiguous`.

  And the second place was wrong in a way that MOVED. A fragment's `at` is already relative to its own
  package, so running it through `pathOf` sent it climbing for a `package.json` — and `ts.sys.fileExists`
  resolves a relative path against the process's working directory. So `@acme/kit/src/index.tsx` was
  attributed to `@ramonda/check` when the CLI ran from that package, and to `ramonda-monorepo` when it
  ran from the repository root. `ramonda-check apps/docs/tsconfig.json` from a repository root is exactly
  that shape.

  The graph HASH never moved with it — that is taken over source text and absolute file names — so no
  published graph's identity changes. What changes is what a reader is shown, which is the whole point of
  `at`.

  Pinned two ways, and planted: no id is emitted twice across the four vendor fixtures, and the two kinds
  of place are asserted apart — a node from this program is placed against the project
  (`@ramonda/check/src/…/app.tsx`), a node from an installed package keeps the path that package gave
  (`src/index.tsx`), because its id already says whose it is.

- d4ff96a: A namespace import of `@ramonda/core` is recognised as core.

  `import * as core from "@ramonda/core"` followed by `core.requestContext()` was identified as
  nobody's — so `late-request-read` and `client-only-request-read` both went quiet on it, although
  `core-import.ts` has always said in as many words that a namespace import "arrives here". Each import
  shape sits a different distance from its statement, and this one was walked as if it were a named
  import: one parent too far, landing on the source file rather than the declaration.

  Wrong since the helper was written. Found by planting the shape while reviewing the branch, which is
  the only way a silence gets found.

- 9e3503c: The seventy-three fixture tsconfigs share one base instead of repeating it, and a test now proves the
  inheritance arrives.

  Nothing a consumer installs changes: this is all under `src/__tests__/fixtures`. What changes is the
  cost of touching the config. Measured before the edit: 73 files, **0** using `extends`, 52 of them
  byte-identical to each other, and the same eight options — `target`, `module`, `moduleResolution`,
  `jsx`, `jsxImportSource`, `strict`, `skipLibCheck`, `noEmit` — written out in every one. So raising
  `target` was a seventy-three-file edit, and a fixture left behind would not have said so.

  Two things stay in each fixture, and neither is a style choice. A relative path resolves against the
  config that **declares** it, so `include: ["."]` in the base would mean all of `fixtures/` and every
  fixture would pull in every other one; and TypeScript records a `pathsBasePath` per config file, so a
  `paths` mapping moved up would resolve one directory too high. `jsxImportSource` is safe to share
  because it is a module specifier resolved from each source FILE, not from the config.

  **Why it needed a test rather than a run of the suite.** The package's own tsconfig excludes the
  fixture directory, so nothing type-checks a fixture — and the analyzer reports what it can see from
  whatever options it is handed. Drop `jsx` and every `.tsx` fixture stops parsing as JSX, the rule
  under test finds nothing, and the failure reads as a rule that stopped working. So
  `fixture-configs.test.ts` asserts the RESOLVED options, through TypeScript's own `extends`, exactly
  as `analyze.ts` reads them — and it was planted four ways: a broken `extends`, an option repeated in
  a child, `paths` hoisted into the base, and `include` hoisted into the base. Each one fails, naming
  the fixture and the option.

  The change itself is a no-op, measured rather than assumed: all 73 fixtures were analyzed before and
  after and the two dumps — findings, graph, notes, everything `analyzeProject` returns — are identical
  byte for byte.

- 114f853: The analyzer's advice about a doubled decorator is checked against core's runtime instead of trusted.

  `@ramonda/check` tells a developer what writing `@StableProps` twice does — "they MERGE, both take
  effect, nothing is lost" — and that sentence lived in the analyzer while the behaviour lives in core.
  **The analyzer does not import core**, deliberately: it reads source with TypeScript and never loads the
  framework. So the two could disagree and nothing would notice. Change core so a second `@StableProps`
  throws and the analyzer would keep advising that it merges.

  The quiet direction is the worse one. A new single-use decorator in core that the rule never learns
  about is not a wrong report, it is SILENCE — and silence is what an analyzer is trusted for.

  Three links, none of them a shared dependency and none of them new published surface:

  1. Core's diagnostic carries the fact as data: `duplicate: { decorators, effect }` on the five codes
     about a doubled decorator (`RMD045`, `RMD032`, `RMD040`, `RMD046`, `RMD050`).
  2. `scripts/check-decorator-duplication.mjs` reads both tables from source with the TypeScript AST —
     the same reason `check-api-coverage.mjs` reads `SPECS` from source — and fails the build if they
     differ either way, or if a duplication code exists that no rule claims. Planted four ways: core
     changing an effect, core gaining a decorator, the rule claiming one core does not describe, and an
     unclaimed code.
  3. `DuplicateDecoratorSpecs.test.ts` in core closes the hole the script cannot see: a MISSPELLED name.
     `["catchErrors"]` in both places agrees perfectly, passes the script — measured, it prints "agree on
     all 8" — and describes a decorator that does not exist, so the rule reports nothing. The test reads
     the real export list rather than a second list of names.

  The rule's four `Set`s became one `EFFECT` map on the way, which says the same thing once and is what
  made the comparison trivial. Its 125 tests are unchanged.

- 395ba20: `scripts/findings-across-fixtures.mjs` — every finding across every fixture, recorded or compared.

  Reviewing a branch of rule changes has one question a diff cannot answer and a test suite answers
  only where somebody thought to assert it: **what stopped being reported?** A new finding is visible;
  a lost one is invisible by definition, because a rule that reports nothing looks exactly like a
  clean codebase.

  `pnpm --filter @ramonda/check findings --write baseline.txt` on `main`, `--against baseline.txt` on
  the branch. It exits non-zero on a loss and names each one. No network, no model, no judgement — it
  runs the analyzer over all ~80 fixtures and prints the set difference.

  Proved to catch what it is for by sabotaging `access-key` into silence: four claims vanished across
  two fixtures and all four were named. It found two real things on the branch that added it — a
  fixture carrying a context-order fault it was not about, and a namespace import of core that had
  never been recognised.

- 72049a8: Seven defects found by reviewing this branch, five of them in code it added.

  - **`self.location.pathname` was reported on a component reading its own field.** `browser-url`
    accepted `window`, `document`, `self` and `globalThis` by NAME, and `self` is the one of the four
    that is routinely a local — `const self = this` is an ordinary line, and `(self) => …` is this
    framework's own convention for a `@Host` props callback. Three rules asked "is this the global"
    three different ways and two were wrong in opposite directions; `rules/globals.ts` answers it once.
  - **A `@StableProps` core declares on its own hook was invisible**, so `fresh-object-in-hook-props`
    reported a `meta` array that `Head` has DECLARED stable — reporting the fix, on the framework's own
    hook, in `apps/playground-ssr`. Core imports its decorators relatively, so nothing in `Head.ts`
    names `@ramonda/core` at all. A declaration is core's when it lives in the package called
    `@ramonda/core`, read from `package.json` rather than from a path.
  - **`export * from "@ramonda/core"` silenced every class rule.** A star export resolves straight to
    core's own declaration, which names no module, so the specifier chain had nothing to walk — and
    `hasDecorator` is the chokepoint they all read through. The package test answers this one too.
  - **A listener added on `window` and removed on `globalThis` was reported as uncleaned.** They are
    one object; the removal set was keyed on the spelling. That is the `@ramonda/query` and
    `@ramonda/form` devtools shape with one word changed. A removal whose event name cannot be read
    now also silences the add, which is the care the add side already took.
  - **`foundIn` printed the outermost name**, which is the opposite of what the field documents.
    `@persist blob = wrap()` where `wrap()` returns `{ cache: makeCache() }` named `wrap` — already on
    the line being read — instead of `makeCache`, where the reader has to go.
  - Eight fixture configs carried two `"paths"` keys after the merge, so the second silently won and
    the `@ramonda/core` mapping was discarded. Four vendor fixtures never needed one.
  - The note added to `render-reach` overstated its case: a handler CAN be a call argument —
    `onclick={debounce(() => { this.n += 1 }, 100)}` is reported — and the docstring now says so
    rather than generalising from the returned-handler shape.

- ad49633: Five defects a targeted review found in the two newest files.

  - **`dev-guard-as-an-expression` missed the chained and parenthesised `&&`.** `__DEV__ && ready &&
publish()` parses as `(__DEV__ && ready) && publish()`, so asking whether the immediate left was
    the flag missed every one — while `dev-guard.ts` recognised both. Two answers about one flag, in
    code written hours apart. `guardsDev` is exported now and both read it.
  - **A ternary with a real other arm was reported with advice that deletes it.** `__DEV__ ?
publish("dev") : publish("prod")` came out quoting only the true half, so an author following
    "write it as `if (__DEV__)`" would drop the production one. Only a ternary whose other arm is
    `undefined`, `null` or `void 0` is reported now — the rest is an `if`/`else`, which is not what
    this advice says. The report also rendered a ternary with no `:` arm at all.
  - **`window` and `document` accepted by name reported a real binding of that name.** A parameter
    called `window` was read as the browser's. The justification — that requiring them to resolve ties
    the rule to `noLib` — does not hold: `analyze.ts` forces `noLib: true, types: []` whatever the
    project says, so a lib-declared global can never resolve and the only thing that can is a
    declaration in the source.
  - **Its mirror: an ambient `declare const self` silenced three rules.** An ordinary line in a worker
    or an SSR entry, and it made `self` resolve, which the old test read as "not the global".

  Both directions are one test now: the NAME, unless something in the source declares it for real.
  `declare const document` is the author writing down what the platform provides and is still the
  platform's; `const self = this` is a name of their own. That is what `dom-writes` was reaching for
  when it argued a prefix is not a form a local plausibly shadows — its own fixture declares
  `document` ambiently, which is why the by-name rule looked right there.

  - **A test asserted nothing.** Three "must stay silent" line numbers pointed at a brace, a blank
    line and a `return (` after the fixture moved under them; only a `toHaveLength` beside them held
    the claim.

- 4c2d4fc: Four more from a second review, all in the code the first review's fixes added.

  **`globals.ts` had one answer where the right one is asymmetric**, and `dom-writes` — a fifth rule
  asking the same question — had already argued the other half. A prefix is not a form a local
  plausibly shadows: nobody writes `const document = …` and then reaches for `.body.classList`, and
  requiring `window` and `document` to resolve to nothing makes a rule depend on the run having no
  lib, which is a silent trap for a project that declares the global itself. So `globalThis`, `window`
  and `document` count by name; `self` and `global` have to prove themselves, because `self` really is
  routinely a local. All five rules read one answer now, `dom-writes` included.

  **`packageIsCore` cached on a directory path, which never invalidates** — unlike `row-callback.ts`'s
  `WeakMap`, which hangs on a `SourceFile` and dies with the program. Measured before removing it:
  `apps/docs` 1.26 s with the cache and 1.28 s without, `packages/core` 0.68 s and 0.71 s. Inside the
  noise, because it is reached only where the specifier chain has already failed. Global mutable state
  with a staleness hazard and no measured benefit is worth less than nothing.

  **A `__DEV__` guard written as an expression was read as no guard at all.** `__DEV__ &&
window.addEventListener(…)` and `__DEV__ ? … : …` are the same claim as `if (__DEV__)`. So
  `listener-added-by-hand` reported dev-only code for being spelled the other way — this repository's standing lesson, that a fix for one
  spelling is not a fix for the other, arriving on schedule.

  **`declaredInsideCore` took `declarations[0]`.** A name with an overload set or a merged namespace
  has more than one, and which comes first is not something to build an identity on. Every declaration
  is asked now.

- 6244c55: `interval-with-no-cleanup`'s advice names the `Interval` hook for an interval the app starts.

  The rule reports a `setInterval` nothing can clear, and its advice offered two answers: `@interval`,
  which starts at mount, or a raw timer whose id lives on a class property. The first does not fit an
  interval that starts on a click, so every such case landed on the second — and the second is the
  shape the rule exists to catch when it is done half way.

  `Interval` is the answer for that case now, so the advice offers it first and keeps the property
  fallback for a timer the app really does want to own.

- 5632f32: The documentation is at **ramonda.dev**, and everything that names it says so.

  The site was reachable only at its Cloudflare Pages subdomain, `ramonda.pages.dev`, and that address was
  written into 63 places. The custom domain is attached now, so all of them name it: `homepage` in every
  published `package.json`, every README, the URL a diagnostic tells you to open, the scaffolder's closing
  line, both `create-ramonda` templates, and `BASE` in `apps/docs/src/entry-server.tsx`.

  **`BASE` is the one that mattered beyond tidiness.** Every `canonical`, `og:url`, `og:image` and the
  whole of `sitemap.xml` and `robots.txt` are built from it — its own docblock warned that a move would
  take the canonical tags and leave the sitemap behind. Left alone, every page on the new domain would
  have told a search engine that the real page is on `pages.dev`. Verified on a real build rather than
  assumed: `Sitemap: https://ramonda.dev/sitemap.xml`, `<loc>https://ramonda.dev/…`, and the canonical
  and `og:image` tags on the built pages.

  **Two places deliberately keep the old host.** The CHANGELOGs: those are published release notes, the
  links were correct when they were written, `pages.dev` still resolves, and rewriting them would be
  rewriting history. And `.github/workflows/README.md`, where `ramonda.pages.dev` is a FACT about
  Cloudflare — the project's name is its subdomain — so the sentence stays and gains the one that was
  missing: the site is served at the custom domain, and leaving anything on `pages.dev` is how a search
  engine is told the real page is elsewhere.

## 0.11.0

### Minor Changes

- 1c3d169: Three rules read one class body where the fault spans a base class and its subclass. Found by
  planting the shapes each rule's claim implies and measuring, then checking the answer against what
  core does at runtime.

  A component's fields initialise base-first, on ONE instance, so what a base declares is the
  component's as much as what it declares itself.

  - **`one-provider-per-component`** missed a Provider inherited from a base beside one mounted here.
    Measured in core: that pair **throws `RMD056`** — "a component publishes a context on ONE object" —
    and the rule that exists to say so before it ships said nothing. The report now names the base the
    first one came from, because a line number in another file does not.
  - **`context-consumed-above-its-provider`** missed a consumer inherited from a base, which is
    _always_ above a provider mounted here. Measured: core reports `RMD057`. Two halves in two class
    bodies are ordered by the chain now; two in one body are still ordered by source position.
  - **`interval-with-no-cleanup`** reported an interval the component does clear, when the
    `clearInterval` is on a base — a false positive on the documented shape. The chain is read upward
    now.
  - **`state-mutated-in-place`** was half-walked, which is worse than not walked: `stateFieldsOf`
    already knew an inherited field was `@state`, while what it HOLDS was read from the subclass's own
    body — so a `@state rows: Row[] = []` on a base guarded nothing and `this.rows.push(x)` went
    unreported.
  - **`cached-read-of-a-plain-field`** read one class body for both halves — which fields are plain,
    and which are written after the first render — so a plain field on a shared base made the whole
    fault invisible.

  **Reported once per fault, not once per class that inherits it.** Walking the chain made a pair
  written on a shared base visible from every subclass as well, so one line was reported for the base
  and again for each class extending it. One half has to be declared on the class being reported;
  both on a base is that base's own fault, and its own pass says so.

  The chain is walked upward only, and that decides one deliberate silence: a class cannot know who
  extends it, so an **abstract** class keeping a timer id on a property is no longer reported. It is
  never mounted on its own, and any subclass may be the one clearing it. A concrete base keeps its
  report — `<Base />` alone really does leak — and an id kept nowhere or in a local stays certain
  either way, because no subclass can reach either.

  `heritage()` is exported from `render-reach` rather than copied three more times; it was already the
  answer to this question for `render()`'s reach and for `@state`.

- 147dd09: **A `@compute` method is now a method.** Both forms are real, and each is typed as what it installs:

  ```tsx
  @compute get total() { … }   // this.total    — an accessor, so it IS the value
  @compute total() { … }       // this.total()  — a function that returns the value
  ```

  Before this, a method had an **accessor** installed, so the member was declared `() => R` while it held an
  `R`. That is a type lie in both directions, and both were measured: reading it as the value it is was a
  type error, and calling it — which the type allowed — threw `total is not a function`. The
  `alternatives` block on `/concepts/compute` taught the call.

  So the choice between a getter and a method is a real one again, and the `get` is not ceremony: it decides
  how you read the value, and both readings are true. One cache, one set of dependencies, one invalidation —
  measured: each form runs its body once for two reads, and once more after a write.

  **And neither form takes an argument, refused in three places** — the type first, then the two nets behind
  it. A `@compute` caches one value per
  component, so there is no key: an argument would be accepted and ignored, and the second call with a
  different argument would hand back the first call's answer — a wrong number, silently.

  - The framework throws when the class definition runs, **in every build** rather than in development only,
    because the failure is a wrong value rather than a slower one.
  - `@ramonda/check` reports it before the build, as the new **`compute-takes-no-arguments`** rule, at error
    severity. The class definition running is the first import of the module, so a component behind a route
    nobody opened would otherwise ship with the fault and throw for whoever opens that route.
  - The **type** refuses it first, and that is the earliest net: a function declaring a parameter is not
    assignable to one that declares none, so `compute`'s own `(this: T) => R` is enough — measured,
    `@compute withArg(k: number)` is `TS1241`. The rule and the runtime are for a project with no types, a
    `@ts-ignore`, or a cast.

  `@memoized` is the decorator keyed BY arguments, and every one of the three messages says so.

- 8524f00: A new rule: **`row-reads-a-plain-field`** — a `list()` row callback that puts a field nothing can track
  into the markup.

  A row is rebuilt when something it READ has moved, and the reads are recorded while the callback runs.
  A plain field is not a signal, so nothing is recorded and nothing marks the row. Measured, one field read
  twice in one component: `new` in the markup outside the list, `old` in the row.

  **This is the only place the check can live.** A plain field read is a property access and leaves no
  trace, so the runtime has nothing to observe — and the double render compares two calls in one tick,
  where the field holds the same value both times. The declaration is the only evidence there is.

  **Every silence is a decision, and half the fixture is silences.** An inline callback (every row rebuilds
  anyway). A field nothing writes. A field written only in `@created`, which runs before the first row. And
  a read that never reaches the markup — `this.socket.send(…)`, `this.observer.observe(el)` — because a
  plain field is the only home for anything that cannot be JSON, and `@state` and `@persist` must be.

  **And it says what it cannot see.** `<li>{labelOf(this)}</li>` hands the component to a function that
  reads it elsewhere, so the reads are not in this declaration. Rather than going quiet, the rule reports the
  shape — a proven fact rather than a guessed defect — which is what makes the guarantee sayable: a row
  callback either reads its members where this can see them, or it says it does not. Measured across this
  monorepo, 53 calls take a bare `this` and every one is inside the framework itself; none in application
  code, none in a row callback.

  A warning rather than an error, because one thing is not provable from the declaration: WHEN the write
  happens. A write that also replaces the array rebuilds every row anyway.

  Zero reports across `apps/docs`, both playgrounds, `core`, `query`, `router`, `form` and `devtools`, with a
  planted violation confirming the rule is reachable rather than silently gated.

- 3724467: Every diagnostic's prose read against the code that raises it. Six were saying something the code
  does not do, and one of them was reporting working code.

  **`RMD039` had it backwards.** It said `class` "is passed through to the element as an unknown
  attribute and the styling it names never applies". `class` has been renamed to `className` before
  the vnode is built since the first commit, so the element is styled and the page is fine — measured:
  `<p class="lead">` renders `class="lead"`. What the rename cannot save is the two cases the
  diagnostic never mentioned, and the report now says which one it found:

  - `className` on the same element wins, and the `class` is **dropped** without a word.
  - A COMPONENT is renamed too, so `<Panel class="muted" />` arrives as `className` — a `class` prop
    that component declared reads `undefined` on every render, for ever.

  `@ramonda/check`'s `class-instead-of-classname` repeated the false claim three times and skipped
  components on the reasoning that "what it does with it is its own business". **It now reports a
  component as well**, and `ClassInsteadOfClassNameIssue` carries `onComponent` and `dropped` so the
  report can say which of the three it is.

  **`RMD021` promised a clock it has never watched.** The guard patches `Math.random`,
  `crypto.randomUUID` and `crypto.getRandomValues`, and deliberately nothing else — the platform reads
  the clock behind your back, so a guard on it reports calls the app never made. The title said "A
  clock or a random number" and the fix was half about clocks. It now names the randomness it watches,
  the FOUR phases it fires in (render, `@compute`, a `@memoized` builder, a hook's props
  callback — the prose named two), and where the clock is actually caught. `clock-read-while-rendering`
  says the same from its side, because the client-only clock gap is the reason that rule exists.

  **`RMD010` named a parent it deliberately does not report.** "list elements" were in its list of
  parents that accept only specific children; `<ul>`, `<ol>`, `<dl>` and `<p>` are exactly the ones it
  stays quiet about, because the parser leaves an unknown element inside them alone.

  **`RMD033` gave one outcome for three.** A function is dropped, a bigint or a cycle never reaches the
  blob, and a `Date` or a `Map` SURVIVES as a string or a plain object — so the field is not missing,
  it is the wrong type, and the first method call on it throws.

  **`RMD003` never mentioned its own opt-out** — `createContext(value, { optional: true })`, for a
  context whose default is the answer rather than a stand-in.

  **`RMD015` and `RMD004` called a hook's props "options"**, a word that appears nowhere else in the
  API, the docs, or the `TypeError` the write throws.

  Three stale docstrings went with them: a props write "is always a no-op" (it throws in every build),
  `RMD023` needing "at least one component" (it asks any unkeyed element for a key), and the two above.
  A fix text is prose nothing asserts, so `DiagnosticProse.test.tsx` now pins the claims that can be:
  the rename styles the element, `Date.now()` raises no `RMD021`, and a default host in a `<ul>` is
  silent while one in a `<table>` is not.

- 22f1b07: `fresh-object-in-props` follows the value instead of matching the shape.

  The literal written straight into the attribute is the shape people write first, and it is not the
  one that survives a refactor. Both of these were planted and both were silent:

  ```tsx
  const conf = { dense: true }; // one line up, inside render()
  return <Row conf={conf} />;

  return <Row conf={makeConf()} />; // a helper in another file
  ```

  They are the same object built at the same moment, and both are now reported. A call is followed
  through the import and only reported when what comes back is a literal built INSIDE it, so a helper
  handing back an object it holds stays silent — as does a module-level `const`, which is the
  documented fix. A `@compute` is never followed, because caching is the whole of what it does.

  A helper that calls a helper is followed the same way, however deep it goes — pinned at twelve hops,
  which is further than anyone writes on purpose. A low bound looks careful and is not: a chain the
  walk abandons is reported as nothing at all, and nothing is what a clean codebase looks like. What
  stops a runaway is the cycle guard, so mutual recursion terminates and reports nothing.

  A branch is followed on both sides, which is where the most common shape of all lives:
  `conf={this.conf ?? { dense: true }}` hands the child a fresh object on every render where the left
  is missing, and so does an arm of a ternary. A helper written as an arrow is the same helper — `const makeConf = () => ({ dense: true })` was a
  plain miss until it was planted — and a cast does not hide it either.

  The report now quotes the line — `<Row conf={local}>`, `<Row conf={makeConf()}>` — and names the
  function the literal is actually IN, rather than printing `{…}` for everything. For a chain that is
  the innermost one: `conf={chainConf()}` already says `chainConf`, and where the reader needs to go
  is `level3`.

  It is also the one element rule still asked about an element that SPREADS. The family-wide silence
  is about an attribute that is MISSING — `<img {...rest} />` may well carry its `alt` — and that
  does not transfer: a spread cannot un-build an object literal written beside it. What it can do is
  overwrite it, so order decides. Written after the last spread, nothing can take the prop away and
  it is reported; written before one, it may never reach the child and this stays quiet.

  A literal inside a `map` or a `list` callback is reported in its own words: it is built once per
  ROW, so no row can be skipped when the list renders again. The advice differs there too — a value
  derived from the row cannot be lifted to a constant, so what is offered is `@StableProps` on the row
  component, or a `@compute` that maps the array once. The row itself, `conf={row}`, is as stable as
  the array holding it and is never reported.

- 252bc6e: New rule: `fresh-object-in-hook-props` — an object or array literal written into a hook's props,
  which is where a context value is written.

  `fresh-object-in-props` reports the literal a PARENT writes in JSX. This is the same fault one door
  along: `this.use(ThemeProvider, () => ({ conf: { dense: true }, tick: this.tick }))`. Every prop is
  a signal, so a rebuilt object is a changed prop — and for a Provider that reaches every consumer of
  the key, however far down the tree it sits.

  Measured in `ContextValueIdentity.test.tsx`, counting a consumer that reads only `conf` while a
  DIFFERENT key of the same provider moves three times:

  | the callback                                                 | renders after mount | after three changes |
  | ------------------------------------------------------------ | ------------------- | ------------------- |
  | `() => ({ conf: { dense: true }, tick: this.tick })`         | 1                   | **4**               |
  | the same, with `@StableProps("conf")` on the provider        | 1                   | **1**               |
  | `() => ({ conf: { dense: true }, tick: 0 })` — reads nothing | 1                   | **1**               |

  The third row is the shape of the rule. The props callback is cached on the signals it read, so one
  that reads none is called once at mount and the literal inside it keeps one identity for the life of
  the component — which is not a fault, and is what `apps/playground-core` relies on for its query
  defaults. So the rule asks for two things and needs both: a literal among the props, and a reactive
  read that can make the callback run again — `@state`, a `@compute`, anything under `this.props`, or
  a field holding another hook. All four are measured; a read it cannot classify is silence.

  Two more silences: a key the hook DECLARED with `@StableProps` (a Provider takes the declaration on
  a subclass, since `createContext` hands back a class), and any hook reached through a `.d.ts` —
  declaration files carry no decorators, so `@StableProps` on an installed hook is invisible from
  outside its own source, and a rule that cannot tell a missing declaration from an invisible one may
  not report either.

- 48f8389: New rule: `fresh-value-from-a-watch-selector` — a `@watchProp` selector that builds the value it
  returns.

  A selector's value is compared with `Object.is`, so an object or an array built inside the selector
  is never equal to the one before it and the watcher fires on every props change, with `previous` and
  `next` holding the same contents. Measured in `WatchSelectorIdentity.test.tsx`, two watchers on one
  child while an UNRELATED prop moved three times:

  | the selector          | fired |
  | --------------------- | ----- |
  | `(p) => p.q`          | **0** |
  | `(p) => ({ q: p.q })` | **3** |

  `q` never changed once. `@watchProp`'s own documentation warned about this shape; nothing reported
  it.

  **It is an error rather than a warning**, unlike `fresh-object-in-props`, which costs work while the
  page stays right. A `@watchProp` body is where an app refetches, resets a form, cancels a request —
  firing it when nothing changed is wrong, not slow. And there is no reading of a built selector value
  that was intended: one that always says CHANGED is one that does nothing, which is why `arrow-fields`
  is an error for the same sentence.

  Two silences: a selector that READS an object (`(p) => p.filter`) hands back whatever the parent gave
  it, and if the parent rebuilds it that is `fresh-object-in-props` at the call site; and a
  subscription's ARGUMENTS, which look like the same shape and are not — a decorator's arguments are
  evaluated once when the class is defined, measured as one object shared by every instance for the
  life of the class, so this never asks about them.

- 9877247: `fresh-object-in-props` knows about `@StableProps` now.

  An object literal in a component's props is a fresh reference every render — unless the component
  that receives it has declared the prop a value, and then the framework compares it by content and
  hands the child back the identity it already had. The literal at the call site is the documented way
  to write it at that point, so reporting it would be reporting the fix:

      @StableProps("conf")
      class Settled extends Component<{ conf: Conf }> {}

      <Settled conf={{ dense: true }} />     // no longer reported
      <Row conf={{ dense: true }} />         // still reported — Row declares nothing

  It is the same move `RMD020` makes at runtime, for the same reason: the two nets have to agree about
  what the framework now supports.

  The declaration is RESOLVED through the checker rather than matched by name — a class whose name
  happens to equal this one's is a different class — and read through the heritage chain, because
  `@StableProps` merges along it: a base that declares `conf` settles it for every subclass.

  `ElementContext` carries `resolve` for it, which every other context already had.

### Patch Changes

- c52a3ef: **Breaking: an event handler is now `on` plus the event's own name — `onclick`, not `onClick`.**

  The old spelling was never the camelCase it looked like. Handlers were derived from the element's
  `on…` PROPERTIES and renamed to `` `on${Capitalize<name>}` ``, and the DOM's event types are single
  lowercase tokens — so what the types actually offered was `onMouseenter`, `onKeydown`,
  `onDblclick`. The natural `onMouseEnter` was a hard error and the accepted spelling was one nobody
  would guess. It survived unnoticed because every event this repository writes is ONE word, where
  capitalising the first letter happens to give the right answer.

  Handlers come from the DOM's event MAP now. Nothing is capitalised, so there is nothing to get
  wrong, and the old spellings are refused with a message naming the one to use.

  **Three things this fixes.**

  - **Five standard events had no spelling at all.** `focusin`, `focusout`, `compositionstart`,
    `compositionupdate` and `compositionend` have no `on…` property, so the old mapping could not see
    them: `onFocusIn` was a type error and lowercase `onfocusin` fell through to `any`. They are
    ordinary — `focusin` is what you reach for BECAUSE `focus` does not bubble, and `composition*` is
    IME input. All five are typed now.
  - **`on:` attaches a name verbatim**, for the events `on…` cannot spell — a custom event with a
    dash, which is what a web component dispatches by convention. `<x-thing on:my-event={…} />`.
    Before this, `on-my-event` typechecked and attached a listener for `-my-event`, an event nothing
    in the world dispatches. Measured: the handler never ran.
  - **Every handler's parameter is typed from the event map**, so `onclick` hands you a
    `PointerEvent` and `oncompositionstart` a `CompositionEvent`, with no annotation.

  **What to change.** Lowercase the event props on host elements: `onClick` → `onclick`,
  `onSubmit` → `onsubmit`, `onInput` → `oninput`. A component's own props are untouched — an
  `onSelect` you declared is yours and keeps its name. `@ramonda/form`'s `bind` follows the same
  rule: `CommonBind.onInput` and `.onBlur` are now `oninput` and `onblur`, which matters only if you
  read them off `bind` by hand rather than spreading it.

  The compiler finds every one of them: a camelCased event name is refused, and the error carries the
  spelling to write.

  **Two things found while checking the edges of this, both measured.**

  - **A stable handler was being re-attached on every render.** The node's listener map was keyed by
    the event TYPE and the previous attributes were rebuilt from it as `on` + the type capitalised —
    which matched the old spelling exactly and nothing at all after it, so every listener on the page
    was removed and re-added on every pass. It is keyed by the attribute name now, so nothing is
    rebuilt and nothing can be ambiguous. Two renders of a button with two handlers: `adds: []`,
    `removes: []`.
  - **`@Host`'s props are typed now.** They were `Record<string, unknown>`, which made the host the
    one place a camelCase handler still attached quietly — and typing them found exactly that in this
    repository's own docs app. A `@Host` tag is also constrained: a platform element from
    `JSX.IntrinsicElements`, or a custom one, which by the platform's own rule carries a DASH.
    `<my-widget>` can be upgraded; `<mywidget>` is an `HTMLUnknownElement` for ever and is usually a
    misspelling.

  **`@onElement` takes the event's own name and always did**, so `@onElement("my-event")` has always
  worked. What it now refuses is the two namings that are PROVABLY not an event — with the fix in the
  error, the way the JSX types do it:

  - `@onElement("onclick")` — the JSX attribute written where the event belongs, and the likelier
    mistake now that the attribute IS `onclick`. Refused only when what follows `on` is an event this
    target has, so a custom `online` or `once` is untouched.
  - `@onElement("MouseDown")` — `addEventListener` is case-sensitive, so it never fires. Refused only
    when the lower-cased name is one of this target's events, which leaves a custom `DOMSomething`
    alone.

  Everything else still passes, and that is the design rather than a gap: a custom event may be called
  anything, so `clik` cannot be refused without refusing `save` and `my-event` with it.

  **`@ramonda/check`** kept up in two places, both of which would have gone quiet:
  `client-only-request-read` recognised a handler by the CAPITAL after `on`, and
  `click-with-no-keyboard-path` looked for `ondoubleclick`, which is not a DOM event and never
  matched anything.

- a3bdc67: The accessibility family reads a value that was declared elsewhere.

  `element.ts`'s `attr` read a string literal and nothing else, and **every element rule reads through
  it** — so `role={ROLE}` where `const ROLE = "button"` was invisible to forty rules at once. Measured
  with `fixtures/one-hop`: `unknown-role`, `positive-tabindex` and `link-without-a-destination` all
  reported the literal and went silent one hop away. `numberAttr` had the same hole for `tabIndex` and
  `aria-level`, and `lossyIn` had it for `@persist cache = makeCache()`.

  **A branch and a call are deliberately not followed here**, which is the opposite of what the
  fault-finding rules want. `alt={ok ? "" : "a cat"}` has no single answer, and taking the first arm
  would report an element that is right half the time. `fresh-object-in-props` follows both, because
  there ANY path that builds is the whole fault. The shared walk now takes both as parameters.

  `arrow-fields` was on the same list and is not a gap: it reports a function LITERAL in a field and
  leaves a field initialised from a call alone on purpose, because `debounce(this.save, 200)` is
  legitimate and a walk that followed the call would report the arrow inside `debounce`. That decision
  now has a test, so it is not undone by someone working down the list.

  No new findings in `apps/docs`, the three playgrounds, or `router`, `query` and `form`.

- 62e44db: Four shapes the element rules had an opinion about and did not recognise. None is exotic; each was
  planted and measured, and each has its opposite in the fixture — the shape that must stay silent is
  what says a rule got sharper rather than louder.

  **`aria-hidden` written as a boolean.** `aria-hidden`, `aria-hidden={true}` and `aria-hidden="true"`
  are one fact spelled three ways, and the framework renders all three the same. Only the string was
  read, so `<button aria-hidden>` hid a focusable button and was reported by nothing. A shared
  `trueAttr` reads all three, and `aria-hidden="false"` is still not a claim.

  **A link whose only content is hidden.** `<a href="/x"><span aria-hidden="true">★</span></a>` is full
  in the DOM and a blank row in the list of links a screen reader builds — the icon-only link, which
  is the commonest way to write this fault. `empty-heading-or-link` is about the accessibility tree, so
  it asks about that tree now: every child hidden by a LITERAL claim, and nothing naming the link. One
  readable word beside the icon, or a component child it cannot see into, and it says nothing.

  **An index key on a COMPONENT row.** `row-without-a-key` already asks a component for a key, for the
  reason that decides both — a component is what HOLDS the state that lands on the wrong row — while
  `index-as-key` skipped them, leaving the family disagreeing about the same list and the rule silent
  where the key matters most.

  **A heading that is not a tag.** `role-missing-required-aria` already asks a `role="heading"` for its
  `aria-level`, so `heading-skips-a-level` reading levels off tags alone left the two disagreeing about
  the same element. It reads the accessibility tree's answer now: `role="heading"` counts, an
  `aria-level` wins over the tag, and a written role wins over the tag entirely — so an
  `<h2 role="presentation">` is out of the outline. A heading whose level cannot be read breaks the
  chain rather than being stepped over, exactly as one that may not be there does. The report quotes
  what is on the line, because calling a `<div role="heading" aria-level={3}>` an `<h3>` would send a
  reader looking for a tag that is not there.

  Nothing new is reported in this repository's four applications.

- 70b134b: **`@memoizedHandler` is `@memoized`.** It caches a value as readily as a handler, and the old name hid
  that from the people who needed it.

  Measured: `@memoized cfg(id) { return { id } }` returns the same object for the same argument, one build.
  Nothing ever restricted it to functions, and nothing warned — so a row that needs a stable object had the
  same problem and the same answer, under a name that said `Handler`.

  **The cost of the old name was not confusion, it was non-discovery — and the diagnostics proved it.** The
  `object` verdict of `RMD020` and `RMD022` advised "a `@compute` getter, a field, or a module constant".
  None of those can hold one value PER ITEM: a `@compute` belongs to the component, not to the row. So a
  developer whose object was rebuilt per row was given advice that cannot work, and the only tool that works
  was called something else. Both advices now name `@memoized` for that case.

  `/concepts/events` says it too — the section is "A handler, or a value, per item", with the object example
  and the reason nothing else reaches it.

  **Migration is a rename and nothing else:** `@memoizedHandler` → `@memoized`. The behaviour, the cache
  key, the eviction and the tracking are unchanged. `@ramonda/check`'s reports and advice use the new name,
  and `unkeyable-memoized-argument` keeps its id — it already read "memoized".

- d493c19: An audit of the rule set, and one thing it found: **"what is this member called" was answered in seven
  places, under two names.**

  Four rules held a named function for it — `memberName` in `render-reach`, `server-env-in-shared-code` and
  `row-reads-a-plain-field`, `nameOf` in `stale-field` — and three more wrote the expression inline. Both it
  and `decoratorName`, which had two copies, now live in `syntax.ts`, whose whole description is functions
  that "answer one question about a node and take no context to do it".

  Nothing had drifted yet. What makes this worth doing rather than tidying is that the last two copies of
  one judgement DID drift, within a day of each other, and the second one was wrong in four ways — each copy
  passing its own fixture the whole time. `scripts/dev/find-duplicate-helpers.mjs` finds the next one in a
  second; run it after adding a rule.

  **The consolidation itself exposed a live one.** In `interval-with-no-cleanup`, the member's name and the
  interval variable's name are both natural to call `named`, and renaming the outer one to match its new
  import made `member:` carry the interval's name instead. Only the `| undefined` on one of them made it a
  type error rather than a wrong report.

  **What else the audit checked, all clean:** every one of the 56 rules is named by a test; no rule mentions
  an `RMD` code in prose that it should have declared as `alsoReportedAs` (all three mentions are
  contrasts — `RMD010` watches something narrower, `RMD043` a different case, `RMD020` a consequence); every
  rule's tests bound their output rather than only asserting positives; the one rule with a `needs` gate can
  open it; and no two rules report one line as the same fault — the sixteen shared lines are dense fixtures
  where two independent faults sit together.

- aa03d76: `row-reads-a-plain-field` and `cached-read-of-a-plain-field` now share one judgement about which fields
  can go stale, instead of holding two copies of it.

  The two rules landed within a day of each other on separate branches, and the second copy was worse in
  four ways — all four found by running the older rule against the newer one's fixture:

  - a field written in the **constructor** was reported, though that runs before the first render;
  - the **memo pattern** — `if (!this.cache) this.cache = expensive()` inside `render()` — was reported,
    where advising `@state` advises a loop;
  - a field written in **`@destroyed`** was reported, after the last render, with nothing left to be stale;
  - and **`@persist` was treated as reactive**, which is a MISS rather than a false report: it carries a
    value across hydration without tracking it, so a row that shows one is exactly as stale as a row
    showing a plain field. The other rule reported that same field from its own side, which is what proved
    it.

  `rules/stale-field.ts` is that one judgement: which fields a cached reader can go stale on, and which
  writes count. A `@compute`, a hook's props callback and a stable `list()` row callback are three cached
  readers with one question between them. The rules stay separate, because the readers are found in
  different places and the fixes differ — a row can be made inline, a `@compute` cannot.

  No behaviour change to `cached-read-of-a-plain-field`: its 363 tests pass unchanged.

- d9304e8: The accessibility tables are read to REPORT, so a wrong entry reports correct markup and a missing
  one misses a fault. They were compared against machine-readable transcriptions of the specifications
  — `aria-query` and `dom-accessibility-api` — rather than read again.

  **Most of them were already right, and that is the useful half of the result.** Every ARIA role,
  every abstract role, every `aria-*` attribute, and every token set matches the specification exactly.
  Where the tables have extras — `comment` and `suggestion` as roles, `aria-colindextext` and
  `aria-rowindextext` — they are ARIA 1.3 names the transcription has not caught up with, and having
  them means not reporting valid markup.

  **`role-takes-no-name` reported correct markup on `<time>`.** It is named from AUTHOR in both
  transcriptions, and giving a machine date a human name is the documented use of the element:
  `<time datetime="2026-03-03" aria-label="3 March 2026">`. The entry is gone. `mark` stays on a split
  verdict, with the reason written down: `aria-query` transcribes the spec's characteristics table
  field by field and gives it `nameFrom: ["prohibited"]`.

  **`control-with-no-label` was missing three of HTML's labelable elements** — `meter`, `progress` and
  `output`. Each renders a value and nothing else, so without a name a reader is told "50%" with no
  word for what is at 50%. They are labelable exactly as an `<input>` is, and every way of naming one
  is the same way. `<button>` stays out on purpose: a button is named by what is inside it. The report
  says what a reader is actually told, which differs for a value and for an empty box.

  **`tag-needs-its-parent` was missing ruby annotation** — `<rt>` and `<rp>` belong directly inside
  `<ruby>` and nowhere else, now that `<rtc>` has been removed from the standard. `<area>` stays out
  for the opposite reason, and it is the shape worth remembering: it needs a `<map>` ANCESTOR rather
  than a `<map>` parent, so `<map><p><area /></p></map>` is legal and an entry would report it.

  Two omissions from `ROLE_REQUIRES` are now written down as decisions rather than left to look like
  oversights: `treeitem`'s `aria-selected`, which moved between ARIA 1.1 and 1.2 exactly as `option`'s
  did, and `combobox`'s `aria-controls`, which points at a popup that does not exist while the
  combobox is collapsed. And the two token LISTS, `aria-relevant` and `aria-dropeffect`, are named as
  the values no closed set can judge without splitting them first.

- 6a2817a: The last of the audit: the id table, `duplicate-id` and `head-tags-collide`.

  **The id table could not see an id written in `@Host` props, and reported a working link as broken.**

      @Host("section", () => ({ id: "overview" }))
      class Overview extends Component { … }

      <a href="#overview">…</a>        // reported: "nothing in the project carries id=overview"

  That id is on the page and is in no JSX element, so the walk — which reads elements — never found
  it. The table reads a `@Host` props object now, under the same rules it reads an element by: a
  literal is an id, a template's head is a prefix, and an id it cannot READ silences the family
  exactly as an unreadable one on a host element does. The shape became likelier the day `@Host`'s
  props became typed as the element's attributes.

  **`duplicate-id` counted a COMPONENT's `id`, which is as often a datum as a DOM id.**
  `<ProfileCard id={user.id} />` hands it to `getProfile()` and it never reaches the document.
  `idTable` had already decided this for the other two rules and decided it the other way round, which
  is the point: adding a component's literal id to the set of KNOWN ids can only make a rule quieter,
  while counting it as a CLAIM on one can only make this rule louder. The safe direction differs
  because the reading does. Nothing is lost — a component's id reaches the document only by being
  written onto a host element, and that host element is in the source too.

  **Two `Head` hooks are not a collision, and that is now written down with the measurement.** They
  merge into the same map, so a `name="robots"` in each collides exactly as two in one list do — the
  document keeps one `<meta>` and it carries the LAST value. What differs is the reading: two entries
  in one array express nothing by being two, while two hooks express an override, which is how a base
  class sets a page's defaults and a subclass replaces one of them.

- 044b5d0: `row-reads-a-plain-field` read a single class body, so a row callback inherited from a shared base —
  showing a plain field declared on that base — was silent. One instance, one row, one stale value,
  and nothing said so.

  It was the newest rule in the package and the only one the heritage sweep had not been run against.
  Planted, measured, fixed: the callback is looked up nearest-first up the chain, and the field
  judgement is asked with the chain too.

  **`ModuleContext` carries `resolve` now**, which is what made it possible. A module rule reads a
  FILE, and the classes in it are still classes — a base's member is the component's member wherever
  it is written. The alternative was one rule reaching for the type checker on its own, which is not a
  shape this package has.

- d37539b: The render walk claimed "by any path" and followed one kind of call. Four more were planted, and
  every one of them reported nothing:

  - an arrow **field** — `helper = () => { … }` — which is a property rather than a method, so the
    lookup for a `MethodDeclaration` ended the walk without a word. Not an exotic shape: it is the one
    `arrow-fields` exists to talk about, so a codebase that has any at all has them being called.
  - a **getter**, which is read rather than called. `{this.total}` runs `get total()` right there, so
    a clock read or a state write inside it happens during the render exactly as one in a method does.
  - **`super.method()`**, whose callee is not `this`.
  - a **static**, `App.helper()` — walked with `this` meaning the constructor rather than the
    instance, so a write through it is nobody's state and only what does not depend on `this` counts.

  The runtime reports all four, because `renderPhase.component` is set whatever the path was. So this
  is `state-written-while-rendering` and `clock-read-while-rendering` catching up with what they
  already said they did — they are the two rules built on the walk, and any rule built on it later
  inherits the four paths for nothing.

  **`cached-read-of-a-plain-field` had the same gap, one hop away.** Its claim is that a cached reader
  READS an ordinary field something writes after the first render, and it read the reader's own body:

      private priced() { return this.rate * 2; }        // `rate` is a plain field
      @compute get total() { return this.priced(); }    // reported nothing

  The cache is stale in exactly the same way — a `@compute` tracks the signals read while it
  evaluated, wherever they were read. It follows `this.method()` now, bounded and cycle-guarded, and
  `this.` only: a free function has no `this`, so there is no field of this component's for it to read.

  Nothing new is reported in this repository's four applications — the shapes are correct code there —
  and the fixtures prove each path can speak.

- 96b46f5: Three more rules asked how far they look, on the axis that has found something every time: what a
  `this.helper()` hop, and a helper in another file, cost the claim.

  **`server-env-in-shared-code` had a FALSE POSITIVE, on the shape its own advice recommends.** Its
  stance for a member nothing in the class references is "it may be called from anywhere, so it is not
  excused on silence" — which is true of a PUBLIC member and not of a `protected` one, whose callers
  can only be this class chain. And the chain is walked upward, never down. So a base holding
  `protected fromDb() { return process.env.DATABASE_URL }`, called only from a server-only lifecycle
  in the subclass, was reported as browser code — as an ERROR. Measured with a plant.

  An unreferenced `private` or `protected` member is excused now. A `private` one with no reference in
  its own class cannot be called by anything at all; a `protected` one can only be called by a
  subclass this cannot see. Everything referenced is judged exactly as before — a private helper a
  `render()` calls is still reported.

  The miss this leaves is written into the rule rather than left to be discovered: a subclass calling
  such a helper from `render()` is a real fault and is reported by nothing.

  **`unwatched-fields` had the same false positive, and it is an ERROR too.** A hook belongs to the
  INSTANCE, so a base's `this.use(Field, …)` subscribes the subclass exactly as its own would — and
  reading one class body made a subclass that reads what its base watches a reported fault on working
  code. The watch is looked for up the chain now.

  **`unkeyable-memoized-argument` missed every call to an inherited handler.** A `@memoized` on
  a base is the subclass's handler, on the same instance and with the same cache, so
  `this.pick({ id })` down there THROWS `RMD047` at runtime exactly as it would up here — and nothing
  said so. Calls are matched against the chain now, while the DECLARATION half stays where it is
  written, so a base's unkeyable parameter is reported once rather than again for every subclass.

  **`browser-url` and `dom-writes` reach a helper on the class and stop at the file boundary**, and
  that is now a decision on the record instead of an accident. Both were measured: a read or a write
  one `this.method()` away IS found; a utility in another file is not. Following the import would name
  a component that did not write the line, in a file it does not own, once per caller — these reports
  carry no path to say otherwise, which is exactly why the two rules that DO follow imports have one.

- 1b8dbbd: `unkeyable-memoized-argument` follows the argument instead of matching its shape.

  Four shapes were planted and all four were silent, and every one of them throws `RMD047` at
  runtime:

  ```tsx
  const local = { id: row.id };
  this.pick(local); // an object one line up
  this.pick(keyFor(row.id)); // one a helper returns
  this.pick(SHARED_KEY); // a module-level const
  this.pick(open ? { id } : "k");
  ```

  The rule stated its boundary as "an identifier could hold a string, and asking what it holds is a
  question about types". That is true of an identifier nothing declares; it is not true of one
  declared two lines up as `{ id }`. The walk goes to the DECLARATION behind a name, never to its
  type, so `this.pick(row)` and `this.pick(row.id)` still look the same from here and both stay
  silent.

  A module-level `const` counts here and not in `fresh-object-in-props`, which is the one place the
  two questions part: that rule asks whether a value is REBUILT, so a module const is the fix; this
  asks what a value IS, and an object built once at module scope is still an object.

  The walk itself moved to `follow-value.ts`, shared by the four rules that now ask it.

- 657915e: What the review of this branch found — four defects, three of them the same shape: a spelling the
  audit had already handled, planted again in its other form.

  **A subclass OVERRIDING a base's method had both bodies walked**, so a clock read in the version that
  never runs was reported. Pre-existing, and widened by this branch's `super.` support. The lookup
  takes the NEAREST declaration now, which is how JS resolves a method — and `super.` starts at the
  BASES, which is the whole meaning of the keyword.

  **A static was matched by NAME**, so a class whose name happened to equal the component's would have
  been walked as if it were the component. It is resolved now: this package does not guess about which
  declaration it is looking at.

  **A `@Host` props callback with a BLOCK body** — `() => { return { id: "x" } }` — was not read, so the
  id it writes was missing from the table and the link to it was reported as going nowhere. The
  concise body had been fixed; this is the same fault in its other spelling.

  **A `#private` member cost every rule something, and all of it silent.** The shared `memberName`
  treated `#field` as unnameable — true of a computed name, and not of this one — so
  `server-env-in-shared-code` reported one as `(anonymous)` and could not excuse it, the render walk
  never followed `this.#helper()`, and `stale-field` could not see one go stale. A `#` member also
  carries no `private` MODIFIER, which is what the new excuse read, so the `#` spelling of an excused
  helper was reported while the `private` one was not. Both fixed: `#name` is a name, and `#` is
  privacy the stronger way — a cast walks straight through `private` and cannot touch a `#`.

## 0.10.0

### Minor Changes

- 2deb04b: A context consumed above its provider is reported — RMD057 at runtime, `context-consumed-above-its-provider` before anything runs.

  A consumer resolves its channel ONCE, when it is constructed, and hooks are constructed in
  field-declaration order. So on a component that also provides, which value the consumer reads is
  decided by which of the two lines is written first. Measured on a component under an ancestor
  provider: `"ancestor"` with the consumer declared first, `"mine"` with the provider declared first.
  Two field declarations, and nothing said so.

  **Only the consumer-first order is reported, and that is a measurement rather than a preference.**
  Reporting both fired **14 times across `@ramonda/query`'s own tests** — every one of them on
  `this.use(QueryClientProvider)` followed by `this.use(Query, …)`, which is mount-a-client-then-query-
  on-it and the arrangement the packages are built around. Reporting only the consumer-first order fires
  **nowhere in this repository**. Both directions are pinned: silencing the check fails the report test,
  and reporting the other order fails the provide-then-use test.

  **A warning rather than an error, in both places.** The arrangement has a legitimate reading — read
  the outer value and provide a derived one, which works only in this order — as well as a mistake, a
  consumer written one line too early. Nothing can tell them apart, so it says what it found and leaves
  the devtools panel's alert alone.

  The consumer's one-shot lookup is deliberate and is not what changed: it is what lets RMD003 report
  when a consumer MOUNTS rather than on its first read, including down a branch nobody clicked.

  **The rule and the diagnostic reach different cases, on purpose.** The rule speaks before anything
  runs, including for a component nobody has opened, and it sees only a pair written directly — `const
[P, C] = createContext(…)` with both halves handed to `this.use` in one class, resolved through the
  `BindingElement` each name came from, so an import alias is transparent and two contexts of the same
  shape stay two contexts. A provider wrapped in a hook of its own, the way `QueryClientProvider` wraps
  one, is invisible to it and is what the runtime diagnostic catches. Nested hooks are included there:
  a hook is handed its owner's runtime, so a consumer inside a hook inside the providing component is
  the same ambiguity.

  **And a sentence in the documentation that this proved wrong.** `/composition/context` said the
  reversed order "reads the default forever, and says so with `RMD003`". That is true only with no
  provider on any ancestor; with one, it reads that ancestor's value and RMD003 does not fire — which is
  the whole reason RMD057 exists. Corrected, with the way out that does not depend on the order at all:
  read through the provider hook, which reads as well as publishes.

- aa6c3c9: `client-only-request-read`: a request read on a path that only runs in the browser, where the value it names can never be.

  Closes the gap item 26C measured on 2026-08-17. A component reading a request key in a handler **bakes
  cleanly under a static build** — `html` present, no `blockedBy` — because the read never runs during
  the render, so the build's per-request poison is never touched. The page ships, and the browser reads
  `undefined` and reports RMD025. The build was silent although the outcome was certain in advance.

  **Why this is provable rather than a suspicion.** The client's request scope carries exactly the live
  `url`, an empty cookie map, empty headers, and the values whose keys opted into `exposeToClient` and
  which the server seeded. So three reads are certain to find nothing there:

  - `cookies.get(…)` / `cookies.has(…)` — a cookie is the server's, and an httpOnly one is invisible to
    JavaScript in any case, so nothing can ever expose it.
  - `headers` — the same.
  - `get(key)` where the key resolves to a `requestKey(…)` declaration that did not opt in.

  The rule is not asking whether a value will be there; it is naming one that cannot be.

  **Client-only is read off the framework, not guessed.** `@updated` is skipped for `env === "server"` in
  `flushUpdated`; `@interval`, `@timeout`, `@onWindow`, `@onDocument` and `@onElement` are built on
  `createSubscriptionDecorator`, which attaches an effect, and `runComponentEffects` returns immediately
  on the server; `@deferHydration` belongs to hydration, which only happens in a browser;
  `@created`/`@mounted`/`@destroyed` count only when written `{ env: "client" }`. Plus a JSX event
  handler — an arrow inside an `on*` attribute, or a method whose every in-class reference is one.

  **What it will not say, and each silence is a decision.** A `shared` lifecycle, which is the DOCUMENTED
  way to read the request and would otherwise be reported as the fault it fixes. An exposed key, because
  whether the server seeded it is runtime. A key it cannot resolve to a `requestKey` — unresolved is not
  the same as unexposed. `url`, which is read live from `location` in the browser. And a handler that is
  also called from a shared lifecycle, since one of its callers runs on the server.

  Measured for false positives before shipping, the same way the last rule was: **zero hits across
  `apps/docs`, both playgrounds, and query, router and form.** The fixture holds nine faults and nine
  correct arrangements, and the test asserts both halves of each report — why the value is absent and why
  the line only runs where it cannot be.

  `/ssr/request` now says so where a reader would look, next to `exposeToClient`.

- c2324a9: A new rule: `access-key`.

  `accessKey` binds a character to an element, and the character is not the page's to give. Browsers
  already bind most letters, and so does every screen reader — the software of the people most likely
  to be using keyboard shortcuts at all. One page's `accessKey="s"` overrides that binding, on that
  page only, with nothing to discover it by and no way to switch it off.

  It also cannot be got right, which is what makes it a rule rather than a preference: the modifier
  differs by browser and platform, the conflicts differ by screen reader, and nothing announces the
  binding — so the page cannot even tell the reader the shortcut is there. Where a shortcut really is
  wanted, own it: a key handler the page documents on screen, which can be listed, chosen around the
  common bindings, and turned off.

- 9b905c3: An `async` lifecycle that rejects now says so — at build time and at runtime.

  **The finding.** An `async` `@created` or `@mounted` that rejects is not caught by an error
  boundary, reports nothing, and becomes an unhandled rejection. Measured against a boundary that
  catches the synchronous version of the same throw:

  | lifecycle                | boundary catches                                 | reported    |
  | ------------------------ | ------------------------------------------------ | ----------- |
  | sync `@mounted` throws   | yes — the fallback renders                       | —           |
  | `async @mounted` rejects | **no** — the page renders as though it succeeded | **nothing** |

  `@mounted async load()` fetching data is a documented pattern, so this is the commonest async path
  there is: the fetch fails, the `@state` it meant to fill stays at its initial value, the empty state
  shows, and nothing anywhere says the method ran and failed.

  **The boundary not catching it is deliberate and has not changed.** The rejection arrives at an
  arbitrary later moment, when the page is already interactive and there is no render left to fail;
  replacing what the reader is using with a fallback then is the worse outcome. What changed is the
  silence.

  - **`RMD059`** reports it at runtime, naming the component, the member and the phase. The handler
    is **development-only** and the original promise is returned untouched, so the server's work drain
    sees exactly what it saw before. In development the report replaces the raw unhandled rejection
    and carries more than it did: the component, the member, the lifecycle, the fix text, and the
    error object itself — `diagnose` logs `data` raw, so the stack is one expand away. A production
    build attaches nothing at all and the rejection surfaces exactly as it always has.
  - **`unguarded-async-lifecycle`** reports it before it ships: an `async` lifecycle that awaits with
    no `try` and no `.catch` anywhere in its body. Zero reports across every app and package here.

  The rule is deliberately coarse about what counts as handled — any `try`, any `.catch`. Whether the
  `try` actually covers the awaits is a control-flow question, and being wrong about it means
  reporting a method that handles its own failure, which is the one kind of mistake this package
  treats as fatal. A method that never awaits is not reported either: it can only throw
  synchronously, and that the lifecycle runner already catches.

  The fix both of them point at is the same, and it is not a bigger boundary: catch it where it
  happens and put the failure in `@state`, which is the only way to tell the reader anything.

- c0f23e5: A new rule: `aria-hidden-on-focusable`.

  `aria-hidden` removes an element from the accessibility tree. It does **not** remove it from the tab
  order, and those are two different lists — so `<button aria-hidden="true">` is still tabbed to,
  still focused, and at the moment it takes focus there is nothing to announce. The keyboard lands
  somewhere the page insists is not there.

  Reported when `aria-hidden="true"` is written on an element that is still focusable: a `<button>`,
  `<select>`, `<textarea>`, `<summary>`, `<iframe>`, an `<input>` that is not `type="hidden"`, an
  `<a>` that has an `href`, or anything at all carrying a `tabIndex` of zero or more.

  It stays quiet on the shape that is correct — `aria-hidden="true"` beside `tabIndex={-1}`, which is
  the documented fix — and on any value it cannot read as a literal.

- 9ef4b4f: `async render()` is now reported statically as `async-render` and at runtime as **RMD060**.

  **Why, when the type system already refuses it.** Because a type is a defence only while nobody
  casts it away, and this one is defeated by a single comment. Measured:

  | written as                                            | `tsc`            |
  | ----------------------------------------------------- | ---------------- |
  | `async render()`                                      | TS2416 — refused |
  | `render = async () => …`                              | TS2416 — refused |
  | `async render()` under a `@ts-ignore`                 | **compiles**     |
  | `async render()` on a base class loosened by one cast | **compiles**     |

  Two of the four ship, and what ships is not a graceful failure. Measured by running it: the diff is
  handed a promise where a node belongs and throws `TypeError: component is not a constructor` from
  inside `DiffAndMerge` — a stack of framework frames naming neither the component nor `render()`.

  The rule is an **error** rather than a warning, which departs from "a new rule is a warning first".
  No `async render()` is correct, so nothing correct can be reported, and the alternative to failing
  the build is that same `TypeError` in somebody's browser.

  RMD060 is raised in development from where `render()`'s own return value is still in hand, before it
  is wrapped in a host element — asked one level up, the question cannot be asked at all, because the
  wrapper is a node whatever is inside it. Production is unchanged.

- c583271: A new rule: `attribute-that-does-nothing`.

  The second net under the JSX types, which now refuse these six names at the call site. A type is a
  defence only while nobody casts it away — this catches the `@ts-ignore`, the loosened base class,
  and the file with no types at all, where the attribute still renders and still does nothing.

  Matched case-insensitively, because the fault does not depend on the capitals: `acceptcharset`
  written in full lowercase passes the types through the index signature and is exactly as dead as
  `acceptCharset`.

  Only host elements are asked. A component's props are its own business, not the document's.

- 674e054: A new rule: `cached-read-of-a-plain-field` — the static half of `RMD027`, and of a `@compute` fault
  that has no runtime code of its own.

  A `@compute` caches and recomputes when something it **tracks** changes: state and props. A hook's
  props callback caches the same way — `this.use(Form, () => ({ schema: this.schema }))` is not called
  again on a render where none of the signals it read moved. An ordinary field is neither, so writing
  one invalidates nothing and both keep the answer they already had.

  Measured, with `@state tick`, a plain `rate` and `@compute get total()`:

  | step                                                     | on screen | truth |
  | -------------------------------------------------------- | --------- | ----- |
  | `rate = 10`, no render                                   | `0`       | `0`   |
  | `tick = 1` → renders                                     | `10`      | `10`  |
  | `rate = 100`, then an **unrelated** state change renders | **`10`**  | `100` |

  The last row is the fault and it is the bad kind: the page re-rendered, everything else on it
  updated, and this one value is the answer from before. Nothing throws.

  **One rule rather than two**, because the fault is one: the same set of fields, the same writes, the
  same fix. The runtime names the same root cause for the props-callback half — "most often a plain
  field standing in for state" — and two rules would have been two copies of every judgement about
  which writes count.

  Four kinds of write cannot make anything stale and are not reported: the constructor and `@created`
  (before the first render), `@destroyed` (after the last), and a write from inside the reader itself,
  which is the memo pattern where advising `@state` would be advising a loop. A field holding a hook or
  a function is not a plain field, and `this.use(Hook, someFactory)` is a value this cannot follow.

  Renamed from `compute-reads-a-plain-field`, which had never been released: the id was its claim, and
  the claim grew.

- 417689d: A new rule: `click-with-no-keyboard-path`.

  `<div onClick={…}>` works for a pointer and for nothing else. The element is not in the tab order, so
  it cannot be focused; not being focusable, Enter and Space never reach it; and with no role a screen
  reader announces it as text rather than as something to do. The control is simply not there for
  anybody not using a pointer, and the page looks entirely correct.

  Reported only when all of it is true at once: a non-interactive host element, a pointer-only handler
  (`onClick`, `onMouseDown`, `onMouseUp`, `onDoubleClick`), no key handler, no `tabIndex`, no `role`,
  nothing interactive inside it — and **content**.

  Two exclusions, and the second was found by running the first version rather than by thinking about
  it. A wrapper that widens an existing control's hit area ("click anywhere on the card") already has
  a keyboard path one level in. And an **empty** element is a backdrop or an overlay rather than a
  control: its click is a convenience beside Escape and a close button, and it announces nothing
  because there is nothing to announce. Both reports the first version made against this repository's
  own documentation site were exactly that, and both were correct markup.

  The line drawn is structural rather than a guess at a class name: an element with content presents
  itself as something to do, and this reports that a keyboard cannot do it.

- ed48658: Two new rules over the project subject: `control-with-no-label` and `named-only-by-a-placeholder`.

  Every other element on a page can be worked out from what is inside it. A control cannot: an
  `<input>` is an empty box, and the only thing saying whether it wants an email address or a postcode
  is its label. Without one a screen reader announces "edit, blank" and stops, voice control has
  nothing to say the name of, and the text sitting beside it — which looks like a label to anybody
  using a mouse — is attached to nothing. The form looks completely normal, which is why this survives
  review.

  It belongs to the project subject because one of the four ways to name a control is
  `<label htmlFor="email">` paired with `<input id="email">`, and those two are frequently not in the
  same render. The other three are local: a wrapping `<label>`, an `aria-label`/`aria-labelledby`, a
  `title`.

  **Why the second rule exists.** A `placeholder` really does give a control an accessible name, so
  calling such a control unnamed is false — and told they have "no label" for a field with a
  placeholder in it, somebody reasonably decides the checker is wrong and stops reading its output.
  The first version of `control-with-no-label` made exactly that mistake: it reported six controls
  across this repository and **every one was placeholder-only**, which the rule's own docstring already
  said would not be reported. The docstring was right and the code did not do it.

  So `named-only-by-a-placeholder` makes the accurate claim instead: the name exists **only while the
  field is empty**. Nobody sees that while writing a form, because a form is written empty — it shows
  up for the person interrupted halfway through, the person checking their answers before submitting,
  and anybody whose autofill just filled six boxes and cleared six explanations at once. A placeholder
  _beside_ a real name is a hint, which is its job, and is not reported.

  Silences: a control whose own `id` cannot be read (it cannot be matched against any `htmlFor`, so
  nothing about **that** control is knowable — a narrower silence than the family's, and
  `control-with-no-label` deliberately does not share the project-wide one). `submit`, `reset` and
  `button` inputs, named by their value. `hidden`, which is not rendered. `image`, which belongs to
  `unnamed-image`.

  One residual risk, stated rather than hidden: `<label><SomeField /></label>` names the control
  inside `SomeField` at runtime and nothing in that component's source shows it, so such a control is
  reported although it works.

- a7a592a: Environment variables: `RAMONDA_PUBLIC_` reaches the browser, everything else stays on the server.

  An app configures none of it. The Vite plugin sets `envPrefix`, the esbuild half emits the `define`
  entries, and the convention lives in one place — which is what `@ramonda/build` is for.

  **Only the public half carries a prefix.** The prefix IS the decision to publish, so it has to be visible
  in the name; a secret must never be one keystroke in a `.env` away from shipping. The server half is left
  alone because `DATABASE_URL` comes from the host — Docker, Fly, a CI secret — and the app does not get to
  rename it. Read the server side with `process.env.WHATEVER`, and the public side with
  `import.meta.env.RAMONDA_PUBLIC_WHATEVER`.

  **Three measurements decided the shape, and two of them contradicted the plan.**

  - Vite's `envPrefix: "RAMONDA_PUBLIC_"` inlines the public value as a literal and leaves a non-public
    `RAMONDA_*` as `void 0`, with the value nowhere in the output. **But `envPrefix` REPLACES Vite's default
    rather than adding to it**, so `VITE_*` stops being exposed — in `build` and in `dev`. That is kept, not
    worked around: one convention is the point, and the app finds out from the build.
  - **esbuild leaves an undefined `import.meta.env.X` as a live reference and creates no `import.meta.env`,
    so the read throws in a browser.** So the esbuild half defines the object as the floor _and_ each public
    name for literal inlining. The floor object is the trap in the whole feature — `JSON.stringify(process.env)`
    there would ship every secret the build machine had, so only `publicEnv()` may go in, and a test asserts
    the secret's value is absent under either shape.
  - **No leak through the SSR dev server.** Vite injects `import.meta.env` with only the prefixed names plus
    its own `BASE_URL/DEV/MODE/PROD/SSR`.

  **What the review of this branch caught, and the first one was a real bug.** `envDefines`'s floor object
  held only the public names, so `import.meta.env.DEV/PROD/MODE/SSR/BASE_URL` compiled to `undefined` in every
  esbuild build — and `@ramonda/query` and `@ramonda/form` both document `if (import.meta.env.DEV) { void
import("…/devtools") }` as the one line an app writes. Measured: that guard became `if (undefined)` and the
  panel never loaded, in exactly the arrangement the SSR template uses (Vite in dev, esbuild in production).
  The floor now carries all five, each from something the build already said rather than a guess: `MODE` from
  `NODE_ENV`, `DEV`/`PROD` derived from it so they cannot disagree, `SSR` asked of the caller because only the
  caller knows (the plugin reads `platform === "node"`), and `BASE_URL` as `/`. All five are overridable.

  The review also found that `server-env-in-shared-code` reported a helper reached only from a server-only
  lifecycle — the shape its own advice recommends once the read is factored out, at error severity, with no
  `ramonda-check-ignore` available to class rules. A helper is now excused when EVERY reference to it in the
  class sits in an already-excused member, iterated to a fixed point so a helper may call a helper; a helper
  also called from `render()` is still reported, because an excuse has to hold for every caller. And
  `process.env` is now asked of `context.resolve`, so a file that SHIMS `process` for browser code is left
  alone — the shim is the fix, and `browser-url` draws the same distinction.

  **Verified end to end in a real app build, not only per piece.** `apps/playground-ssr` builds with esbuild
  through both `ramondaOptions` and the plugin; with `RAMONDA_PUBLIC_SMOKE` and `RAMONDA_SMOKE_SECRET` both
  set, the client bundle carries the public value (2 occurrences), carries **no trace of the secret**, and
  has **zero live `import.meta.env.NAME` reads** left — so nothing is waiting to throw in a browser. That app
  writes its own `define` after the spread, and the env entries survive because it also installs the plugin,
  which merges after the options are assembled. It is the case `ramondaDefine` exists for, seen from the
  other side.

  **`ramondaDefine` is a function, not a key on `ramondaOptions`, and that is a deliberate shape.** A spread
  cannot refuse anything: a build writing its own `define` after the spread — which every build does, because
  `__DEV__` lives there — would silently drop the env entries. A key that is lost by writing the obvious thing
  is worse than no key. The plugin form needs none of this; it merges after the options are assembled.

  **`envPrefix` set by the app is REFUSED, not merged**, in `config` and again in `configResolved` — because
  Vite merges a plugin's config over the app's, so quietly returning that key would expose a different set of
  variables than the app asked for, which is the one mistake here that cannot be walked back.

  **And a rule that catches the migration, because the migration is where this bites.**
  `unexposed-env-read` reports `import.meta.env.NAME` for any name nothing exposes — a `VITE_*` left over
  from before, a name with no prefix, or `RAMONDA_` without `PUBLIC`, which is the one that most reads as if
  it should already work. It suggests the name to use, stripping the old prefix rather than nesting it.

  And `server-env-in-shared-code` closes the other direction: `process.env` read from a member the browser
  also runs. `process` does not exist there, so it is a `ReferenceError` on the page rather than an
  `undefined` — and a dev server may shim enough of `process` to hide it until the production bundle. The
  asymmetry with `client-only-request-read`, which asks the opposite question of the same decorators, is that
  **"not marked" means "the browser gets here"**: `render()` runs on both sides, so does a field initialiser,
  and `@created`/`@mounted`/`@destroyed` default to `shared`. Only `{ env: "server" }` excuses a member — and
  a bare `@created()` is the easy mistake, because it looks server-ish. A read at module scope is not judged,
  since a server entry legitimately has one and whether a module reaches the client bundle is a question about
  imports. `CLIENT_ONLY_DECORATORS`, `LIFECYCLE_DECORATORS` and the two questions moved to
  `rules/lifecycle-env.ts` now that two rules share them.

  `unexposed-env-read` is a **warning**, not an error, and the reason is a premise it cannot verify: the name
  is never exposed IF the project uses `@ramonda/build`'s Vite plugin. A Ramonda app on plain Vite still
  exposes `VITE_*`, and `needs: "@ramonda/build"` cannot gate it — `needs` is decided from what the program
  imports, and the only file importing that package is `vite.config.ts`, which both scaffolded tsconfigs leave
  out of `include`. So the premise is stated in the message rather than enforced, and the run is not failed
  over it. Within its premise it is one of the few rules here that is genuinely COMPLETE: it asks nothing about where a value came from or whether one was set, only whether the NAME —
  written on the spot — is in the exposed set. That answer does not depend on an environment or a `.env`
  file, so there is no path it has to go quiet for. The exceptions are the bundler's own five names, a
  computed key, and a site carrying `ramonda-check-ignore`. Zero hits across `apps/docs`, both playgrounds,
  form and query — and zero for `server-env-in-shared-code` across the same six.

  New: `PUBLIC_ENV_PREFIX` and `publicEnv(env)` from the main entry, `ramondaDefine(own?)` from
  `@ramonda/build/esbuild`. The `create-ramonda` SSR template's build script now calls `ramondaDefine`.
  Documented on `/reference/build`, including how to type the names your app reads so a typo fails the build.

- feb1917: A new rule: `fresh-object-in-props`.

  An object or array literal written straight into a component's props is **built during the render**,
  so the child is handed a different object every time — never equal to the one before it, however
  identical its contents. Props comparison cannot match, and the child renders again whenever its
  parent does, whether or not anything about it changed.

  Measured by counting a child's renders, with a parent whose state changes for an unrelated reason:

  | the prop                                    | after mount | after the parent re-renders |
  | ------------------------------------------- | ----------- | --------------------------- |
  | `conf={{ a: 1 }}` — a fresh literal         | 1           | **2**                       |
  | `conf={stable}` — the same object each time | 1           | **1**                       |

  So it is the literal and nothing else. This is the props side of `arrow-fields`: a value rebuilt per
  render that comparison can never match.

  A **warning**, because the page is right either way — the child renders again and produces the same
  output. What it costs is work, and it multiplies: a list of a thousand rows is a thousand children
  that cannot be skipped.

  `<div style={{ color: "red" }}>` is **not** reported. A host element hands nothing to a component, so
  there is no comparison to defeat, and only components are asked. `key` and `ref` are skipped too —
  the framework reads them itself rather than passing them on.

- f862261: A fifth subject — **the whole project** — and the first two rules over it:
  `fragment-link-to-nowhere` and `reference-to-an-id-that-is-not-there`.

  An id is written in one component and named in another: `<a href="#pricing">` in a navigation bar,
  `id="pricing"` on a heading three files away. No per-render or per-element subject can see both ends
  of that pair, which is what makes this a subject of its own rather than another rule family — and it
  is the only one that needs **two passes**, because the question is about absence and absence cannot
  be established from a file nobody has opened yet.

  **`fragment-link-to-nowhere`** — `href="#name"` where nothing carries that id. A fragment link is
  answered by the browser rather than a server, so a broken one fails with none of the usual signals:
  no 404, no network error, nothing in the console. The page just does not move. The people it costs
  most are the least likely to be in the room: a skip link is the first thing a keyboard reader uses,
  and the one nobody testing with a mouse ever presses.

  **`reference-to-an-id-that-is-not-there`** — `aria-labelledby`, `aria-describedby`, `aria-controls`,
  `aria-owns`, `aria-activedescendant`, `aria-details`, `aria-errormessage`, `aria-flowto` and
  `htmlFor`. These do not describe an element, they point at one; when the pointer resolves to nothing
  the attribute does nothing at all, silently. The report says what each one costs — a broken
  `aria-labelledby` leaves a dialog announced as "dialog" and nothing more; a broken `htmlFor` leaves
  the input unnamed and stops the label focusing it. `aria-labelledby` takes a **list**, and each id in
  it is checked on its own.

  Only **negative** existence is claimed at this scope. "Defined twice" is not a fault here — two pages
  may each have a `main` and are never in one document together; that stays `duplicate-id`, whose
  subject is one render.

  Three decisions about silence, and two of them were found by running it rather than by reasoning:

  - An `id` this cannot read **on a host element** silences the whole family: an author building ids at
    runtime has said that "defined nowhere" is not knowable here.
  - An `id` on a **component** does not, because it may be data. The first version went completely
    quiet against this repository's own documentation site over `<ProfileCard id={this.id} />` — a
    _profile's_ id, handed to `getProfile()` and never near the DOM. Nothing is lost by the narrowing:
    a component's `id` reaches the document only through a host element, which is in the source too.
  - A **spread** does not silence either, and that is the one accepted residual risk. Counting it was
    measured against this repository and would have switched off every rule in every project in it —
    four to sixteen spreading elements each, against zero unreadable host ids. A spreading element is
    still never asked about its own references.

  A template's literal head is used as a proof, not a guess: `` id={`row-${id}`} `` can only produce
  ids beginning with `row-`, so `#row-3` is not called missing while `#pricng` is.

- a1319ed: A new rule: `index-as-key`.

  `key={i}` is not an identity — it is the position, which is what the diff matched rows by before any
  key was written. So it changes nothing about how rows are found again, and it costs something
  specific: it silences `row-without-a-key`, and it reads to the next person as a decision somebody
  made.

  What it hides shows the moment the list is not append-only. Delete the first of ten rows and every
  row below keeps the key it used to have, so row 2's DOM is matched to row 1's data — a half-typed
  input, an open menu, a checked box, all one row off, and the page still looks right.

  Reported only when every name the key is built from is the callback's index parameter: `key={i}`,
  `key={String(i)}`, `` key={`row-${i}`} ``, `key={i + 1}`. A key that also carries something from the
  row — `` key={`${row.id}-${i}`} `` — is a real identity and is left alone.

  Only `.map` and `.flatMap` are looked at, because `list()` hands its callback one argument: there is
  no index there to reach for, which is the point of it.

- 754bcc8: A new rule: `link-without-a-destination`.

  The tag is not what makes a link — `href` is. Without a real one an `<a>` is not focusable, is not
  in the tab order, is not announced as a link, and does not answer the middle click, the context menu
  or the "open in new tab" that people use links with. It renders looking exactly like one, which is
  why it survives review: the page looks right, and only half the people using it can follow the link.

  Three spellings are reported, and the report says what each one actually costs rather than repeating
  one sentence: **no `href` at all** (usually an `onClick` where the destination should be),
  **`href="#"`** (a destination that is this page — that one IS focusable, so the fault is that every
  way of following it but a plain click goes nowhere), and **`href="javascript:…"`** (not a
  destination either, and the shape a Content Security Policy refuses first).

  Left alone: `href="#pricing"`, which is a real destination and the point of a table of contents; an
  `href` written as an expression this cannot read; and an `<a>` carrying an `id` or `name` and no
  `href`, which is the legacy anchor **target** — markup doing the opposite of this fault.

- c2324a9: A new rule: `media-with-no-captions`.

  Everything else on a page can be read by somebody who cannot hear it. A media element cannot: its
  content **is** the sound, and without a `<track>` there is no text of it anywhere — not for a deaf
  reader, not for somebody with the sound off, and not for the search index.

  `captions`, `subtitles` and a `<track>` with no `kind` at all (which defaults to `subtitles`) all
  carry the words and silence the report; `chapters` and `metadata` are navigation and do not.

  `<video muted>` is **not** reported — there is no sound to caption. That is the decorative
  background loop, the commonest `<video>` on a page that has one, and would otherwise be the
  commonest false report this rule could make. Children it cannot read (`{tracks}`) may well be the
  track, so those are left alone too.

- 4a95896: One Provider of a context per component, refused rather than reported — and the scope pattern that replaces it.

  RMD056 reported this; it now **throws in every build**, like a write to props (RMD004, RMD015) and a
  plain-object props bag (RMD055). A component publishes a context on ONE object, so a second Provider
  replaces the first and hands every descendant the second whichever part of the tree it is in — while
  the component itself can still read both through its own hooks. **The one place that made the mistake
  is the one place it looks fine**, which is exactly why a development-only report was not enough: it
  left production doing it silently.

  Found on this repository the day RMD056 landed: `@ramonda/form` mounts two `Form` hooks on one
  component in two of its own tests, and a descendant reading its form through the context bound to the
  second. Measured — submit the first form and its own `submitCount` is 1 while a descendant `FormState`
  reads 0.

  **Nothing is declared for it, and `single` is a different axis.** `single` says whether NESTING is a
  fault — two on one path, on different components — and a context that welcomes nesting (a theme, a
  form) is still broken by two on one component. So this takes no option: there is no version of it an
  author would choose. Splitting the keys between two Providers is not a way out either, and the types
  already close it — a Provider takes `options: T` whole.

  **What replaces it, measured rather than asserted.** A component that renders `this.props.children`
  scopes its context to what is inside it, so two of them side by side are two independent scopes and a
  consumer in each finds its own with nothing passed down. That works because a context object is created
  from the component that RENDERS a node, not the one whose source contains it — so a child handed in as
  `children` inherits the wrapper's context. This is React's `<Provider>` element in Ramonda's terms; the
  difference is that 1-1 and no fragments mean the wrapper is one real element rather than none. Pinned in
  core's `Diagnostics.test.tsx`, because the refusal rests on it.

  **`one-provider-per-component` in `@ramonda/check`** says it before anything runs — an ERROR rather than
  the usual warning-first, and deliberately: the runtime does not warn either, it throws, and a warning
  would call a crashing line survivable. It sees only a pair written directly, resolved through the
  `BindingElement` each name came from, so an import alias is transparent and two contexts of the same
  shape stay two; a Provider wrapped in a hook class of its own — `Form`, `QueryClientProvider` — is the
  runtime's to catch. Zero hits across `apps/docs`, the playground, form, query and router. The pair
  resolution moved to `rules/context-pair.ts` now that two rules share it.

  `@ramonda/form`'s two tests are restructured onto one form per component, which loses no coverage: "two
  forms cannot reach each other's state" and "focus stays inside the form it was submitted from" are
  exactly as testable with two components, and that is what an app writes anyway.

  **Two things to know before upgrading, and neither is comfortable.**

  **The check rule does not cover the case that motivated this.** It sees only a pair written directly, and
  `Form` and `QueryClientProvider` wrap their Provider in a hook of their own — which is exactly the shape
  found in this repository. So for the arrangement most likely to be in an app, there is no pre-flight
  warning: the throw arrives when the component is constructed. Fixing that needs the graph to follow a
  Provider through a hook class, which is a bigger piece and is not attempted here.

  **It throws even where nothing was reading the context.** Two `Form`s on one component that are only ever
  reached directly — `this.first.fields.email.$.bind`, no descendant `FormState` — were working, and now
  they stop. That is the same trade RMD055 made: the form is refused where it happens to be harmless,
  because whether it is harmless depends on what a descendant does later, and nothing at the publish site
  can see that. The migration is one component per Provider, and `focus after a failed submit` in
  `@ramonda/form` is the worked example.

  Documented where a reader looks: a new section on `/composition/context`, which never taught subtree
  scoping at all, plus `/forms/fields` and the RMD056 reference.

- 497133c: A new rule: `persist-of-a-lossy-value`.

  `@persist` has one job — put a field into the hydration blob, which is JSON. So a `Map`, a `Set`, a
  `Date`, a `RegExp`, a function or a class instance makes the decorator do nothing, and it does
  nothing **quietly**: none of them throws on the way out. `JSON.stringify(new Map())` is `{}`, and a
  `Date` arrives as a string. The client starts with a value of the wrong shape and fails later,
  somewhere else, on a method the value no longer has.

  The report says what the value BECOMES rather than "not serializable", because the cases fail
  differently: an empty object fails at the first method call, while a `Date` that became a string
  fails only where somebody asks it the time.

  The static half of `RMD033`, which says the same thing once a value actually crosses. `@state`
  holding the same value is **not** reported: reactive state only reaches the blob on a server render,
  so a browser-only project may hold anything in it. `@persist` creates no signal and has no other
  effect, so the decorator itself is the claim.

- 218b9fc: A new rule: `interval-with-no-cleanup`, the static half of `RMD006`.

  An interval does not stop by itself, and nothing about unmounting a component touches one. So the
  callback keeps running on a schedule — reading state nobody is showing, holding the component and
  everything it closed over alive, and doing it once a second for as long as the page is open. Open
  and close the same view ten times and there are ten of them.

  Three shapes, each certain rather than likely: the id **discarded**, so nothing can ever clear it;
  the id kept in a **local**, which dies with the call that made it; and the id on a **property no
  `clearInterval` in the class ever names** — the documented shape done half way, which is the one
  worth catching, because somebody followed the advice as far as the property and stopped.

  **`setTimeout` is deliberately not reported.** A timeout stops on its own, so an uncleared
  `setTimeout(fn, 0)` is the commonest correct line of asynchronous code there is. A long one _can_
  outlive a component — and telling a long one from a short one is a judgement about a number, which
  is exactly the kind of maybe this package refuses. The runtime keeps that half, where it can see
  what is still armed.

  The global is told from a method the way `browser-url` tells `location`: a bare name that resolves
  to **nothing** is the platform's, which costs no type at all — the program is built with no lib, so
  a name the browser owns has no declaration and one the app wrote does.

  Nothing in this repository trips it, and that is because the shape is not here: every timer in it
  goes through `@interval`, which starts on mount and clears itself on unmount. Proved by planting all
  three shapes into a real app and watching two of them reported while the cleared one stayed silent.

- 99235b5: A new rule — **`unserializable-state`** (`RMD019`, `RMD033`) — and a second gate for the rules that
  only mean something under server rendering.

  The server's state travels to the client as JSON, so a `Map`, a `Set`, a `Date`, a `RegExp`, a class
  instance or a function does not survive the trip. None of them **throws** on the way out, which is
  what makes it quiet: `JSON.stringify(new Map())` is `{}` and a `Date` arrives as a string, so the
  client starts with a value of the wrong shape and fails later, somewhere else, on a method the value
  no longer has.

  **The gate is the interesting half.** `@state` holding a `Map` is perfectly correct in a project that
  never renders on a server — there is no blob for it to cross — so reporting it would be reporting a
  working application. `needsServerRendering` is therefore a second `needs`: a browser-only project
  does not **skip** the rule, it is not part of that run at all, which is the same stance the router
  rule already takes about a project with no router.

  Decided from IMPORTS, once, by the same argument `needs` makes: core's `renderToString`,
  `renderPage` or `renderStatic`, or `hydrateRoot` — the client half of the same story, since a
  project that hydrates was rendered on a server by definition. `@ramonda/server` answers on its own.

  Proved both ways with the same fault planted in two real projects: two reports in `apps/docs`, and
  none in `apps/playground`, which imports no server entry. The fixtures are the same components with
  one import between them.

  `lossyIn` — the reader that walks an initializer into object and array literals — now lives in
  `rules/lossyValue.ts` and is shared with `persist-of-a-lossy-value`. The two ask the same question
  about the same blob, and two copies of that table would be two answers waiting to disagree about
  somebody's `Date`.

  A field that is BOTH `@state` and `@persist` is left to the ungated rule: `@persist` says the field
  is meant to travel whatever the project does about servers.

  The catalogue's "no code claimed twice" check is now a declared table of pairs instead. Three codes
  genuinely have two rules — each pair being two halves of one code rather than two rules saying the
  same thing — and writing them down makes a third claimant a deliberate act rather than something
  nobody notices.

- f30286d: A new rule: `listener-on-the-default-host`, the static half of `RMD042`.

  Without `@Host` a component's host element is `<ramonda-host style="display: contents">`, and that is
  the point of it: it takes part in no layout, so the markup inside lands in the parent's grid or flex
  row as if the component were not there. What it has no part in is being a **target** — an element
  with `display: contents` generates no box, so nothing can be over it.

  **Only a non-bubbling event**, and that narrowing is the interesting part. The first version
  reported every `@onElement` on a default host, which is what the runtime did too — and it was
  reporting working code. Measured after the rule was questioned: a click on a **child** of a boxless
  host reaches the listener perfectly well, because bubbling needs an **ancestor** rather than a box,
  and the host is one. The handler ran; the count went up.

  What genuinely never arrives is an event dispatched at its target and nowhere else: `mouseenter`
  needs a box to enter, `focus` needs something focusable. Those are what this reports.

  Both halves are decorators, so it is syntax: `@onElement` on a member and no `@Host` on the class.
  `@Host` is inherited — the tag is read from the constructor — so the heritage is walked, and a
  component extending a `@Host`-ed base has a real element. A `@Host` whose tag is a callback makes it
  go quiet: what that returns is decided at runtime.

  `@onWindow` and `@onDocument` are untouched, since they resolve to the globals whatever the host is.

  Nothing in this repository trips it, and the reason is worth knowing: every `@onElement` in it is
  paired with a `@Host`, which is the correct pattern. Proved by removing one `@Host` from a real
  component and watching the listener beside it be reported.

  The review of this branch caught the version that would have shipped **silent for every component
  anybody outside this repository writes**. It treated a base it could not read as "has a host", and
  in a real application `@ramonda/core` resolves to a `.d.ts` — so `class Bare extends Component` hit
  that branch every time. It only worked here because the workspace maps the package at its source.
  `Component` and `Hook` now END the chain, which is what they are: the default host is what a
  component gets by not having one. Verified against a project pointed at the built `.d.ts`, and every
  other rule on this branch was checked the same way.

- 7e848b2: Two more runtime diagnostics move to before the code runs: **`decorator-that-adds-nothing`**
  (`RMD050`) and **`unkeyable-memoized-argument`** (`RMD047`).

  **`decorator-that-adds-nothing`** — `@state` already puts a field in the hydration blob, so a
  `@persist` beside it adds nothing at all. It is a small fault worth reporting for a specific reason:
  the line that does nothing looks exactly like the line that does the work, so it survives every
  reading of the file and gets copied into the next component. The capability table it judges by is
  the one `debug/claimMember.ts` keeps, so the pairs it reports are the pairs the runtime reports —
  and two decorators doing DIFFERENT work on one member (`@created` with `@mounted`, `@watchProp` with
  `@updated`) stay silent in both.

  The same decorator written twice is left to `duplicate-decorators`, which already had it. Found by
  building this rule and watching both fire on one line: two reports on one line is how a reader
  learns to skim past both.

  **`unkeyable-memoized-argument`** — `@memoizedHandler` caches by its arguments, and a key holds a
  string, a number or a boolean. An object cannot be compared by value, and keying on its identity
  would miss every time, so the handler is rebuilt on every render — the churn the decorator exists to
  prevent. Development throws; **production builds the handler and moves on without caching**, which
  is why saying it early is worth something: the page works and only the memoisation is lost, silently.

  It found a real one on its first run. In the playground's form page the decorator sat on `tagRow`,
  which takes an object and returns markup, while the comment above it described `removeTag` — a doc
  comment written between the two had left the decorator on the member above. That call could never
  be memoised, and in development it throws the moment the list has a row in it. Now fixed.

  Both report only what can be proved. `this.pick(row.id)` is right and `this.pick(row)` is the fault,
  and they look the same from here without asking for a type — so an argument this cannot read is left
  alone, and a parameter annotated as an object, array or function is reported once at the declaration
  instead, where every call is one fault.

- 72e79ab: A new rule: `state-mutated-in-place`, the static half of `RMD005` and `RMD048`.

  A signal fires when it is **assigned** a new value, not when the value it already holds changes
  inside. So `this.items.push(row)` and `this.user.name = "x"` leave the signal holding the object it
  was holding a moment ago: the setter never runs, nothing is scheduled, and the page keeps showing
  what it showed before. The data is right and the screen is wrong — which reads as the framework
  being broken rather than as a mistake in the code, and is the commonest first impression anybody has
  of a signal.

  It mirrors `debug/mutationGuard.ts` boundary for boundary rather than drawing its own line, so the
  two can never disagree about somebody's code: **only plain objects and arrays** (the guard wraps
  nothing else, because a `Date` or a class instance needs its real receiver), and **only the nine
  mutating array methods** (`map`, `filter`, `slice` and a spread return a new value, which is the fix
  rather than the fault).

  Reported anywhere in the class, not only from a render — a handler is where the fault usually lives,
  and it is the one place a render-scoped rule would never look.

- 055f425: A new rule: `watch-of-a-prop-that-is-not-there`.

  The selector **is** the declaration: `@watchProp((p) => p.userId)` says to run the method when
  `userId` changes. Name something that is not a prop and the selector reads `undefined` on every
  render, which never differs from the `undefined` before it — so the method **never runs**, for the
  whole life of the component. Nothing throws. The reaction is simply absent, and whatever it kept in
  step drifts.

  `tsc` refuses this too, as `TS2339` — until somebody writes `(p: any) => …`, a `@ts-ignore`, or
  widens the props type for an unrelated reason. A type is a defence only while nobody casts it away.

  The props type is read as **syntax**, never as a question to the checker: the type argument on
  `extends Component<…>`, written out as a literal or naming an interface or alias whose declaration
  can be found — including one imported from another file.

  The silence carries most of this rule, because naming a real prop as missing is the one failure that
  would get it switched off. The whole class is left alone when the members cannot all be enumerated:
  no type argument, an index signature, an intersection, a union, a mapped type, a generic
  instantiation, an interface that `extends` something or is declared twice. A selector this cannot
  read — `(p) => p[key]` — is skipped on its own.

  Three spellings of the read are checked: `p.userId`, `p["userId"]` and `({ userId }) => userId`.
  Only the first level is a prop, so `p.user.id` is judged on `user`.

### Patch Changes

- e60dd14: The command now prints the rule's id above each report.

  It appeared nowhere in the output, which left a reader with a sentence and no name. The id **is** the
  name: it is the key in `findings`, the row on the reference page, and the thing to search for. With
  it, somebody looking at a warning can find the entry that explains it; without it they have prose
  and a guess.

  ```
  [ramonda-check] click-with-no-keyboard-path — 1 click handler(s) a keyboard cannot reach:
  ```

  No URL beside it, deliberately. The reference is a table of rules with no per-rule anchor, so a link
  would land at the top of a long page — the exact failure the docs' own link test was written about,
  where "the docs sent me to the wrong place" reads as a broken site rather than a broken link. The
  package's README carries the address once, which is where an address belongs.

- 73658f7: The issue-type list on `/reference/api` is now generated, and `analyze.ts` no longer re-exports
  every issue shape by name.

  Both were lists that held no decision, and both were conflict magnets: `analyze.ts` typed all 48
  names **twice** — once to import, once to send on — and nothing in the file used a single one of
  them. `export type * from "./rules"` says the same thing and cannot go stale. Two merges have now
  been spent hand-resolving those lists, and one of them auto-merged into duplicate keys with no
  conflict marker to show for it.

  The API page's paragraph is written by `build-rule-tables.mjs`, from what the package actually
  exports — not derived from rule ids, which would need a second copy of the naming exceptions the
  surface test keeps, and not from `src/index.ts`, which also publishes the graph checks' shapes
  (`ContextIssue` is public and is not any rule's, so a sentence beginning "every rule publishes" must
  not name it).

  What a new rule still touches is the registry in `src/rules/index.ts` — one list, and a real one:
  the ids in it are what `Findings` is keyed by, so it cannot be discovered at runtime without losing
  the literal types this package is built on.

- 72e79ab: `alsoReportedAs` is a list, and three rules now declare the codes they had only ever named in prose.

  `duplicate-decorators` answers **four** — a single-use decorator written twice is `RMD045`,
  `RMD032`, `RMD040` or `RMD046` depending on which decorator it was, because what the framework does
  about each differs: `@Host` throws, the middle two silently pick a winner, `@StableProps` merges. It
  declared none, because the field held one string. `state-written-while-rendering` also answers
  `RMD018` (the same write inside a `@compute`), and `row-without-a-key` also answers `RMD051` (the
  `list()` half, where an identity was inferred and could not tell the row from its siblings).

  So the reference linked neither way for six codes: the rule table did not name them, and a reader
  arriving from the diagnostics page had no way to learn a static check existed. Found by grepping
  every rule for the codes it mentions and comparing that against what it declares.

  The catalogue test grew a second half with it: **no code may be claimed by two rules**, so a reader
  who looks one up finds exactly one static check to read. `RMD023` is the single deliberate exception
  and a real pair — `row-without-a-key` reports a row with no key at all, `index-as-key` one whose key
  says only where the row was.

- 5e52c40: Three rules claimed more than they caught. Found by auditing each claim against the code and
  planting the shapes the claim implies.

  **The reach stopped at the class's own members.** `this.helper()` was looked for in `cls.members`
  and nowhere else, so a method **inherited from a base class** was never followed and the walk ended
  there without a word — and `stateFieldsOf` read only the class's own fields, so `@state` declared on
  a base was not state as far as the rule was concerned. Both were gaps rather than decisions: a base
  is another **class** and the same **object**, so `this` still means the component and inherited state
  is the component's. A `render()` reaching a write through an inherited method now reports it, path
  and all. The file's own docstring listed this among the things it deliberately could not see; that
  line is gone, because it is no longer true.

  Measured while checking: the walk's other reaches are sound — four helper hops inside a class, and a
  clock three files away through two intermediate functions, both reported with the full path.

  **`persist-of-a-lossy-value` did not look inside a literal.** `@persist opened = new Date()` was
  reported while `@persist meta = { openedAt: new Date() }` was not — and the second is the commoner
  shape by a distance. Its runtime twin `RMD033` recurses for exactly that reason and says so; the
  static half was written shallow and claimed the same thing. It now recurses into object and array
  literals, bounded at four as the runtime check is.

  **`link-without-a-destination` missed an empty `href`.** The claim is "one that goes nowhere"; the
  code enumerated `#` and `javascript:`. `href=""` is worse than the bare `#` rather than the same —
  it resolves to the page it is already on, so following it **reloads**, losing whatever the reader
  had typed and scrolled to. It has its own sentence now.

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
