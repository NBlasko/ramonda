# @ramonda/core

## 0.14.1

### Patch Changes

- d2a3f69: `RMD050` — a decorator whose effect the member already has

  ```tsx
  @state @state count = 0;        // reported: the second installs the same accessor
  @state @persist token = "";     // reported: @state already puts a field in the blob
  ```

  A warning rather than an error, because the member ends up right either way — a doubled `@state` renders
  once per write with the right value. What is wrong is the belief that the second line did something.

  **Reported through the CAPABILITY, not the decorator's name**, which is what catches the second case at
  all: `@state` and `@persist` are two spellings of "this field travels in the hydration blob", so a check
  keyed on names would have seen two different decorators and said nothing.

  **Most pairs on one member are silent, and that is the half worth stating.** `@created` with `@updated`,
  `@mounted` with `@destroyed`, `@onWindow` with `@onDocument`, `@interval` with `@timeout`, `@watchProp`
  with `@updated` — each measured as doing real work twice, which is the reason for writing two. And the
  pairs that make no sense at all already threw before this existed: `@state` with `@compute`, `@compute`
  with `@persist`, `@state` with `@watchProp`, `@memoizedHandler` with `@compute` name the member and what
  it is, because one of the two is on the wrong kind of member.

  Once per member, not once per instance, so a list of a thousand rows says it once. Development only: the
  record it keeps is a `Set` on the instance behind `__DEV__`, and a production build allocates none of it.

## 0.14.0

### Minor Changes

- 062f39f: Two lazies built by one factory no longer share a cache entry — RMD035

  `AsyncLoad` identifies a module by the SOURCE of its `lazy`, which works when that source names one:
  `() => import("./Thing")` says what it loads, so the same import written in two components shares one
  cache entry — which is what you want. A lazy a FACTORY built names nothing —
  `const make = (path) => () => import(path)` closes over the path, and a closed-over value is not part
  of the source, so every module the factory produces stringifies the same. The first loaded and
  cached; the second never asked for its own and rendered the first one's module. Nothing failed,
  nothing was logged, and which module you got depended on which rendered first.

  Which of the two you have written cannot be read from the text of the function: the source a bundler
  leaves behind is its own business, and a rule looking for a literal specifier would read one
  bundler's output correctly and another's backwards. So nothing is guessed. When a second `lazy` meets
  a key that is already taken, its module is loaded and COMPARED — the module system serves a genuine
  duplicate from its own registry, so the ordinary case pays one resolved promise and confirms the
  sharing. A module that turns out to be a different one is given a key of its own, and renders what it
  asked for.

  What that costs is the shared cache entry: a loading frame the second time, since the fetch is still
  deduped. `cacheKey` gives it back, and RMD035 says so.

- af4138f: An object changed in place is now reported — RMD034

  `this.items.push(x)` has always been caught. `this.user.name = "x"` was the identical fault and was
  silent: a signal fires when it is ASSIGNED a new value, so writing into the value it already holds
  changes nothing it can compare, nothing re-renders, and the page goes on showing what it showed
  before. The asymmetry was invisible, and the docs made it worse by saying both were caught.

  The guard wraps **lazily**, along the path a render reads: a `get` returns a guarded child only when
  something asks for that child, so reading `user.name` costs two proxies whatever the size of `user`,
  and a component that never touches `user.address` never wraps it. Nested changes are reported by
  their path — `user.address.city` rather than "an object in state" — and the message points at the
  replacement, including the `@ramonda/lens` form.

  A `Date`, a `Map` and a class instance are left alone: their methods need the real receiver, and
  wrapping them would break working code for a report nobody asked for. So is anything reached through
  a **frozen** property — a proxy may not hand back something other than the real value for a property
  that is non-writable and non-configurable, and `Object.freeze` makes every own property exactly that.
  Nothing is lost by it: a frozen property cannot be assigned, so there is no in-place change under it
  left to report. Development only, as ever.

  Measured on a dev update of 3000 rows reading two levels of object state plus an array element:
  49.1 ms → 57.1 ms, **+16%**. The first version cost 30% and was wrong: a proxy escapes into user code
  the moment anything copies (`[...this.rows]` spreads guarded children), and wrapping an escaped proxy
  again gives an identity nothing has seen — a no-op render moved 200 of 200 list nodes. Guard proxies
  are now recognised and handed back as they are, which is what both the correctness and the other half
  of the cost came from.

### Patch Changes

- 55917be: A failed lazy import is quiet in production

  `AsyncLoad` wrote the error to the console on every failure, in every build. The app had already been
  told, in the framework's own way — `errorFallback` is handed `{ error, retry, attempt }`, so it can
  render what it likes, report where it likes and offer the retry — so the console line was a second
  channel it could not turn off.

  A chunk that fails to load is not always an incident. A deploy rotating its assets, a reader going
  offline, one dropped request: apps handle those, and a red line for each is noise they did not ask
  for. Development keeps it, because there the reason is what you need and there is nowhere else it
  would go — the same split `h.ts` makes for a function in tag position.

- 68288cd: RMD005 says what it covers, and the docs stop claiming it covers objects

  `concepts/state.md` told readers that "changing an array or object in place is caught and reported as
  `RMD005`". Objects are not caught. `this.user.name = "x"` is the same silent no-op the array report
  exists for — the signal never fires, the render keeps showing the old value, and nothing says a word.

  An array can be watched because the mutation goes through a method — `push`, `splice`, `sort` — and
  a property assignment on an object has no such seam without wrapping every object the state hands
  out. So the asymmetry is a consequence of the shape of the thing, not an oversight, and what it costs
  a reader is the belief that the check is the boundary of what goes wrong.

  The rule is the boundary: replace, do not change in place. That is now what all three places say — the
  concept page, the diagnostic's own fix text, and the reference section — and
  `MutationGuardScope.test.tsx` pins both halves, so the day an object guard is added the test fails and
  sends whoever added it to the sentences that have to change with it.

- 715b23c: Three from the review backlog: a dropped element ref, a mutated attributes object, and a README that described removed behaviour

  **An element went on holding a `ref` the JSX had stopped giving it.** `ref` is not a DOM attribute, so
  it is never among the previous attributes read back off the node, and the attach loop only walks the
  keys present in the next ones — a disappearing `ref` was invisible to both. The element kept a strong
  reference to the handle, and `current` stayed aimed at an element the JSX no longer connected it to.
  A component's ref has behaved correctly since it was unified across create, update and adopt; this is
  the same rule on the element side. The deliberate re-assertion is untouched, so two elements sharing
  one ref still fall back to the first when the second goes away.

  **`class` → `className` was rewriting the caller's object.** JSX builds a fresh props object per
  element so the compiler never showed it, but `__h` is public and callable, and the `children` copy
  three lines away exists for exactly this reason — measured, when one attributes bag used for two
  elements ended up with only the last one's children. Deleting `class` also swallowed the rename
  warning for every later use of that object, though the source still said `class`. It copies now, and
  only on the path that is already the wrong spelling.

  **The README sold an opt-out that no longer exists.** An underscore-prefixed method "deliberately left
  unbound", with a performance table and a paragraph on the trade — for behaviour removed on
  2026-07-29, because a `naming-convention` lint rule set to `leadingUnderscore: "require"` silently
  produced `this`-loss. A reader would have avoided the prefix to keep `this`, or reached for it to save
  the binding, and both conclusions were wrong. The section now says why there is no opt-out, carries
  the measurements that are current, and names the `@unbound` decorator a future one would be.
  `ReadmeBinding.test.ts` pins it: prose is the one thing types, lint and tests all pass over.

- 6dcc359: Dead documentation pointers removed

  Eighteen references in fourteen files pointed at documents that do not exist: `BUGS.md` (the most
  common), `TODO.md`, `docs/AsyncLoad.md`, `docs/async-ssr-proposal.md` and `apps/docs/PLAN.md`. Every
  comment that carried one already explains itself — the pointer was an extra, not the load-bearing
  part — so they are gone rather than replaced.

  The README's Documentation section listed three of those files as if they were there. It now points
  at [ramonda.pages.dev](https://ramonda.pages.dev), which exists, and at `DIAGNOSTICS.md`, which is in
  the package. The paragraph that said the documentation site "is planned in apps/docs/PLAN.md" now
  says where it is.

- 0024599: An `ErrorBoundary` covers more than the docs said, and a context subscription is described as it works

  **The boundary.** The page said an `@updated`, or a subscription's `connect`, that throws is
  "reported, not caught here". Both are caught: `flushUpdated` and `flushPostCommit` route through the
  same `errorHandler` a render does. The line is not "render versus the rest" — it is **whether the
  framework was the one calling**. A render, a `@create`, a `@compute`, an `@mount`, an `@updated` all
  run on the framework's own path, so the error can be walked up to a boundary. A click cannot: the
  browser calls the listener directly, so the throw never passes through the framework at all. A page
  that believed its boundary stopped at the render would write a `try/catch` it does not need — or
  trust a narrower boundary than it has.

  **Context.** Three things follow from per-key tracking and none of them is guessable, so they are
  written down now: the tie is made on the first read and lasts until the component goes (a branch you
  stop taking does not unsubscribe); a key is compared, not explored, so changing something inside a
  key's value tells nobody; and a consumer looks for its provider once, when it is created.

  Both are pinned by tests, because prose is the one thing types, lint and tests all pass over.

- dcb330b: Four things the docs left for a reader to discover

  **A `@compute` recomputes when you READ it**, not when the change happens. A `@state` write marks it
  stale and goes on. So a compute nothing reads costs nothing — a value behind a closed panel is not
  recalculated while the panel is closed — and the work lands in whoever asks for it rather than in the
  write.

  **Refusing a props update drops it whole.** `@ShouldUpdateOnPropsChange` returning `false` does not
  take the props either, so a later render caused by the component's own state still shows the props it
  last accepted, until the parent sends an update the rule agrees to. That is the trade, and it is why
  this is an escape hatch rather than an optimisation to reach for.

  **What a runaway does in production.** Two counters — `MAX_BUILDS_PER_DRAIN` and
  `MAX_WORK_PER_FLUSH`, 100 000 each — are the only errors the framework raises in a production build
  that can take a page down, and both are deliberate: a tab that stops responding is the worse outcome.
  Now written down, with what each counts and what the message names.

  **Two lazies that look the same.** `AsyncLoad`'s cache key defaults to the SOURCE of the `lazy`
  function, so a factory — `const make = (path) => () => import(path)` — gives every module it builds
  the same key. The first loads; the second never asks for its own and renders the first one's module.
  Nothing fails and nothing is logged. Documented on the lazy page with the `cacheKey` that fixes it,
  next to the route-table case where people meet it.

- fd71f00: A hydrated page's `Head` owns the tags the server wrote

  The server puts the title and the meta tags in the HTML, and on the client the hook has to ADOPT
  them: `claim()` is what puts a tag into `owned`, and `@destroy` removes exactly what is owned.
  Adopting happens inside `apply()` — and on a hydrated page `apply()` never ran.

  `applyOnCreate` is `@create({ env: "shared" })`, hydration runs only the `env === "client"` creates
  (create and mount already ran on the server, and their state was restored), and `@watchProp`
  deliberately does not fire on mount. So nothing claimed them: the tags belonged to nobody, and a page
  that unmounted with nothing replacing it left them in the document. In an app that navigates the next
  page's `Head` claims them on its way past, which is why this stayed invisible.

  A client-only `@create` now applies as well. On the hydration path it is the only one that runs; on a
  client-built page it runs a second time and costs nothing, because `claim` adopts a tag it already
  owns only once, `upsert` writes the same values back, and the previous title is captured only while
  it is unset. The hook has no way to tell "hydrated" from "built", so one extra call is the cheapest
  correct answer.

- 2bac783: A memoized handler no longer takes the page down over one argument

  `@memoizedHandler` builds its cache key from the arguments, and only a string, a number or a boolean
  can be part of one — an object cannot be compared by value, and keying on its identity would miss
  every time. So an object argument is a mistake. It was a mistake that THREW, outside any `__DEV__`
  guard and from inside a render, so one handler receiving an object took the whole page down in
  production. Nothing else in the framework answers a runtime mistake that way: a list item that is not
  an element is skipped so the list keeps rendering, a function in tag position is called rather than
  crashing the page, a corrupt hydration blob is ignored so the page still renders.

  Development still throws — the handler would be rebuilt on every render, so everything it is passed
  to would re-render with it, silently, for the life of the page — and the message now names the
  component, the method, and which argument it was: `#3 (object)`, `#1 (null)`. It also says what to
  pass instead: the primitive the object stands for, `row.id` rather than `row`.

  It is also **RMD033** now, reported through the diagnostics channel as well as thrown, the way a props
  write is (RMD004, RMD015). A throw with no code is invisible to anything collecting them: the code is
  what makes this one identifiable — greppable in a codebase, one entry in the stream the devtools
  panel carries — so a whole class of fault can be swept up rather than recognised sentence by
  sentence.

  Production builds the handler and moves on without caching that call. The page keeps working; the
  cost is the identity churn memoization exists to prevent, which is a slower page rather than a broken
  one.

## 0.13.0

### Minor Changes

- 78c79ef: `@watchProp` takes several selectors and runs once when any of them changed

  ```tsx
  @watchProp((p) => p.page, (p) => p.term, (p) => p.sort)
  reload(next: [number, string, string], previous: [number, string, string]) { … }
  ```

  **"Run this when any of these props changed" was previously unwritable.** Stacking the decorator makes a
  separate entry per selector, so the method runs once per CHANGED prop — twice when two moved in the same
  update. And selecting a tuple from one selector is worse: comparison is `Object.is`, so a fresh array is
  never equal to the last one, and the method fires on **every** props change with `previous` and `next`
  holding identical contents. Both measured; both are now covered by tests.

  Comparison stays `Object.is` per selector, so nothing is compared deeply and the cost is unchanged. Only
  the CALL is coalesced. A selector whose value did not change keeps it in both arrays, so
  `previous[i] === next[i]` is how the method tells which one moved.

  **Breaking: the values are always a tuple, including for one selector.** `(next: string)` becomes
  `([next]: [string])` — destructuring in the parameter list leaves every method body untouched.

  That is about evolution rather than neatness. With a scalar for one selector and a tuple for several,
  adding a second selector to a watcher that already exists silently changes the method's parameter type,
  and what a decorator reports for that is `TS1241 Unable to resolve signature of method decorator`, which
  names nothing useful. A tuple that grows leaves `next[0]` meaning what it always meant.

  **Two of this package's own call sites were silently wrong after the change and the compiler accepted
  both**, which is worth knowing if you have your own: a parameter typed as a deferred conditional
  (`InferIn<S>` in `@ramonda/form`) or as anything array-shaped (`QueryKey` in `@ramonda/query`, which is
  `readonly unknown[]`, so a one-tuple is assignable to it) type-checks and then receives the tuple.
  `@ramonda/form`'s late-defaults suite caught it; the types did not. Audit by shape, not by `tsc`.

- 87a3c8c: The lifecycle decorators are `@created`, `@mounted` and `@destroyed`

  `@create` → `@created`, `@mount` → `@mounted`, `@destroy` → `@destroyed`. `@updated` is unchanged, and it
  is the reason: it was the only one of the four already naming the moment rather than an action, and one
  odd name out of four is a rule nobody can state.

  **They report a moment, they do not perform one.** `@mount` reads as an instruction — as though the
  method does the mounting — when what it means is "the framework will call you once this is mounted".
  `@mounted` says that. So does `@destroyed`: the method does not destroy anything, it runs while teardown
  is happening.

  `@watchProp` keeps its name for the same reason it should: it IS an instruction. You are telling the
  framework to watch a prop.

  **One cost worth knowing before you upgrade.** `created`, `mounted` and `destroyed` are the natural names
  for a local flag or counter — `let mounted = false` is an idiom — and a local shadows the import, so
  `@created` silently resolves to your array. Six files in this repository had exactly that, and the
  compiler reports it as `TS1241 Unable to resolve signature of method decorator`, which does not mention
  shadowing. If that error appears on a decorator that was fine a moment ago, look for a local with the new
  name.

### Patch Changes

- 13b2c75: `RMD045` — two `@Host` on one class, said in words and reported to a collector

  It always failed, with V8's own message: `Cannot redefine property: Symbol(host:meta)`. `HOST_META` is
  written non-configurable, so the second `defineProperty` threw — naming an internal symbol, offering no
  advice, and pointing inside `decorators.ts` rather than at the class. For a mistake as easy as writing the
  decorator twice, that was the worst report available.

  It now throws with a sentence that says what to do, and **emits a record as well**. Those are not
  alternatives: the throw is the developer's channel and ships in every build, while the record is what an
  app streaming its diagnostics somewhere needs in order to see this alongside everything else it has to
  tidy up. A fault that only throws is invisible to that.

  What decides whether a fault also throws is whether the program can carry on. `RMD032` and
  `RMD040` report and continue, because one declaration quietly wins; a component cannot have two elements,
  so there is no winner to pick here.

  A **subclass** declaring its own `@Host` is not this. It overrides the base's — how a specialised
  component changes its element — and stays silent.

- 607a5de: `RMD046` — two `@StableProps` on one class merge instead of throwing

  It used to throw, and not on purpose: `STABLE_PROPS` was written non-configurable, so the second
  `defineProperty` failed with V8's `Cannot redefine property: Symbol(stableProps)`. An internal symbol and
  no advice, for what is a spelling mistake.

  Merging is the reading that matches the decorator. `@StableProps` names a **set**, and it already merges
  along the class chain — a subclass adds names rather than shadowing the base's — so two on one class has
  one unambiguous reading, the union, and both declarations now take effect. Combine them into
  `@StableProps("a", "b")`.

  **A warning rather than a refusal**, which is the line against `RMD045`: two `@Host` element names have no
  union, so carrying on there would mean silently picking one. Here the result is exactly what was asked
  for, so only the spelling is redundant.

  The property is `configurable: true` for this, and the trade is smaller than it sounds. `writable: false`
  still refuses an assignment — the door an app could actually reach — and the symbol is a plain
  `Symbol("stableProps")`, neither exported nor `Symbol.for`, so nothing outside the package can name it
  without walking `getOwnPropertySymbols`. What is given up is a deliberate `defineProperty` by code that
  went looking for it.

## 0.12.0

### Minor Changes

- cf9be97: `use()` takes a third argument: metadata about the hook

  ```tsx
  private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit }, { label: "Sign Up" });
  ```

  Devtools then calls that hook **`Form (Sign Up)`** — its class plus its label. The class says what the
  node is, which a label cannot recover; the label says which one it is, which the class cannot give,
  because `this.constructor.name` is `Form` for every form on the page and two `this.use(Form, …)` in one
  component are otherwise two nodes with one name.

  **Why a third argument and not a prop.** A hook's props belong to whoever wrote the hook. A framework
  that reserved a word in there would collide with a real one eventually — and on a form it collides
  immediately, since a form is full of labels and `label` reads as the visible text of a field. So this is
  metadata _about_ the hook rather than input _to_ it, and the hook never sees it. The first attempt at
  this did reserve the prop, and that is why it was reverted rather than shipped.

  A propless hook takes the placeholder: `this.use(Poll, undefined, { label: "prices" })`. Deliberate — an
  overload taking metadata in the props position would be ambiguous, because `{ label: "…" }` is a
  perfectly good props bag for some hook somewhere.

  The shape is published as `HookMeta`. An inline `{ label: "Sign Up" }` needs nothing imported, since the
  argument is structural — the name is there for a helper that builds one, or a wrapper that passes one
  along.

  The metadata is parked on the instance under `Symbol.for("ramonda.hook.meta")` and read from there by
  core's own inspector and by `@ramonda/form`'s panel — a documented key rather than an import, so neither
  package depends on the other to pass a name along. The same contract shape as the diagnostics sink.

  Development-only. A production build stores none of it, and a label that is blank, is not a string, or
  only repeats the class is ignored.

  A hook that calls `Object.freeze(this)` keeps working and keeps its class name in the panel. Such a
  hook works everywhere else in this package, and `Object.defineProperty` on a frozen object throws —
  from a field initializer, before the component exists, and **only in development**, since production
  never stores the metadata. A cosmetic label is what gives way.

- ea40a1e: Every `RMD` diagnostic is also a record

  `diagnose` now hands each report to [the collector every reporting package shares](https://ramonda.pages.dev/reference/diagnostics#capturing-them),
  so a devtools panel, a test or a log shipper can group and filter them by `code` and `severity`
  instead of parsing a message. The console line and the `ramonda:dev-log` event are unchanged: this
  adds a consumer rather than replacing one.

  Three details are decided rather than incidental.

  **`warning` becomes `warn` in the record.** This package has always said `warning`, and the protocol's
  word is `warn`; the vocabulary belongs to the protocol, so the translation happens at the emit point.
  A collector filtering on severity depends on it being exact.

  **The record carries the dedup key.** `diagnose` reports once per `code:dedupKey`, and that key is now
  published, so a collector collapses exactly what core collapses rather than guessing.

  **`data` carries values, and anything live is dropped.** That argument is `unknown` and always has
  been, because it goes to a console — where an object is the useful thing, expandable and inspectable.
  A record is different: a collector keeps a bounded history, so anything live in one stays alive as long
  as the history does. `propsStability` passes `{ cached, fresh }`, which are the actual prop values — a
  component, a DOM node, an array of them are all ordinary things to find there. So the console keeps
  the whole object and the record keeps the primitives, filtered centrally rather than trusted to
  thirty-nine call sites.

  **A duplicate the tests caught before it shipped.** In DEV core dynamically imports
  `@ramonda/devtools`, whose bridge also puts records in the `LOGS` tab — so every core diagnostic
  rendered twice the moment core started emitting them. Seventeen of core's own cases failed on it: a
  test reading the dev-log channel found the bridge's payload instead of core's message. The bridge now
  skips core's scope for the tab and only for the tab, because core already reaches it; a subscriber
  still receives everything.

  Still on the older channel: the handful of core messages that carry no code — `hydration/*`,
  `vdom/h`, `watchProps`, `decorators`, `CreateRamonda` — which reach the console and the panel but not
  the sink, because a record needs a stable code and these have none yet. They are the last ones left.

  Two things a record will not carry, both about `data` holding what an application put in a prop.
  A **getter is never invoked**: `Object.entries` would, and a getter is arbitrary code — it can throw,
  out of the diagnostic that was explaining what was wrong with the app, or write state, which lands
  mid-render and raises `RMD001` against whoever was rendering. It is skipped by descriptor, so it is
  never read. And a **`bigint` arrives as its digits**: it is the one primitive `JSON.stringify` throws
  on, which is what every collector shipping a record performs, and a `bigint` prop needs no cooperation
  from anybody.

- be245b4: Ten messages become diagnostics: `RMD033` to `RMD042`

  They start at `RMD033` and not `RMD032` because `@catchError` took that number while this was being
  written. A code is never reassigned, so the range moved rather than the other one.

  Each of these was a `ramondaLog` call with its advice written inline — a real fault, reported, but with
  no stable name to search for, no `fix` a panel could show apart from the message, and no way for a
  collector to group two occurrences of one cause. They are now codes like every other, which means they
  reach the record channel as well as the console.

  |          |                                                                               |
  | -------- | ----------------------------------------------------------------------------- |
  | `RMD033` | state that cannot cross to the client — a function, a class instance, a `Map` |
  | `RMD034` | state written during create or mount, which the client never receives         |
  | `RMD035` | the client's hook tree does not match the server's                            |
  | `RMD036` | the state blob could not be read                                              |
  | `RMD037` | an object among JSX children that is not markup                               |
  | `RMD038` | a `@watchProp` selector threw                                                 |
  | `RMD039` | `class` where `className` was meant                                           |
  | `RMD040` | more than one `@ShouldUpdateOnPropsChange` on one class                       |
  | `RMD041` | a listener with no target                                                     |
  | `RMD042` | the default host cannot be the direct target of this event                    |

  **They are deduplicated by source now**, where before they reported per occurrence: a component with
  six unserializable fields printed six lines and now prints one per field, which is what "once per
  source, not once per occurrence" has always meant everywhere else in this package.

  **The severities are the ones the messages already carried.** The port gives them identity; it does not
  re-judge them. Two of the ten sit at `error` because the result is wrong — a dropped child, a selector
  returning a value nobody chose — and the rest warn.

  `RMD040` gained one thing the message it replaces did not have: **the right answer to which declaration
  is in effect.** Two `@ShouldUpdateOnPropsChange` on one class, and the one that decides is the one
  written FURTHEST from the class — class decorators apply bottom-up, so the lower declaration writes the
  rule and the upper one overwrites it. That reads backwards, so it is measured in
  `PropsGateInheritance.test.tsx` rather than reasoned about, and the `fix` says which one to look at.

  The advice moved out of the message and into each code's `fix`, so a panel renders it apart from what
  happened, and every one has a section on the reference. `RMD026`, retired in this package's own
  registry since August, finally has a retired section there too — a reader who hits it in an old build
  now lands somewhere.

  **One message deliberately keeps no code.** `bootstrap`'s "App crashed" is the app's own error on its
  way up, rethrown on the very next line so whoever threw it still gets it with its real stack. Every
  code names a mistake and carries a fix; this one cannot, because the framework knows nothing about the
  fault beyond having been in the call stack. The reason is now written where the code is.

### Patch Changes

- 6dde55e: `RMD043` and `RMD044`, and a reason written beside every message that keeps no code

  Two more misuses become codes. `RMD043` — a `<meta>` passed to `Head` with no `name`, `property` or
  `http-equiv`, which cannot be matched again and so would be appended on every update; it is skipped,
  and now says so with a fix. `RMD044` — a tag that is neither a string, a component class nor a
  function, which renders an empty host where something was meant to be.

  **A tag that is `undefined` renders that empty host rather than throwing**, which is the fix half of
  `RMD044` and matters in production, where there is no report at all. `<Thing />` whose import failed
  arrives at the JSX factory as `undefined` — the first case `RMD044` names — and the factory read
  `.__isComponent` off it, so it raised a `TypeError` from inside itself and took down the whole render
  for a fault it is written to survive. One missing element now costs one element.

  More useful than either: **every message that deliberately keeps no code now says why, where it is.**
  There are four, and each is somebody else's fault surfaced with context rather than a mistake this
  framework can advise on — `bootstrap`'s "App crashed", a lazily loaded component that never arrived, a
  cleanup that threw during destroy, and the crash that follows `RMD011` after it has already been
  named. A code that promises advice it cannot give is worse than a sentence.

  One of those five was genuinely poor and is fixed rather than excused: a failed lazy load logged a bare
  `console.error(e)`, which in a page full of chunks names nothing. It now names the module it was
  loading. Still unconditional, because a failed lazy route is exactly what somebody needs to see in a
  production log, and still not a diagnostic, because the failure is the network's answer.

## 0.11.0

### Minor Changes

- 2d9e789: **Breaking:** `@shouldUpdateOnPropsChange` is now the class decorator `@ShouldUpdateOnPropsChange`

  ```diff
  +@ShouldUpdateOnPropsChange((self, previous, next) => previous.id !== next.id)
   @Host("li")
   class Row extends Component<RowProps> {
  -  @shouldUpdateOnPropsChange
  -  onlyWhenIdChanges(previous: RowProps, next: RowProps) {
  -    return previous.id !== next.id;
  -  }
     render() { … }
   }
  ```

  `self` is inferred from the class it is written on, so nothing needs annotating — the same shape as
  `@Host`'s tag-from-props callback. Capitalised, because a class decorator names what the component IS.

  The move fixes two faults the method form could not avoid, both silent. A subclass overriding the
  decorated METHOD without re-decorating ran the BASE's body, because the function was captured at
  decoration time — there is no method to capture now. And declaring the rule at both levels, the
  ordinary way to override it where `extends` is the composition mechanism, was reported as "more than
  one … remove the others": the rule now lives on the constructor, so `Object.hasOwn` tells "declared
  here" from "inherited", an override is silent, and two applications on ONE class are still reported.

  Two smaller consequences: the rule is inherited through the static chain like `@Host`'s tag, and
  putting it on a hook throws when the CLASS IS DEFINED rather than when something first renders it.

- eabf6c1: **Breaking:** catching an error is declared with `@catchError`, not by naming a method `catchError`

  ```diff
   @Host("div")
   class Panel extends Component {
     @state failed = "";
  -  catchError(e: unknown) {
  +  @catchError whenSomethingBreaks(e: unknown) {
       this.failed = (e as Error).message;
     }
     render() { … }
   }
  ```

  It was the last capability handed out by NAME: the error walk called `component.catchError` on
  whichever ancestor had one, so a component that defined a method by that name for its own reasons
  silently became an error boundary and swallowed its subtree's failures. That is the footgun
  `@deferHydration`, `@ShouldUpdateOnPropsChange` and `@StableProps` all exist to avoid — "a framework
  that reserves a name on every class changes behaviour silently" — and error catching was the one
  place still doing it. A plain method called `catchError` now means nothing to the framework.

  It stays a METHOD decorator, unlike the props gate, because handling an error is behaviour a subclass
  will want to extend: a boundary that reports to Sentry _and_ does what the base did is the ordinary
  case, and that wants `super`. It is dispatched by name, so overriding the method without
  re-decorating works. Returning `false` still declines the error and passes it to the next handler
  above.

  `ErrorBoundary`'s own handler moved with it: the method is now `handleFailure`, declared with
  `@catchError`. A subclass that overrode `catchError` must override `handleFailure` instead — which is
  the pattern this form exists for, since `super.handleFailure(e)` lets a specialised boundary report
  _and_ fall back:

  ```tsx
  class ReportingBoundary extends ErrorBoundary {
    override handleFailure(e: unknown) {
      report(e);
      return super.handleFailure(e);
    }
  }
  ```

  New **RMD032** reports two `@catchError` declarations on one class, where the last silently wins. A
  subclass declaring its own is an override, not a duplicate, and is not reported.

### Patch Changes

- fadb0c5: An error thrown by a fallback now reaches the boundary above

  A fallback renders inside its own `ErrorBoundary`, so when the fallback was the thing that threw, the
  error walk found that same boundary first. It set the `hasError` it had already set — no change, so
  no re-render — and the walk stopped and called the error handled. The result was a page frozen on the
  DOM it had before the throw, with the boundary above, whose whole job is this, never told anything
  had happened.

  A `catchError` may now return `false` to decline an error, and the walk carries on to the next
  ancestor that has one. `ErrorBoundary` declines while it is already showing its fallback, and catches
  again once it has been `reset`. Returning nothing still means handled, so a `catchError` written
  before this keeps working unchanged.

- bdd4cb3: An effect that reads a `@compute` now subscribes to what the compute depends on

  A fresh `@compute` touches no signal when it is read — it returns `cache.value` — so it forwards its
  own dependencies to whoever is reading. That forwarding fed only the tracker scope
  (`trackerContainer`: another `@compute`, a list item, a hook's props cache), not the effect scope.
  An effect that read a cached compute therefore recorded no dependencies at all and never re-ran.

  The ordering that produces it is the ordinary one, not a corner case: `render()` reads the compute
  and fills its cache, effects flush after the commit, so an effect reading the same compute always
  reads it on a hit. Every subscription decorator built on the effect machinery — `@onElement`,
  `@onWindow`, `@interval`, `@timeout` and anything from `createSubscriptionDecorator` — was affected
  whenever its body read a `@compute` instead of a raw `@state`.

  Both scopes are now served by one function, `trackDependency`, which `State.get` and the compute's
  hit-path forwarding both call — so they cannot be served unevenly again. An effect that writes a
  signal still does not subscribe to it, so self-triggering loops stay broken.

- 7ae07da: Five diagnostics were documented as warnings while they report as errors

  `DIAGNOSTICS.md`'s table said "warning" for RMD003, RMD010, RMD016, RMD021 and RMD023, all of which
  the registry reports as `error` — each with a comment in `diagnostics.ts` saying why it is one. The
  distinction is the part a reader acts on: an error means the result is wrong, a warning means the app
  only did more work to get there. The devtools panel raises its alert on `error` alone, so the table
  disagreed with what a developer actually saw.

  The table now follows the registry, and `DiagnosticsRegistry.test.ts` pins them to each other: the
  `DiagnosticCode` union, the `SPECS` keys and the table must name the same codes with the same
  severities, a retired number must be gone from both and still documented as retired, and no section
  may describe a code nothing can raise. The docs site had this tripwire for its own reference page;
  the package's table had none.

  Two runtime messages also stopped naming `@effect`, a decorator that no longer exists — the runaway
  and update-loop errors now point at `@mounted`, `@updated` and subscriptions, which is what a reader
  can go and look for.

- 4d0fddd: Review pass over the decorator work: three faults found in it

  **`@catchError` was reported as a duplicate when a subclass overrode the method and re-decorated it** —
  the most natural way to specialise a role, since it keeps the name. The duplicate check looked the
  declaration up by NAME, so both the base's and the subclass's resolved to the subclass's prototype and
  read as two declarations on one class. It is found by the decorated function's identity now, which is
  the only thing that separates them.

  **`@catchError` on a hook was refused only at runtime.** `@ShouldUpdateOnPropsChange` rejects it at
  compile time through its `This` constraint, and the method decorator had no equivalent — its context
  type made `COMPONENT_RUNTIME` optional, so a `Hook` satisfied it. TypeScript refuses it now, and the
  throw stays for a build with no types. Note the two report at different moments and always will: a
  class decorator when the class is DEFINED, a method decorator at the first instance.

  **A dangling doc comment** was left in `Runtime` where the old `shouldUpdateOnPropsChange` field had
  been, describing a field that no longer exists.

  Also tested rather than assumed: `value`/`checked` through a real server render and back through
  hydration, `ErrorBoundary` extended with `super.handleFailure(e)`, a thrown non-`Error`, and that the
  order `@Host` and `@ShouldUpdateOnPropsChange` are written in does not matter.

- ba83dc3: A controlled radio group follows the model too

  Radios have a rule of their own — checking one unchecks its group, and the browser does that itself —
  so a click the app never accepted has to be undone by the model. The attribute cannot do it, for the
  same dirty-checkedness reason a single checkbox cannot. Now tested alongside the rest: picking a third
  option while the model says the second puts it back on the next render.

- b5b5f6c: Hydration falling back to a fresh element no longer leaves a live component behind

  When the client renders a different host element than the server wrote, nothing can be adopted and
  hydration builds fresh, replacing the server's node. `replaceChild` takes only the NODE — the
  component sitting on it was left exactly where it was.

  The deferred path is where it hurts. A `@deferHydration` subtree ADOPTS the server's node and then
  waits, so by the time the promise settles there is an initialized component there, holding restored
  state and whatever its client `@created` started. Replacing its node left it running with no DOM: no
  `@destroyed`, no effect cleanups, no signal detach — its timers went on firing, its subscriptions
  stayed attached, and a later write to a signal it had read would render into nodes nobody can see.
  Silent, because the page looks right: the fresh element is there and the old one is gone.

  Both fallbacks now tear down first — the deferred one in place, through a new `unmountNodeInPlace`
  (the node has to still be a child for `replaceChild` to put the fresh one where it was), and the
  synchronous one through the ordinary cleanup, since its component was never adopted onto a node but
  has already run its client `@created`.

- de4ecda: The props gate behaves under `extends` like every other decorated method

  Two things did not, and both were silent.

  Overriding the decorated method without re-decorating ran the BASE's body: the decorator kept the
  function it was handed at decoration time instead of looking the method up on the instance, so the
  subclass's version was dead code that read as live. `@created` and `@watchProp` register
  `this[name].bind(this)` and honour the override; one decorator out of three failing at the pattern the
  docs recommend is worse than any of them failing at it. The gate now dispatches by name too.

  And declaring the gate on both levels — the ordinary way to override a rule — reported "more than one
  … remove the others", which is advice to delete the line doing the work. The subclass already won
  correctly; only the report was wrong. It is now raised for two declarations in the SAME class, told
  apart by the prototype that owns each one.

- d69a224: `index` in a list's `render` no longer goes stale after a reorder

  The per-item clean-skip reused an item's vnode when the object was unchanged and none of the signals
  it read had fired. An item's INDEX is neither: it is the position in `each`, and a reorder changes it
  while changing nothing the skip looked at. So a row that moved kept the vnode built at its old
  position, and `render: (item, index) => …` displayed a number that no longer matched where the row
  was — silently, and only after a reorder.

  An item that moved is now rebuilt, but only when the mapper can actually see its position, which is
  read from the parameter list: `(item, index) => …` gets the check, `(item) => …` keeps the skip
  untouched. A 10000-row list that never mentions the index still reorders without a single mapper
  call, and only the rows whose position really changed pay for one. `as` components take no index and
  are unaffected.

  The one gap is a mapper that hides its arity — `(item, index = 0)` or `(...args)` — which reports
  fewer parameters than it uses and so opts out of the check. Documented on `render`.

- 8686610: A list returned straight from `render()` is identified by the component that built it

  A region is identified by its owner — the component plus the position — so a list a component built
  for itself can never be matched against one handed to it through a prop. `<ul>{list({…})}</ul>` gets
  that from the live origin, which is the component's id. `return list({…})` never goes through that
  path, so the owner is stamped in `generateRenderOutput` instead — after the block that RESTORES the
  previous origin, so the id it read was never the component's, whatever the comment beside it said.

  Nothing misbehaved: what it actually read was 0, which is stable and unique per host. But the two
  paths produced different identities for the same idea, only one of them was the one described, and it
  held only because a build is never entered while another render is in progress.

  The stamp now reads the component's own id, so both paths agree. `StraightReturnListOwner.test.tsx`
  pins the identity and the behaviour that had to hold either way — a straight-returned list keeps its
  rows across a re-render, and two of them side by side never claim each other's.

- 4ada87c: A control the user has touched now follows the model again

  `value` and `checked` are the two attributes that stop describing their element the moment someone
  interacts with it. Typing changes `input.value` and leaves the `value` attribute where it was;
  clicking a checkbox changes `.checked` and sets the dirty-checkedness flag, after which the `checked`
  attribute never drives the box again. The diff compared the model against those attributes only — so
  it compared the model against a stale record of itself, agreed, and wrote nothing, while the control
  went on showing whatever the user had left there.

  Concretely: an `<input value={this.text}>` the user typed into kept the typed text through later
  renders, and a `<input type="checkbox" checked={this.on}>` the user clicked ignored the model from
  then on, in both directions — `checked={false}` could not untick it, because removing an attribute
  cannot untick a dirty box.

  The attribute comparison is unchanged; the live property is now consulted as well, and the property
  is written alongside the attribute. An untouched control still compares equal and is not rewritten,
  which matters: writing `.value` sends the caret to the end. `checked={undefined}` is still an
  uncontrolled box and is left alone.

  One case remains open by design: a handler that REJECTS a keystroke — clamping the length, say — and
  so leaves `@state` unchanged schedules no render at all, and nothing re-applies the value. Making
  that work means deciding what an input with a `value` and no handler is, which is a design question
  rather than a defect in the diff.

- ac06dc9: A wide update no longer costs O(n²) before anything renders

  The build queue is kept depth-descending, and a component was placed in it by scanning from the front
  until it found its spot. That made the ordinary case the worst one: a parent handing new props to N
  children queues N components at the SAME depth, and each of them walked the entire queue to reach the
  end. The scan happened before a single component had rendered.

  Measured, inserting N same-depth components: 1000 → 1.5 ms, 5000 → 13.4 ms, 10000 → 54.4 ms, 20000 →
  216 ms. With a binary search: 0.3, 0.3, 0.4, 0.7 ms. On a mixed-depth batch of 20000 — where the
  splice's own memmove is the rest of the cost — 132.8 ms → 12.0 ms.

  Nothing else changed. It is the same array in the same order: the search stops after every entry of
  the same depth, exactly where walking past them landed, so the queue is built as it always was and
  the drain is untouched. `TaskQueueOrder.test.tsx` pins the ordering that had to survive — parents
  before children, depth never going backwards across a wide mixed-depth batch — and passes against
  both the old scan and the new search.

- 8686610: `valueEqual`'s bounds are documented as what they are

  The header said the comparison was "bounded in both directions". Depth is bounded everywhere, but
  width is bounded for ARRAYS only — a wide plain object was, and still is, compared key by key.

  The asymmetry is right, and the measurements say why: a 100-key object compares in 3.33 µs and 50-key
  objects nested to the depth `@StableProps` uses in 8.48 µs, while capping them would call a form's
  record "different" on every render, hand `@StableProps` a fresh reference and re-render the child
  every time — the thing it exists to prevent. A wide array, by contrast, is usually a fresh array
  anyway, and answers in 0.07 µs at the bound.

  So the comment now describes the code, with the numbers behind the choice, and `ValueEqual.test.ts`
  pins both sides of it so the asymmetry stays a decision rather than an oversight.

- 80d832e: A component's `ref` now follows the JSX, and fills on a hydrated page

  `<Child ref={r} />` pointed `r` at the child's host when the child was CREATED, and never again. A
  component that stayed put while its ref changed therefore kept the ref it was born with: the new one
  never filled, and the old one went on pointing at a host that no longer claimed it. Measured —
  swapping `r1` for `r2` on the same component left `r1.current` on the host and `r2.current` null,
  where the identical JSX one line down on a `<p>` swapped correctly, because `Attribute.ts` has
  released and re-pointed an element's ref all along.

  The same gap on the third route to a host: hydration ADOPTS the server's element rather than building
  one, and `adoptHost` did everything `createComponent` does except point the ref at it. On a
  server-rendered page a component's ref stayed empty until something re-rendered it — on a static page,
  never. An element's ref filled correctly the whole time.

  Create, update and adopt now all go through one `applyRefFromProps`, which releases the ref it
  replaces (only if it still points at that node, so a ref another element has already claimed in the
  same pass is not wiped) and points the new one at the host. Removing a `ref` from the JSX releases it;
  adding one later fills it. A ref change schedules no render, because a ref is not a render input.

- 3c87606: Two list items under one key no longer leak the shadowed item's subscription

  Each item in a `list()` gets a reactive scope, stored under its key. When two items produce the SAME
  key, the second one's scope overwrote the first in the map being built for that pass — after the
  first had already subscribed to everything its mapper read. It was then in neither map: gone from
  this pass's, never in the previous pass's, so the cleanup loop that detaches the scopes which did not
  carry over could not reach it.

  A live subscription with no owner. Every change to a signal that shadowed mapper had read went on
  calling `reBuild()` on the list's owner for an item that no longer exists, for the life of the page,
  and marked the engine dirty each time — which defeats the whole-list skip as well.

  Duplicate keys are user error and DEV reports them (RMD013), but the leak was production behaviour,
  and a warning does not detach a listener. A scope that is displaced under a key is now released. The
  surviving item's subscription is untouched, so a list with distinct keys behaves exactly as before.

- 8686610: A module `AsyncLoad` cannot render now says so, instead of throwing at render time

  `AsyncLoad` caches a module's export and later calls it — a component class is wrapped, anything else
  was taken as already callable. An export that is neither reached the cache unchecked, and the failure
  surfaced a render later as "loadedComponent is not a function": a line that names neither the module
  nor the export, and one the error fallback never saw, because nothing had failed as far as the
  loading knew. The page stayed on its loading state.

  A default export that is a config object, a styles module, a barrel file, a named export pointing at
  a constant — all ordinary mistakes, and the same class as a missing named export, which has always
  been caught at load time and reported through the error fallback. The two now agree: the export is
  checked where the module is, and the error names both the export and what was found there.

- 4ec436c: An inline `ref` on a component no longer re-renders it on every parent render

  A component's `ref` is the framework's, not the app's data: `<Child ref={r} />` points `r` at the
  child's host element when the child is created, and it is never read again. Its identity therefore
  says nothing about whether the child should re-render — but it sat in the props bag and was compared
  like any other prop, so `ref={createRef()}` written inline handed the child a new object every parent
  render, which read as "the props changed". Measured: one wasted child render per parent render,
  forever, with no diagnostic.

  The comparison now ignores `ref`; everything else about it is unchanged, because it has to be —
  `generateRenderOutput` reads `props.key` to put the key on the host element, and a component's `ref`
  has to survive to creation. `key` is deliberately still compared: `areSimilarNodes` refuses a node
  whose key differs, so a component that reaches the update path always has an equal key and ignoring
  it would remove nothing.

  The devtools inspector also stops listing `ref` among a component's props, where it showed as an
  opaque `{ current: … }` next to the component's actual data.

- 205a41c: Eight typed SVG tags were created as HTML elements

  `<tspan>`, `<textPath>`, `<foreignObject>`, `<image>`, `<desc>`, `<metadata>`, `<mpath>` and
  `<switch>` were declared in the JSX types but missing from the `svgElements` set the runtime uses to
  decide a namespace. SVG-ness is decided by tag NAME, not by tree context, so those eight were built
  with `createElement` — an unknown HTML element wearing the tag's name — even inside an `<svg>`.

  It failed silently. `createElement` accepts any name, the node is in the DOM, `querySelector` finds
  it, `textContent` reads back; it simply never renders as SVG, and `foreignObject` / `textPath` also
  lost their camelCase, which is part of an SVG element's identity. `<svg><text><tspan/></text></svg>` —
  the ordinary way to place a second line of SVG text — was affected.

  The eight names are now in the set, and `SvgNamespace.test.tsx` pins the runtime set to the JSX
  declarations in both directions, so the two lists cannot drift apart again.

## 0.10.0

### Minor Changes

- e06dd85: A hook's props callback knows what its parameter is

  ```tsx
  private user = this.use(Query, (self) => ({ key: ["user", self.id], fetch: self.load }));
  ```

  `self` is now typed as the class the `use()` is written in, so a name that is not there is a compile
  error that says which:

  ```
  Property 'load' does not exist on type 'Panel'.
  ```

  Before, the parameter was `never` and had to be annotated — `(self: Panel)` — to be usable at all.
  That worked, and left a hole: `never` accepts any function, so a callback written once and shared
  compiled against a class it did not fit, and failed at runtime instead. Now the annotation is
  checked, which makes a shared callback worth annotating rather than necessary to annotate.

  Existing code is unaffected: every annotation that was right stays right, and `() => ({ … })` using
  `this` never used the parameter. Verified against every package, playground and docs example in the
  repository.

- 68f9163: JSX goes through an automatic runtime, and the factory is renamed `__h`

  Setting Ramonda up used to mean naming a factory (`jsxFactory: "__ramondaH"`), injecting it into
  every module, and declaring it in a `global.d.ts` — and then holding two names in your head, because
  the package exported `h` while compiled JSX called `__ramondaH`.

  Now the compiler imports what it needs, per file:

  ```jsonc
  { "jsx": "react-jsx", "jsxImportSource": "@ramonda/core" }
  ```

  ```js
  esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core" }
  ```

  No factory name, no `jsxInject`, no `jsx-shim.ts`, no global declaration. `npm create ramonda`
  writes it this way, and both templates lost a file each.

  **Breaking.** `h` is no longer exported; the factory is `__h`, for the vnodes a tag cannot express —
  a runtime tag name, spread children. Compiled JSX never calls it. To migrate, change the two config
  keys above, delete the inject and the global declaration, and rename any hand-written `h(` to `__h(`.

  Two new subpaths ship with core: `@ramonda/core/jsx-runtime` and `@ramonda/core/jsx-dev-runtime`.
  Both are needed — every bundler's development mode imports the second one.

  Fragments still do not exist. `<>…</>` throws with the reason rather than half-working, because one
  tag producing several elements is what the one-tag-one-element rule is about.

- e06dd85: RMD030 — state written during `[INSPECT]()`

  `[INSPECT]()` describes an instance to the devtools panel. The panel calls it on every commit while
  it is open on the components tab, so writing `@state` from inside it closes a circle: the write
  schedules a render, the render commits, the commit pings the panel, and the panel asks again.

  Two things go wrong, and the second is the worse one. The app does more work to reach the same
  screen — and the values on screen stop being the values the app had, handed to the one reader least
  able to doubt them, at exactly the moment they are trying to work out what is wrong.

  Nothing caught it before: RMD009 watches for a component that will not stop rendering, and this only
  turns while somebody is looking. Measured, five scans moved a counter five times and reported
  nothing.

  The third of a family — RMD001 during `render()`, RMD018 during a `@compute` — and built the same
  way, so a describe that throws still clears the phase rather than blaming the next write anywhere in
  the app.

  Read fields, derive values, return. To cache something, use a plain field rather than `@state`,
  which is what `Form` and `Mutation` already do.

- 4385dec: The JSX factories return `VNode`, and a list item that is not an element is reported (RMD031)

  `__h`, `jsx`, `jsxs` and `jsxDEV` declared `RamondaNode`, which is `VNode | VNode[]` — but every tag
  the types accept builds exactly one element. The wide return described only an unreachable branch (a
  function in tag position, which TypeScript already rejects at the call site) and cost every caller
  that builds a vnode by hand a cast back: a route table generated from a content directory, a table
  cell, a test that bootstraps a component. Those casts are gone.

  **RMD031 — a list item that is not an element.** A list writes each row's key onto the vnode it gets
  back, and the diff matches rows on that key, so one item has to become one element. Anything else had
  no `attributes` and threw `Cannot set properties of undefined (setting 'key')` — a message about the
  assignment rather than about what to write instead. The item is now named and skipped, in production
  too, so the page loses one row instead of the whole tree.

  The case it is about is a nested list: a list of pages, each holding rows. The inner `list()` is a
  descriptor, not an element, so nesting goes through a component — `as: PageView` — whose host element
  wraps the inner rows and carries the key.

- e06dd85: Two diagnostics from reading React's warning list: RMD028 and RMD029

  **RMD028 — markup the HTML parser is not allowed to keep where you put it.** A `<div>` inside a
  `<p>`, an `<li>` outside a list, a `<tr>` outside a table, a `<form>` inside a `<form>`. All of them
  work perfectly on the client, because the DOM is built with `appendChild`, which puts a node exactly
  where it is told. A parser does not:

  ```
  your markup:    <p>intro<div>a block</div></p>
  what a browser
  builds from it: <p>intro</p><div>a block</div>
  ```

  So the mistake is invisible through any amount of SPA development and appears the first time the
  page is server-rendered — and what it reported then was a hydration mismatch (RMD007) whose advice
  is about `new Date()` in `render()`. The server sent the right markup; the parser moved it. This
  says so at the moment the element is created, and names what the parser will do with it.

  **RMD029 — a boolean attribute given the string `"false"`.** `disabled="false"` disables the
  control; `hidden="false"` hides the element. A boolean attribute is true whenever it is present, so
  the string turns it on and the element does the opposite of what the line says. Pass the boolean —
  `disabled={false}` removes the attribute, which is what makes it off.

  Not fixed for you on purpose: `<input disabled="false">` is disabled in every browser by the HTML
  spec, and quietly deciding otherwise would make our JSX mean something different from the markup it
  emits. Only the exact string `"false"`, and only on the spec's boolean attributes — `aria-hidden="false"`
  is valid and is left alone.

  Both are development-only and read tag names and one value; production builds strip them.

## 0.9.0

### Minor Changes

- f0ef39c: A hook's props callback is cached on the signals it reads

  `this.use(Hook, () => ({ ... }))` used to run on every render of the owner. It now runs when a
  signal the callback read has moved — the same contract `@compute` gives a getter — and on the
  renders where none of them did, the previous bag is handed over unchanged, down to the arrays and
  closures inside it.

  **Why.** Every prop is a signal, so a rebuilt object was a _changed_ prop: a `@compute` inside the
  hook recomputed, a `@watchProp` fired, a subscription reconnected — because the owner rendered for
  an unrelated reason. The fix used to be the app's to write, and RMD022 asked for it by name. Ten
  hooks over five renders with one signal changing, counted: **50 callback calls and 50 hook
  recomputes before, 5 and 5 now.**

  ```tsx
  // Written the plain way, and now also the cheap way.
  private list = this.use(Filtered, (self: Panel) => ({
    filter: { q: self.query },             // one object until `query` moves
    onPick: (id: string) => self.pick(id), // one closure, likewise
  }));
  ```

  `render()` is untouched — it still runs on every rebuild. This skips asking a hook for a bag
  nothing it reads could have changed; it does not skip a render.

  **What still needs `@StableProps`.** The cache stops the _call_. On a render where the callback does
  run, every array and object in it is fresh, and the key that did not change is woken along with the
  one that did. That is what the declaration is for, and it is unchanged.

  **One thing can break: a props callback reading a value no signal backs.** A plain field standing in
  for state used to work by accident — the write scheduled nothing, and the next render for any other
  reason rebuilt the bag and carried the new value along. That render no longer calls the callback, so
  the hook keeps what it had.

  ```tsx
  class Panel extends Component {
    items: string[] = []; // ✗ not @state — invisible to the cache
    @state items2: string[] = []; // ✓
  }
  ```

  New diagnostic **RMD027** reports it: under a strict render, a callback the cache skipped is called
  anyway and the two bags compared by value. Rebuilt-but-equal objects and closures are not reported —
  those are what the cache is for.

  **RMD022 now counts runs before it speaks.** It used to report any value built in place, the first
  time it saw one. That included `key: ["user", self.props.id]`, where the array genuinely differs
  each time and the recommended `@StableProps("key")` would change nothing. It now needs a second
  condition — the prop was rebuilt on four consecutive runs of the callback and its value never
  moved — the same threshold RMD024 uses. The non-determinism finding (`Math.random()` in the bag) is
  still reported on the first occurrence: that is a fault, not churn, and the cache makes it worse
  rather than better.

## 0.8.0

### Minor Changes

- 85e6024: `stable()` is gone, and the comparison behind `@StableProps` no longer guesses from a sample

  **`stable()` is removed.** It was the call-site half of a pair — `@StableProps` for a hook you own,
  `stable()` for one you do not — and it was the half that put a hook's own semantics into the app's
  code. Two things settled it:

  - It is a **wrapper that compares**, and any such comparison has to be bounded to be affordable. So
    it quietly stopped helping on a value large or deep enough, with nothing to tell you.
  - What it was for belongs to the hook. A reusable hook is written against what it might be handed,
    not against a well-behaved caller — `Query.onKeyChanged` compares the key part by part before
    doing anything, _even though the framework already did_. A hook written that way needs no wrapper;
    one that is not has a problem a wrapper only hides.

  **What to write instead.** If you own the hook, `@StableProps` — unchanged, and now the only way to
  say it. If you do not, hold the value somewhere that HAS an identity and hand that over:

  ```tsx
  @compute get series(): readonly number[] {
    return [this.props.a, this.props.b];
  }

  private chart = this.use(SomeChart, (self: Panel) => ({ series: self.series }));
  ```

  Know what that is and is not: a `@compute` is invalidated by the signals it **read**, so its
  identity follows its dependencies rather than its contents. One whose answer is coarser than its
  inputs — `this.noise > 5`, `items.length` — hands over a fresh value whenever those inputs move,
  even though the answer did not, and splitting it in two does not help because invalidation
  propagates rather than being deduplicated by value. That is what RMD024 reports, and absorbing it is
  the hook's job. RMD022's and RMD024's fix text now say all of this.

  **And a real bug, found from `@ramonda/form`.** The comparison behind `@StableProps` compared the
  first fifty items of an array and then answered "equal" for the rest — a verdict from a sample,
  where its own docstring promised "past the depth **or the width**, two different objects are simply
  called different". So two sixty-item arrays differing only at index 55 compared as equal, a declared
  prop was handed back its previous value, and the change was gone with nothing reported. It answers
  "different" past the width now, which costs a wide array a fresh reference every render — correct,
  just not optimal, which is what both bounds were always documented to cost.

  One consequence worth naming: RMD020/RMD022 pick their WORDING from the same comparison, so a pair
  that is wider than the bound is now described as non-deterministic rather than as rebuilt in place.
  A less precise message, never a wrong verdict — something was rebuilt either way, and both messages
  say so. The depth bound has always behaved like this.

### Patch Changes

- 391e16e: Server-rendered HTML no longer depends on the DOM to lowercase our tag names

  `h` uppercases an HTML tag on purpose: a real node reports `nodeName` in uppercase, the diff compares
  against it on every pass, and converting once at construction beats converting on every comparison.
  So `createElement` has always been called with `"DIV"`.

  A browser and jsdom lowercase a created element's local name in an HTML document, so that was
  invisible — every test passed either way. It is a dependency on the DOM normalising for us, and a
  partial DOM does not: linkedom keeps what it is handed and serves `<DIV id="page">`. Valid HTML, and
  identical once parsed (measured), but not what anyone should find in view-source on a page we served.

  `createElement` is now handed the lowercase name. It is the right side to pay on: an element is built
  once and diffed many times, so the hot path is untouched.

  **The SVG branch is deliberately excluded.** SVG names are case-sensitive — `linearGradient`,
  `clipPath`, `foreignObject` — and `h` never uppercases them for that reason. Lowercasing there would
  turn `linearGradient` into a different element that renders nothing, on any page that happens to have
  a gradient.

  Asserted at the CALL rather than at the result, because the result is exactly what hid this: the
  tests spy on `createElement`/`createElementNS` and check the names we ask for. Both halves are
  verified load-bearing — reverting the lowercase fails two, and extending it to SVG fails two others.

- 4a44300: A server render no longer attaches event listeners

  A listener is not an attribute, so `innerHTML` cannot serialize one — attaching them on the server was
  harmless, and that is why it stood: skipping looked like it would cost the client a check to save work
  nobody sees.

  Measured, and it is worth it. 100 rows with four handlers each — 400 listeners — rendered in 2.104 ms
  with them attached and 1.222 ms without: **42% of a listener-heavy server render**, and it also drops
  the `_listeners` bookkeeping those elements were carrying for nothing.

  The client pays one boolean, already in hand, tested inside a branch that was about to make two DOM
  calls anyway.

  **Which side it is comes from the owning component's runtime, not from `getRenderEnv()`.** That
  module-level flag has a documented contract — only `createComponent` may read it, and only for a root
  mount — because it is restored before the first `await`, so an element built during the drain that
  follows would read "client" whatever side it is really on. There is a test for exactly that: a
  `@mounted` that fills a list after an await, whose rows appear in the markup and attach nothing. It
  fails if the flag is used instead.

## 0.7.0

### Minor Changes

- 3fcff59: `INSPECT`: an instance can tell the devtools panel what it actually holds

  The inspector reads `@state`, `@persist`, props and context reads — all four about how a value was
  **declared**. A hook that keeps its state in plain fields behind a `@state` counter therefore showed
  the counter and nothing else. For `@ramonda/form` the whole panel row was `state: { version: 7 }`
  and props that never change: a number going up, and nothing anyone would open the panel to look at.

  That shape is what the framework recommends rather than an oversight. `@state` means "serialise me
  into the hydration blob", so a hook holding a `Date`, a `File` or a class instance keeps them in
  ordinary fields and bumps a counter to schedule the render. `Mutation` does the same with `lastData`.

  So the instance answers for itself:

  ```ts
  import { INSPECT } from "@ramonda/core";

  class Basket extends Hook {
    @state private version = 0;
    private lines: Line[] = [];

    [INSPECT]() {
      return { lines: this.lines, total: this.total };
    }
  }
  ```

  The panel shows it under **Holds**, using the value tree it already had — no new tab, no registry, no
  versioned panel API. `Mutation` implements it too.

  Three properties worth naming, because they are what keep this from becoming a plugin surface by
  accident:

  - **Per instance, found by the walk that already visits it.** `registerStore` was removed from the
    devtools bridge because it let a module-level singleton publish itself, advertising the global
    pattern this framework steers away from. This has the opposite property: an instance outside the
    tree cannot contribute, and one that unmounts stops contributing with nothing to deregister.
  - **Read-only.** This is what the instance _derived_; writing to a copy would change nothing while
    looking as though it had.
  - **A throwing `[INSPECT]()` costs its own row and nothing else.** It is code the framework did not
    write, called during a walk whose job is to diagnose an app that may already be broken.

  **It must be a pure read**, and that is a contract rather than a suggestion. The panel calls it on
  every commit while it is open on the components tab, so writing state from inside it closes a circle:
  the write schedules a render, the render commits, the commit pings the panel, and the panel asks
  again. Nothing catches that today — measured — and it turns only while somebody is looking, which is
  the worst time for an app to start moving under them.

  `Symbol.for`, not `Symbol()`, so two copies of core in one app still agree.

### Patch Changes

- 6e1633e: Fix: a child that renders nothing no longer moves its siblings' DOM nodes

  `filterVirtualChild` drops `null`, `undefined` and booleans, and none of them leaves a node behind.
  A node's **position** among its siblings therefore moves whenever a conditional appears or
  disappears — while the piece of JSX that produced it has not moved at all. Matching unkeyed children
  by position then hands a child the node its neighbour was using.

  It never looked broken. Attributes and text are patched either way, so the page reads correctly
  while focus, text selection, scroll position, the value of an uncontrolled input, a CSS transition
  in flight and any state attached to that element have all moved to a different node. Measured: with
  `{cond && <p/>}` above two `<p>` siblings, a re-render swapped their DOM nodes; with the conditional
  _between_ them, the second `<p>` lost its node on every toggle and got a fresh one back.

  `{cond && <x/>}` is why this mattered as widely as it did — it is how conditionals are usually
  written, and it yields `false`, not `null`. All three hole types behaved the same.

  Each node now records the JSX child slot it was built for, holes counted, and an unkeyed child
  claims the node carrying **its own slot** rather than whatever sits at its position. Position is
  still tried first and is still right on every render where no conditional changed, so the common
  path costs one extra property read. Where a slot has no node, the child mounts a fresh one instead
  of taking a same-shape neighbour's.

  It also removes a scan that predates all of this. When a child had no node to claim, the shape
  search restarted at the front of the pool every time, re-walking entries already claimed by earlier
  children — which can never match. Growing an unkeyed list from 2900 to 3000 rows visited **295,050**
  pool entries to find nothing; it now visits 3,099. The search starts at the first unclaimed entry
  instead, a cursor that only moves forward.

  Two supporting changes:

  - An empty mapped list and an invalid child object used to be dropped from the children array
    outright, which renumbered every sibling after them. They now hold their place: `h` produces one
    children entry per piece of JSX, always.
  - A node adopted from server-rendered markup carries no slot yet, so the first diff after hydration
    matches positionally exactly as before, stamping as it goes.

  Found while building `@ramonda/form`: three `<fieldset>` siblings under one conditional child
  rotated by one on every re-render, which cost each array row its element and its focus.

  **RMD026 is removed.** It was added alongside the first, partial fix to report the ambiguity that
  remained — an unkeyed child handed a same-shape sibling's node. The slot resolves that ambiguity
  rather than describing it, so there is nothing left to report and no keys to add by hand.

## 0.6.0

### Minor Changes

- 854742e: New projects get `jsxFactory: "__ramondaH"` instead of `h`, because a one-letter factory is a name
  someone will reuse — and reusing it broke the file, sometimes silently.

  The factory is only in scope because the bundler injects it, and **a bundler injects an identifier
  only if it is not already bound**. So a binding named `h` wins. Measured with esbuild:

  ```tsx
  const h = 5; // in a function → TypeError: h is not a function
  function h(x) {
    return x;
  } // at module top → NO error at all
  export function Card() {
    return <div>ok</div>; // becomes YOUR h("div", …) — the page is silently wrong
  }
  ```

  The module-level case is the bad one: no error, no warning, wrong output.

  `__ramondaH` is a name nobody writes, so the collision cannot happen. **It costs nothing** — the
  bundle is byte-identical (12223 B gzipped either way on a hello-world), because a named import
  tree-shakes exactly as before and the minifier shortens the binding again. A namespace factory
  (`R.h`) also fixes it and was rejected: it defeats tree-shaking, +36% gzipped.

  **Nothing to migrate.** `h` is still exported and still declared as an ambient global, so a project
  configured with `jsxFactory: "h"` keeps type-checking and building exactly as it did. Only new
  scaffolds and the docs' setup instructions changed.

### Patch Changes

- 8985ae8: An error nobody caught no longer stops the rest of the app from ever rendering again.

  `errorHandler` rethrows when there is no `ErrorBoundary` above the component, and that rethrow went
  straight out through the scheduler. Whatever was still queued stayed queued — and the scheduler is
  built on the invariant that **a non-empty queue means a drain is already pending**, so nothing was
  left to drain it. `addTaskToQueue` then dropped every future update in the process: a component
  already in the queue returned early on `inBuildQueue`, and one that was not skipped its
  `queueMicrotask`, because a queue that is not empty is supposed to already have a drain coming.

  Measured on three siblings where one throws in `render()`:

  ```
  before:   bad:0 | good:0 | unrelated:0 | bad:1
  after:    bad:0 | good:0 | unrelated:0 | bad:1 | good:42 | good:100 | unrelated:7
  ```

  `good` was set to 42 and then 100; `unrelated` was not even part of the failing drain and only went
  dirty afterwards. Neither rendered again. There was no symptom — nothing logged, nothing thrown a
  second time, the DOM simply froze while state kept changing underneath it.

  The drain now restores that invariant on its way out, whether it leaves normally or through a
  throw: anything still pending gets another drain scheduled. Nothing is cleared and nothing is
  abandoned, so a pending update is deferred rather than lost. Error handling itself is untouched —
  the same single error propagates to the same place it always did.

  Also: a throwing effect body no longer leaves the reactivity tracking scope set. `currentEffect` is
  a module global, so leaving it set does not fail in the effect that threw — it fails everywhere
  else. Every `State.get()` in the app then recorded itself onto a dead effect's dependency set,
  holding a strong reference to every signal read from that point on, and nothing reset it until the
  next effect flush (which, if that component was the only one with effects, never came). It is now
  restored in a `finally`, along with the effect's own dependency bookkeeping.

## 0.5.0

### Minor Changes

- 3c344f9: `requestContext()` now works in the browser — and opting a value into the client is explicit.

  **Fixes a real gap:** nothing installed a request scope on the client, so a component that read
  `requestContext()` directly in `render()` worked on the server and **threw during hydration**
  (`"requestContext() was called outside a render"`). `hydrateRoot` and `bootstrap` now install a
  browser scope, so such a read returns a value (if it was exposed) or nothing — never a crash.

  **Nothing travels unless you say so.** A key opts in:

  ```ts
  export const currentUser = requestKey<User | null>("currentUser", {
    exposeToClient: true,
  });
  ```

  Exposed values ride one blob on the root element (`data-ramonda-request`), and the browser reads
  them back through the same `requestContext().get(key)`. Everything else stays on the server:
  **cookies and headers can never be exposed** (they are the server's, and an httpOnly cookie is
  invisible to JS anyway), and a key that did not opt in does not travel. Reading any of those in
  the browser returns nothing and reports the new **RMD025** in development, rather than throwing —
  breaking the page would be worse, and a real divergence is already reported by hydration.

  Also: in the browser `requestContext().url` follows the address bar, so it stays correct after a
  client-side navigation instead of freezing at whatever the server rendered.

  Most apps need none of this — reading the request in `@created` and keeping the result in `@state`
  already travels, because `@created` is skipped on hydration and the state is restored from the page.
  `exposeToClient` is for when several components read the same value straight from the context.

- 621eaeb: `@Host`, `@onElement` and `@shouldUpdateOnPropsChange` are now refused on a hook by **TypeScript**,
  not only at runtime — and the two that failed badly now fail clearly.

  Before: `@Host` on a hook was **silently ignored** (the metadata went to a class no render path
  consults), and `@onElement` died with `Cannot read properties of undefined (reading 'enhancedNode')`
  — an error naming nothing the author wrote. Only `@shouldUpdateOnPropsChange` explained itself, and
  none of the three was a type error.

  Now each is refused twice: the type rejects it at the decorator, and a build with no types throws at
  construction with a message that says where the decorator belongs instead.

  ```
  [Ramonda] @onElement is for components, not hooks. It binds a listener to the component's
  host element, and a hook has no element of its own. Move the listener to the component that
  uses <Listening />, or use @onWindow / @onDocument, which work on both.
  ```

  Everything else in the decorator set works on a hook — measured, not assumed: `@state`, `@persist`,
  `@compute`, `@memoizedHandler`, `@created`, `@mounted`, `@destroyed`, `@updated`, `@watchProp`,
  `@deferHydration`, `@onWindow`, `@onDocument`, `@interval`, `@timeout`, and your own subscription
  decorators. A new [decorator table](https://ramonda.pages.dev/reference/decorators) answers all
  three questions at once: where each runs, what it goes on, and whether it may repeat.

- 4850a4e: A missing context provider (`RMD003`) is now reported when the consumer **mounts**, not when a
  value is first read — and nothing has to be declared to get it.

  The information was always in the hook: `this.use(ThemeConsumer)` names the context, and the
  consumer resolves its provider once, at construction. So the answer exists at mount. Waiting for a
  read gave the same answer later, and for a value read only down a branch nobody clicks, never at
  all — which is the fault worth catching: the page renders, the default fills in, nothing looks
  wrong.

  The report names the component the provider has to go above:

  ```
  [RMD003] Context consumed without a provider above it
  <Panel /> mounts ThemeConsumer with no Provider on any ancestor, so every key it reads
  gets the default below.
  ```

  `createContext` takes one new option, for the case where the default IS the answer:

  ```tsx
  const [ParamsProvider, ParamsConsumer] = createContext(
    { params: {} },
    { label: "RouteParams", optional: true }
  );
  ```

  The flag belongs to the context, not to each consumer — whoever wrote `createContext` is the one
  who knows whether the default is a real answer or a stand-in for something missing, and they say it
  once. The router's `params` context is marked `optional`, because a nav bar beside the outlet
  legitimately has no matched route above it. `@ramonda/check` honours the same flag, so the static
  and runtime checks agree.

  Development-only, as before: a production build reports nothing and reads exactly the same values.

### Patch Changes

- e932acf: Diagnostic severities now follow one rule: **error means the end result is wrong; warning means the
  result is the same and the app just did more work to get there.**

  That matters because the devtools panel raises its alert only for errors, so a fault that produces
  wrong output has to be one. Re-graded to **error**:

  - **RMD003** — context consumed with no provider above it. The consumer silently gets the default,
    so someone reads and acts on data that is not what the app meant to show.
  - **RMD010** — a default host the parent does not allow: the browser rearranges or deletes the
    markup, so the page is not what was written.
  - **RMD016** — a component updating while detached: `@destroyed` never ran, its timers and listeners
    are still live, and every render goes into nodes nobody can see.
  - **RMD017** — a deferred hydration that never resumed. The page looks finished but that subtree
    never becomes interactive.
  - **RMD021** — a clock or random read in a `@compute`: the value freezes, and the reader is shown a
    number that stopped moving.
  - **RMD023** — components built from an array with no keys: items are matched by position, so state
    lands on the wrong row.
  - **RMD025** — per-request data read in the browser: the reader gets nothing where the server had a
    value.

  Still warnings, because the outcome is unchanged and only the cost is not: RMD008 (a write after
  unmount is dropped, and there is no page left to update), RMD020, RMD022, RMD024.

  The rule is now stated in the diagnostics reference, and on the type that carries it.

## 0.4.0

### Minor Changes

- f200db8: Add `renderStatic(vnode, url)` — the build-time render that PROVES a route holds no
  per-request data before it is baked.

  It renders with the request context poisoned (`requestContext()` reads throw and are
  recorded), and returns either `{ html }` — safe to bake — or `{ blockedBy }` naming the
  per-request field that was read, meaning the route cannot be prerendered and must fall back
  to per-request rendering. This is the guard that makes opt-in SSG safe: a page that reads a
  cookie, header, or seeded value literally cannot be turned into static HTML, so one visitor's
  data can never end up in another's cached page.

  It catches reads wherever they happen — `render()`, `@created`, and even an async `@mounted`
  (whose throw is swallowed by the render drain, so the read is _recorded_ on the scope and
  checked afterwards). `url` stays readable throughout (it is the page identity). Sequential by
  design (a build renders one page at a time) — not for serving concurrent requests.

- f8e7671: Add `requestContext()` — per-request data with a build-time safety guard.

  Per-request data (cookies, headers, the signed-in user) is now reachable only through
  `requestContext()`, so a static build can PROVE a route touched none of it before baking:

  - `requestContext().url` is always safe (it is the page identity).
  - `requestContext().cookies` / `.headers` / `.get(key)` return real values on the server and
    the exposed subset on the client, but **throw during a static build** (`RequestReadDuringBuild`).
    A page that reads the request literally cannot be prerendered, so one user's data can never
    end up in another's cached HTML.
  - `requestKey<T>(label)` declares a typed per-request slot; `seedRequest(key, value)` fills it
    on the server before the render; the tree reads it with `requestContext().get(key)`.

  This is the safety core for the upcoming per-route SSG/SSR/ISR work (default SSR, opt-in
  prerender guarded by this poison). New exports: `requestContext`, `requestKey`, `seedRequest`,
  `RequestReadDuringBuild`, and the `RequestContext` / `RequestKey` / `RequestCookies` /
  `RequestMode` types.

- 32c9f41: `renderToString(vnode, { request })` — per-request server renders, so `requestContext()`
  returns real values.

  Pass `{ request: { url, cookies?, headers?, values? } }` and the render runs in "server" mode:
  `requestContext().cookies` / `.headers` / `.get(key)` return the request's real data instead of
  throwing. This is the dynamic (SSR) counterpart to `renderStatic`'s poisoned build render.

  The scope is live only across the render's **synchronous** section (the same window and the same
  concurrency guarantee as `renderEnv` — two concurrent requests must not share it across an
  `await`). So read `requestContext()` **synchronously**: in `render()`, in `@created`, or before an
  `@mounted`'s first `await`. The idiomatic pattern needs nothing more — read the request in `@created`
  and store it in `@state`; `@created` is skipped on hydration and the `@state` is restored from the
  page's state blob, so the client never re-reads the request and there is no separate request blob
  to ship. New types: `RenderToStringOptions`, `ServerRequestInit`.

## 0.3.0

### Minor Changes

- cb289b6: Edit a `@state` value from the panel.

  **✎** on a state row opens the value as JSON in place: Enter applies, Escape abandons, and a
  multi-line value takes ⌘/Ctrl+Enter so plain Enter stays a newline. Invalid JSON never reaches the
  app — the parse happens first and the row says what was wrong.

  The write side of the bridge is deliberately narrow: **one field, addressed by a handle the last scan
  handed out, and only when that field is `@state` or `@persist`.** There is no way through it to an
  instance, a method, or a prop. A handle from an older scan is refused rather than landing on whatever
  now occupies that slot.

  Two limits are the framework's rules, not the panel's, and both are stated in the UI:

  - **You edit the whole field.** A signal holds a value, not a proxy, so mutating inside an object
    notifies nobody: "change `user.name`" has to become "assign a new `user`". The panel is held to the
    same rule as application code.
  - **Props have no pencil.** They are owned by whoever rendered the component and assigning to one
    throws in every build (RMD004 / RMD015). A box that pretended otherwise would either throw or look
    like it had worked until the next render put the old value back. Same for a hook's props, which come
    from its owner's callback. Core refuses the write; the panel does not offer it and says why if it is
    attempted.

  A value that cannot survive a round trip through JSON — a function, a `Map`, a DOM node — gets no
  pencil either, rather than a box that fails on Enter. The write itself goes through the ordinary
  setter, so the signal notifies, the component rebuilds, `@updated` runs, and a diagnostic fires for a
  non-serializable value, exactly as if the app had assigned it.

- 066dcf9: `</>` on any row in devtools opens that component's definition in your editor.

  This closes the flow the navigation work was for. You could already point at something on the page,
  find its component and focus it — and then you alt-tabbed and searched for the class by name. That
  was the last manual step, and the most frequent one.

  **Where the location comes from, and why it needs nothing from you.** The framework reads it off the
  stack the first time a component or hook is constructed. That was measured before it was built on: a
  subclass appears in a stack by name even when it declares no constructor of its own, and the frame's
  position is the class declaration. So there is no build plugin to install, no JSX transform to switch
  to, and no decorator a component has to carry — a bare `class Foo extends Component` is located like
  any other. One `Error` per class, cached, in a development build only.

  The alternatives were each worse: a JSX transform gives the call site (`<Foo />`) rather than the
  definition, and esbuild only injects source for the automatic runtime, which this framework does not
  use; a build plugin would be accurate and would also be a thing every app has to configure.

  **Opening goes through the dev server**, not through a `vscode://` link: Vite's `/__open-in-editor`
  hands the file to whatever editor is running on the machine that serves the app, so nothing has to be
  registered or configured, and the browser never needs the absolute path. Without that endpoint — a
  custom server — the location is copied to the clipboard and the log says so, because a button that
  silently does nothing is worse than one that hands you something to paste.

  **The position is resolved through the module's own sourcemap**, and that turned out not to be
  optional. A stack reports the file the engine loaded, and `Error.stack` is never sourcemapped
  (browsers apply sourcemaps when _displaying_ a stack, never in the string). Measured against Vite 7
  serving a real page: a class declared on **source line 20** appears on **served line 51**, because
  esbuild lowers standard decorators and prepends a preamble. Thirty-one lines is not a rounding error
  — it is a button that looks broken.

  Vite serves each module with an inline map, so the map is already in the file the browser has
  cached: fetch the module, decode the mappings, look up the segment. Verified end to end against a
  live dev server — served 51 → source 20, exactly the declaration. The file name comes from the map
  too, which is what keeps a bundled development build from opening the bundle instead of the source.
  Everything fails towards the unresolved position, which still opens the right file.

- ddd4a63: A profiler: what one commit cost, and which components it rebuilt.

  The framework's central claim is about the cost of a commit — a render being a few percent of it,
  access tracking turning nine renders into three, structural sharing turning 272 ms into 1.3 ms. Every
  one of those numbers was measured in a test, and none of them was ever visible in the panel. An app
  author could not check the claim against their own app, which is the only place it matters.

  **A commit here is one drain**, not one build: everything a single state change rebuilt, including the
  effects and `@updated` bodies it scheduled. Timing builds and summing them would leave out the diff,
  the DOM and the post-commit flush — the part that hurts.

  **Off until you press record.** A commit is the hottest path in the framework, so sampling it always
  would be a tax on every development build. Measured — and measured properly, because the first attempt
  ran off-then-on once each and reported recording as _faster_, warm-up drift being larger than the
  effect. Alternating runs, medians of seven rounds of 200 commits over a 51-component tree:

  ```
    off        253.9 ms
    recording  263.0 ms   → 3.6%
  ```

  The `PROFILE` tab lists commits newest first with their duration, and under each one the components
  that made it up with their share. The **count** is usually the more useful number: `Row ×40` after
  changing one row is not a slow component, it is forty renders that did not need to happen. A list
  rather than a flamegraph, deliberately — a flame chart of a flat drain is a picture of one bar.

### Patch Changes

- 8d76b4e: A check that a workflow does not bypass turbo — the gap the docs deploy fell through.

  `pnpm check` and CI both go through turbo, so both were green while `deploy-docs.yml` ran
  `pnpm --filter @ramonda/docs build` directly and skipped the `content` task that `build` declares in
  `dependsOn`. The gap was never in _what_ is built; it was in _how a workflow asks for it_, and nothing
  looked at that.

  `scripts/check-workflows.mjs` reads `turbo.json` for the tasks that have dependencies, scans the
  workflows, and refuses to see one of those invoked as a package script. Narrow on purpose: only a task
  with a `dependsOn` can silently lose a step this way.

  It runs in `pnpm check` and in CI, its self-test first — and the self-test earned its place immediately.
  The first version anchored its patterns to the start of the line, which in YAML sits after `run:`, so it
  matched nothing and pronounced the still-broken `deploy-docs.yml` clean. The self-test now checks both
  directions: the offending line is caught, the corrected one is not.

- 772557f: Why the devtools import lives in your app and not in `bootstrap`, with the measurement.

  Asked: the one line every app writes — `if (import.meta.env.DEV) void import("@ramonda/devtools")` —
  would be cleaner inside `bootstrap`. It cannot go there, and the reason is now recorded in core and on the
  devtools page rather than left as folklore. Measured on an app that has **not** installed the panel, which
  is most apps:

  ```
  vite build   →  "[vite]: Rollup failed to resolve import "@ramonda/devtools""   the build FAILS
  esbuild      →  bundles, leaving import("@ramonda/devtools") in the output      fails at runtime
  ```

  So a literal specifier inside core would break `vite build` for everyone who does not use devtools, and
  ship an unresolvable bare specifier for everyone who uses esbuild. Core's speculative import therefore
  keeps its **variable** specifier plus `@vite-ignore`, which no bundler rewrites — meaning the browser
  would have to resolve a bare specifier itself, and it cannot.

  Only the app can load the panel: it is the one that knows the package is installed, and its bundler is the
  one that can resolve it. Nothing changed in the code; what changed is that the next person to ask gets an
  answer with numbers instead of an assurance.

- ae22ab7: The docs deploy built nothing, because it bypassed the task that generates the content.

  ```
  ✘ [ERROR] Could not resolve "./generated/content"
  ✘ [ERROR] Could not resolve "./generated/page-loaders"
  ✘ [ERROR] Could not resolve "./generated/preloads"
  ```

  `content` was moved out of the docs build script and made a turbo task, to stop two processes rewriting
  `src/generated/` while `tsc` read it. `build` picks it up through `dependsOn` — but only when turbo is the
  one calling. The Cloudflare workflow ran `pnpm --filter @ramonda/docs build` directly, so nothing ever
  generated the directory.

  It goes through `turbo run build --filter=@ramonda/docs` now. And because the symptom named the wrong
  thing — three missing imports read as a broken repository rather than a skipped step — the docs build
  begins with one `existsSync` that says which step to run. Reproduced by deleting `src/generated/` and
  watching both the old failure and the new sentence.

- efed944: The documentation no longer teaches a decorator that does not exist.

  `@effect` was removed in 0.1.0, and the word stayed behind: the root README listed it among the
  decorators, core's README had a table row for it, `@ramonda/query`'s README explained mutation rollback
  by comparing it to "the cleanup contract `@effect` uses", and the sidebar group was called _Lifecycle and
  effects_. A reader following any of those looks for something that is not there.

  The `/concepts/subscriptions` page also stopped explaining itself as a migration. Its "There is no
  `@effect`" section was written for someone who had used the old decorator; it now answers the question a
  reader actually arrives with — _where did `useEffect` go_ — with a table from what you want to the name it
  has here, and keeps the reason: an effect is defined by its dependencies rather than its purpose, so one
  decorator would have to be all four of those things, and which one it was would depend on what its body
  happened to read that render.

  Elsewhere "effects" was the runtime's own vocabulary leaking into prose a reader cannot look up ("after
  this commit's `@mounted`s and effects"); those say _subscriptions_ now.

- 43c02cb: Two committed failures that `turbo run` cannot see, and a `pnpm check` that would have caught them.

  The branch was green on `turbo run check-types test build` while carrying a sparse array in
  `apps/playground-ssr/server.mjs` (`?? [, target]`, which oxlint's `no-sparse-arrays` refuses) and a
  misformatted `apps/playground-core/src/pages/QueryPage.tsx`. Both would have failed `ci.yml`.

  The reason turbo missed them: **no app under `apps/` has a `lint` script**, so `turbo run lint` covers
  `packages/` only — and `format:check` is not a turbo task at all. Both are root scripts, and CI runs the
  root scripts. `pnpm check` now runs the same four in the same order, and the gap is written down in
  `.github/workflows/README.md` rather than left to be rediscovered.

  The parse rewrite was checked against the original on seven inputs, including the no-colon and
  `src/x.tsx::9` cases, before replacing it.

- ad517f7: The documentation now says why there is no post-commit `@watchProp`.

  It is the obvious sugar — "run this after the commit, but only when this prop changed" — so its absence
  was reading as a gap. It is a decision, and `/concepts/lifecycle` now gives the three reasons: it would
  be strictly narrower than `@updated` (props only, not a hook's state, not context, not any other cause
  of a commit — which the DOM cases usually are); its state write could not fold into the render the way
  the in-build one does, so the framework would have to start comparing your props for you; and the `if`
  it would replace answers "is the DOM already how I want it", which only the author knows.

  `@watchProp` before the render, `@updated` after it, one field comparison for the guard. No new API.

- 2bdb5f7: The docs build died on CI's first line, and the cause was the Node version rather than the code.

  ```
  SyntaxError: The requested module 'node:fs' does not provide an export named 'globSync'
  ```

  `fs.globSync` landed in Node 22. CI pins Node 20, the machine that wrote it runs 24, so every local run
  was green and the first push was not. The diagnostics-coverage check now walks with `readdirSync`
  (`withFileTypes`, Node 10), verified to find **the identical file set** — 81 files in core, 19 in query —
  and then run under Node 20.20.2 itself, which is the exact version CI installs.

  The whole gate was re-run on that Node with `--force`, because turbo will otherwise replay results cached
  from a different runtime and report a pass without running anything: **29/29, 0 cached**.

  `pnpm check` now begins with a preflight that reads the pinned version out of the setup action and warns
  when the local major differs. It warns rather than fails — a newer Node is not a mistake, and stopping
  work over it would be. What it buys is that the next time CI breaks where local passed, the first guess is
  already on screen.

- 9e29131: The SSR smoke test asserted that the machine has an editor, which a CI runner does not.

  It called `__open-in-editor` and required a `200`. Opening a file needs an editor, and `launch-editor`
  finds one from `$EDITOR` or by guessing from the process table — so a developer with an IDE running got a
  `200` and the runner got `500 no editor found`.

  What the endpoint is for is resolving the path, and an unresolvable path is refused with `422` **before**
  any launch is attempted. So reaching the launch is the proof, and a `500` saying "no editor found" now
  passes. To keep that from becoming "accept anything", the test makes a second request for a file that does
  not exist and requires the `422` — deleting the server's `existsSync` guard turns that assertion red,
  which is how it was checked rather than assumed.

  Reproducing a runner locally needs `ps` shadowed as well as `$EDITOR` cleared, since the process-table
  guess finds your editor either way. That recipe is in `apps/playground-ssr/README.md`, and the whole gate
  was re-run under it: 29/29, 0 cached.

- ba9845c: A tagline that says what Ramonda is: **Explicit. Predictable. Readable.**

  The old one listed implementation choices — class components, signals, TC39 decorators — which is what a
  reader compares against their existing habits rather than a reason to look further. Nothing in it said
  what you get.

  Three words, in the order they cause each other: _explicit_ is how you write it, _predictable_ is how it
  runs, _readable_ is what you get back when you return to it a year later. No second sentence: the
  `Counter` example directly below is a better argument than an adjective defending an adjective.

  `keywords` in `package.json` still carries `signals`, `decorators`, `ssr` and the rest, so nothing was
  lost for npm search — those words moved to the field that search actually reads.

  Six places now agree: both READMEs, core's npm description, the docs social card, and both scaffolded
  apps. The SSR template keeps "Server-rendered, then hydrated", which is a fact about that app rather than
  the tagline.

## 0.2.0

### Minor Changes

- 2562896: A context consumer is no longer an empty node in devtools, and the pair is named Provider/Consumer
  throughout.

  **What a consumer reads is now visible.** A consumer holds no state and no props — every value it
  exposes is an accessor over the provider's signals — so it appeared in the panel as a node with
  nothing in it: the emptiest thing in the tree being the hook whose entire job is reading. It now
  reports, under `Reads from context`, the keys it is subscribed to with their current values, and
  names the keys it has never read.

  The catch, and the reason the consumer answers for itself rather than the panel walking its
  properties: **reading is subscribing.** A consumer's getter attaches a listener on first read, so a
  panel that read every key would silently widen what the owning component re-renders on. Only
  already-subscribed keys are read, where the subscribe branch is a no-op. There is a test that
  changes a key the consumer never reads and asserts it did not rebuild — inspecting must not change
  behaviour, and here the ordinary read does.

  Seeing which keys a consumer actually reads is worth it on its own: it is the fine-grained
  subscription made visible, the difference between "this one wakes on `color`" and "on anything in
  the theme".

  **Naming.** The docs already destructured `[ThemeProvider, ThemeConsumer]` while the framework's own
  source, tests and playground said `ThemeContext` — and devtools, which labels the hook
  `${label}Consumer`, disagreed with the code in front of you. `Consumer` everywhere now. It is also
  the more accurate name: the pair is a provider and a consumer, and unlike React's context object
  there is nothing here to take a `.Provider` off. Only local destructuring names changed; no API did.

- 8caeaf5: `RMD024` — a `@compute` that recomputes over and over and keeps producing the same answer.

  A compute is invalidated by the signals it READ, so if one of them is a rebuilt reference — an
  array literal in a hook's props bag, a fresh object handed down as a prop — it recomputes on
  every pass and answers the same thing. Its cache does nothing, and the work is silent: the
  answer is correct, so nothing looks wrong.

  **Neither neighbouring check can see it.** RMD020 renders twice, and inside one strict render
  the compute is _cached_ between the two calls, so both get the same value. RMD022 compares two
  props bags, but skips a prop declared with `@StableProps` or wrapped in `stable()` — and a
  compute reading a component's prop is outside its reach entirely.

  Three consecutive equal recomputes, not one: a dependency moving while the answer happens not
  to change is ordinary, and reporting that would put a warning on correct code. One bounded
  `valueEqual` per recompute, development only.

  Keyed by instance and member rather than by the cache, because two instances of one component
  are two questions and one churning says nothing about the other. The test for that asserts the
  report count, not its presence.

  The honest limit is stated in the docs: a compute reading _only_ something non-reactive — a
  counter, `Date.now()` — is never invalidated, so it never recomputes and is never seen. Nothing
  can report a value nobody asked for again.

  Also in this release: **`@ramonda/devtools` is type-checked.** It had no `tsconfig.json` and no
  `check-types` script, so 600+ lines of TypeScript that ship to users were checked by nothing;
  `turbo run check-types` now covers 8 packages instead of 7. Found while looking into whether
  five packages needed `@types/node` — none of them did (the `node:` match in the router was
  `vnode:`), so five dead dependencies were not added, and this was the real hole behind that
  note.

### Patch Changes

- 38274cd: The development-only browser setup is guarded on `customElements`, not on `document`.

  A server render can have a `document` — this repo's own SSR playground gives its Node process a
  jsdom one — so `typeof document !== "undefined"` never meant "browser". It did not matter while
  every browser API in that block sat inside the dynamic import's `.then()`, which fails on the
  server. Moving the devtools mount out of that callback put `customElements.whenDefined` on the
  top level, and the SSR playground died at import:

  ```
  ReferenceError: customElements is not defined
  ```

  The panel IS a custom element, so the registry is the capability that actually has to exist.
  Guarding on what the code needs, rather than on a proxy for the environment, is the fix.

  **And the reason nothing caught it: `apps/playground-ssr` had no `test` script**, so CI ran
  nothing against the one thing in this repo that is a real server. It has one now — a smoke test
  that spawns the built server as a child process and asks it for `/`, checking the root element,
  server-rendered content and a hydration blob. Deliberately shallow and deliberately real: no
  jsdom substitute, no mock. `/` rather than `/products`, because that route fetches from a public
  API and a smoke test must not depend on the network.

  Verified to have teeth: with the old `document` guard restored, it fails with
  `the server exited with code 1 before serving anything` and prints the `ReferenceError`.

## 0.1.0

### Minor Changes

- b208b86: `_`-prefixed methods are bound like any other, `@Host` infers its class, and class
  decorators are PascalCase.

  **Method binding no longer skips `_`-prefixed methods.** The skip was a performance
  opt-out — internal by convention, so binding was not paid for it — and the convention is
  not this framework's to claim. typescript-eslint's `naming-convention` rule is commonly
  configured with `leadingUnderscore: "require"` for private members, so a project with that
  rule wrote `private _apply()` and got a method that silently did not bind:
  `onClick={this._apply}` then lost `this`, with no error and no diagnostic. A lint rule
  chosen for unrelated reasons broke the framework's central promise about methods.

  Nothing internal needed it, which was checked rather than assumed: there are no
  `_`-prefixed members on `Component.prototype` or `Hook.prototype`, `_componentInstance` and
  `_componentDefinition` live on DOM nodes, and `Context`'s `_subscribedKeys` is a field —
  fields are never bound. (The comment justifying the skip pointed at "the note in
  Component.ts". There was no such note.)

  And it bought little. Measured per instance, binding every method against binding all but a
  third of them: 3 methods 41 ns, 5 methods 10 ns, 8 methods 84 ns, 12 methods 212 ns — a
  fifth of a millisecond across a thousand rows, at twelve methods. If an opt-out is wanted
  back it should be an explicit `@unbound` decorator, which says what it does where it does
  it and cannot be triggered by a lint rule.

  **`@Host` needs no type annotation and no type argument.** `self` in its props callback, and
  `props` in its tag callback, are now typed from the decorated class:

  ```tsx
  @Host("section", (self) => ({ "data-label": self.label })) // self is Card
  class Card extends Component<{ label: string }> {}
  ```

  The mechanism is worth recording: both parameter types are CONDITIONAL types over the class
  (`InstanceOf<C>`, `PropsOf<C>`), and a conditional is not an inference site — so TypeScript
  cannot resolve `C` from the decorator's arguments and defers until the decorator is applied,
  where the class supplies it. The obvious shape (a type parameter sitting directly in the
  callback's parameter position) fixes it to `unknown` from an unannotated arrow before the
  class is ever looked at, which is why this used to need `(self: Card)` spelled out.

  **`@stableProps` is renamed `@StableProps`** — class decorators are PascalCase (`@Host`,
  `@StableProps`), member decorators are camelCase (`@state`, `@compute`, `@watchProp`). The
  casing is the only thing that tells you where a decorator goes, and the two groups are used
  in different places. Documented in the API reference.

- 465918f: `this.use(Hook, props)` now infers a **generic** hook's type parameter from the props callback.

  `use` took one union parameter (`props: Q | R` with `R extends (bag: this) => Q`), which cannot type a generic hook class: `HookProps` is `Record<string, any> | undefined` and a function is assignable to that, so with no fixed candidate for `Q` from the constructor, TypeScript inferred `Q` as the callback itself. A hook like `Query<TData>` came out as `Query<unknown>`. The callback now has its own overload, so `Q` is inferred from the return type — and a type parameter that only appears in a prop (`fetch: () => Promise<TData>`) follows from it with nothing declared at the call site.

  **Breaking, in one narrow way:** the callback's parameter is typed `never`, so an _unannotated_ one no longer type-checks.

  ```ts
  // before — `bag` was typed from `this`
  this.use(SizeHook, (bag) => ({ width: bag.props.width }));

  // now — annotate the owner
  this.use(SizeHook, (bag: Panel) => ({ width: bag.props.width }));
  ```

  `never` rather than `any` on purpose: an unannotated parameter fails with `Property 'props' does not exist on type 'never'` instead of silently widening to `any`. Typing it as `this` is not an option — resolving an overload would need the type of the class whose field is being declared, which is a TS7022 circularity on every call site. Every call site in this repo and in the docs already annotates.

- 124d210: RMD023, `static StableProps`, and `each` that takes nothing.

  **RMD023 — components built from an array with no keys.** The check RMD020 cannot make: a
  mapper is handed to `Array.prototype.map` and never stored anywhere a comparison can reach,
  and its output is a run of freshly built vnodes, which is what all JSX looks like. Structure
  is the only evidence — JSX passes children as separate arguments, so a nested array among
  them was built by an expression. `normalizeChildren` brands its own arrays (DEV only) so
  `{this.props.children}` is not mistaken for a mapped one.

  Narrowed twice, and the history is the reason to trust it. Reporting every raw array broke
  10 of core's own tests, all exercising child groups on purpose — a mapped array is a
  supported shape here, with its own key space. What ships reports only what is genuinely
  unhandled: two or more UNKEYED COMPONENT rows, whose identity is their position, so
  inserting or removing anywhere but the end moves state and DOM to the wrong item. Plain
  markup is not reported (the diff patches it and the result is correct), keyed children are
  not reported, forwarded children are not reported.

  **`static StableProps` — the hook declares which props are values, so the call site does
  not.** A query key is a value: `["user", 7]` built again is the same question, and that is
  the hook's knowledge rather than something every component using it should encode. `Query`
  declares `key`, `Mutation` declares `invalidates`, and the framework hands back one identity
  for as long as the contents are equal:

  ```tsx
  key: ["user", self.props.id]; // a plain literal; nothing to wrap
  ```

  `stable()` stays for the other direction — a hook you do not own that declared nothing. A
  declaration cannot cover a function prop: two closures with the same body are not equal by
  any comparison that is safe to make, so a listed function is left alone and still reported.

  **`each` accepts `null` and `undefined`** and renders nothing for them. The list engine
  already handled it; only the type forbade it. This removes the `?? []` that every "data has
  not arrived yet" list was writing — a fresh empty array on every render, which cost the list
  its item scopes and was itself reported by RMD020.

  **Documentation: what a hook author cannot assume.** A reusable hook is written against what
  it might be handed, not against a well-behaved caller — it does not know when it will be
  called, whether a value is the same object as last time, what the value is, or whether the
  diagnostics are even running. So: compare by value what is a value, and be idempotent about
  the rest. `Query.onKeyChanged` is the worked example, comparing the key itself even though
  the framework already did.

- 0cab315: `stable()`, and RMD022 — the strict render now covers a hook's props callback.

  `render()` and a props callback are the same kind of thing: code the framework calls
  unconditionally on every render, whose result is compared against the last one. `render()`
  had both a check and the tools to satisfy it (`@memoizedHandler`, `list()`); a props bag
  had neither. Now it has both.

  **`stable(value)`** keeps an array or object in a bag at one identity for as long as its
  contents are equal — the counterpart of `list()` for a props bag:

  ```tsx
  private user = this.use(Query, (self: UserCard) => ({
    key: stable(["user", self.props.id]),   // the same array until `id` moves
    fetch: self.load,                        // a bound method is already stable
  }));
  ```

  It runs in production too: this is behaviour, not a diagnostic. Contents are compared by
  value to a bounded depth, so a nested literal gets a fresh reference rather than a wrong
  one.

  **RMD022** calls the callback twice in the same tick and compares the two bags, reporting
  a rebuilt array (`stable()`), a rebuilt closure (a bound method, or `@memoizedHandler`),
  or two different contents (the callback is not a function of state). Part of the strict
  render, so `configureDev({ strictRender: false })` turns it off with RMD020.

  **Why it matters more than "an extra allocation".** Every prop is a signal, and a signal
  compares by reference, so a rebuilt array is a _changed_ prop. Measured across three
  renders of the owner: a hook `@compute` reading a rebuilt array runs 3 times where one
  reading a scalar prop runs once; a `@watchProp` on a rebuilt array fires on every update
  render; a child component handed a rebuilt function re-renders 3/3.

  **Why twice on every render, not once at the start.** A callback with an `if` in it only
  ever proves the branch it took, so a first-render-only check passes the case that breaks
  later — while reporting the legitimate branch difference as a fault.

  Also in this release: a production build test. `apps/docs` now builds a fixture
  application and asserts that no diagnostic code, no diagnostic message and no devtools
  reach the output, with a development build as the control so the test cannot pass
  vacuously. It immediately found a real leak: a DEV gate written as `if (!__DEV__) return …`
  with the checks after it, rather than `if (__DEV__) { … }`, left `checkPropsStability`
  reachable and pulled `diagnose` — and every diagnostic's title and fix text, all 21 of
  them — into the production bundle.

- 8cedc9b: New DEV diagnostic: `RMD021` — randomness generated during a `render()`, a `@compute`, a `@memoizedHandler` builder, or a hook's props callback.

  `Math.random`, `crypto.randomUUID` and `crypto.getRandomValues` are patched in development (the trick `timerGuard` already uses for timers) and report when called while one of the four pure phases is running. Four messages, because the same call fails differently in each place:

  - **render** — the output depends on when it ran, so a server render and its hydration disagree (RMD007).
  - **`@compute`** — quieter and worse: the answer is cached, so the value is frozen until a dependency the compute actually READ changes, which may be never.
  - **memoised handler** — the value is cached _with_ the handler, so every call uses the same one. The builder runs during a render, so without its own phase marker the report would have named the render and pointed at the wrong fix.
  - **a hook's props callback** — the sharpest of the four: the callback runs on every render, so the prop holds a different value each time. As a query key that is a new cache entry per render and a fetch that never settles. This is also why the callback does NOT run twice in a strict render — watching the call catches the same mistake, and a callback may do more than build an object.

  **Why it exists next to RMD020.** The double render finds non-determinism only when the two calls differ. Measured over 200,000 tries: `Math.random()` and `performance.now()` differ every time, `new Date()` differs every time (a fresh object), and **`Date.now()` differs in 0.006%** — the two renders are microseconds apart, inside one millisecond. So the double render is blind to a millisecond clock.

  **Why the clock is still not patched.** That was the first version and it was wrong: a patched global catches the _platform's_ calls too. An `Event` constructor stamps `timeStamp`, which under jsdom is a JS-visible `Date.now()` — so raising any diagnostic during a render tripped it, and three of core's own tests began failing with RMD021 instead of the code they asserted. Under jsdom is where every app runs its own tests, which makes that disqualifying rather than fixable. Randomness has no such problem: nothing in the platform generates it behind your back.

  The docs now carry the full inventory of non-deterministic reads and which check covers each — including the one gap neither covers: `Date.now()` in a client-only app, rendered into the output.

- c166868: **BREAKING: `@effect` is removed.** Every case it served has a decorator that says what it
  is for, and having one that said nothing was what made circular updates easy to write.

  Where each case went:

  | what the effect was doing        | what to use                                                                                                                     |
  | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | subscribing to something outside | `createSubscriptionDecorator` — same "return the cleanup" contract, and it re-connects when a signal its `connect` READ changes |
  | reading the DOM after the commit | `@updated`                                                                                                                      |
  | reacting to a prop               | `@watchProp`                                                                                                                    |
  | deriving a value                 | `@compute`                                                                                                                      |

  The machinery is untouched. `attachEffect` still runs the queue after the DOM work, and
  `createSubscriptionDecorator`, `@onElement`, `@onWindow`, `@onDocument`, `@interval`,
  `@timeout` and `@deferHydration` are all still built on it. What went is the door that
  handed the raw body through with no contract about what it returned.

  **Why, in one sentence:** an effect was whichever of those four it happened to be, decided
  by what its body read — so two of them writing what the other read re-triggered each other,
  and nothing could name the cause. RMD009 caught the loop but could only say "this component
  rebuilt 50 times", and its fix text had to guess. Naming what a piece of code is for is what
  lets the framework say something useful when it goes wrong, and makes the ordering knowable
  instead of emergent.

  `Head` was the framework's own last user, and the migration made it smaller: as a
  `@watchProp` whose selector returns a serialized form, the comparison is by value for free
  and the `appliedSnapshot` guard field is gone. That guard only existed because effects run
  child→parent while `@created` runs parent→child, so an effect handed a nested route's title
  back to its layout on the first commit. A `@watchProp` runs in the same order as `@created`
  and does not fire on mount, so both halves agree and the deeper `Head` wins.

  Also in this release, from the same pass:

  - The docs page `/concepts/effects` is now `/concepts/subscriptions`, and it states what
    each of the four replacements is for and when it runs.
  - RMD009's, RMD008's, RMD011's and RMD019's fix texts named `@effect` as the usual cause;
    they now name `@updated` and subscriptions, with the line that matters spelled out — a
    post-render write must CONVERGE, because assigning the same value is not a change and
    schedules nothing.
  - Tests of the shared machinery kept their coverage through a harness in `src/test/`
    (`effectLike`), which is `createSubscriptionDecorator` with the decorated method as the
    whole connect. It lives in `test/` on purpose: it is a way of saying "an effect, unnamed",
    which is the thing that was removed.

- 894b094: New DEV diagnostic: `RMD020` — development builds render every component **twice** and report what came out different.

  With no state change between the two calls, anything that differs was built by the render itself, or does not come from state at all. Three things get named, each with its own fix:

  - **a function built in place** — the source is identical, only the identity is fresh. An event handler whose identity changed is removed and re-added on the element every render; a function passed to a child re-renders that child. `@memoizedHandler` returns the same function for the same arguments, so it reads as stable.
  - **an object or array built in place**, with equal contents — a child re-renders, a `@compute` recomputes, and if it is a list's items every row loses its identity and the whole list is rebuilt.
  - **a value that is not a function of state** — `Math.random()`, `performance.now()`, `new Date()`. Only the part of that class that varies WITHIN a tick: the two renders are microseconds apart, so a millisecond clock reads the same both times (measured: two consecutive `Date.now()` calls differ in 0.006% of 200,000 tries). RMD007 catches those instead, because a server render and its hydration are milliseconds apart. Neither check covers the class alone.

  **Why twice rather than comparing against the previous render:** that comparison cannot tell "created in place" from "genuinely changed". Two calls in one tick can, with no false positives.

  **Why every render:** measured, `render()` is 3-4% of a commit — and 0.04% for a table of 500 rows, because `list()` is lazy, so a second render rebuilds the descriptor and not the items. Checking only the first render would miss every branch not taken then, which is where handlers live.

  **Not** a hook's props callback, and that is a decision the audit made rather than an omission: the callback exists in order to re-run per owner render, so the bag and the closures inside it are fresh by design (a fetcher closing over a prop cannot be stable). Reporting them was a warning per hook with nothing to do about it. A vnode passed as a prop is walked rather than reported, for the same reason at a smaller scale — JSX is a fresh object every render, and what still counts is an inline handler inside it.

  **One thing to expect:** a `render()` with a side effect performs it twice in development. RMD001 already makes a state write there an error, so "render is pure" is the rule either way — but a `console.log` in a render really will appear twice. Production strips the check entirely (verified: no `RMD020` and no symbol from the module survives in the prod bundle).

- 9e87633: `@watchProp`'s selector is typed from the class it is on — no annotation, no type argument.

  ```tsx
  @watchProp((props) => props.userId)   // props is UserProps
  reload(next: string, previous: string) {}
  ```

  `props.usreId` is now a compile error where it used to be `unknown` (so anything compiled).
  The mechanism is the same one `@Host` and `@StableProps` use: `This` appears only in the
  decorator CONTEXT and inside a conditional type (`PropsOfInstance<This>`), and a conditional
  is not an inference site — so TypeScript defers it to the application, where the decorated
  class supplies it. The selector's return type still fixes the value type, so the method is
  checked as `(V, V) => void`.

  **Hooks needed one addition to make this work.** `Hook.props` is `protected`, so a
  conditional type reads `never` off it, where `BaseComponent.props` is public. `Hook` now
  carries its props type in a phantom — `declare readonly [PROPS_TYPE]?: R`, symbol-keyed and
  optional, so it emits nothing, collides with nothing, and appears in no autocomplete.

  **What still needs annotating, and why.** The decorated METHOD's parameters. A decorator
  does not contextually type the signature it decorates, so unannotated parameters are an
  implicit `any` (TS7006) — measured, not assumed. That is a TypeScript limitation.

  Annotated selectors keep working when the annotation matches. Three inside `@ramonda/query`
  did not: `(props: QueryProps<unknown>)` on a `Query<TData, K>` is not the same type, and the
  compiler now says so. They are unannotated, which is what the change is for.

- 894b094: New lifecycle decorator: `@updated` — runs after the DOM of an **update** is committed.

  `@mounted` runs once, with the element in the document. `@updated` runs after every commit after that, and it is the only way an app can read or correct its own committed DOM: updates are batched through a microtask, so the DOM is not touched yet when the handler that changed state returns — and not every update has a write site of yours to stand in (a parent re-renders you with new props, a context value changes, a hook you use writes its state).

  ```tsx
  class Row extends Component<{ selected: boolean }> {
    @updated
    keepVisible() {
      if (!this.props.selected || this.scrolled) return;
      this.scrolled = true;
      this.element.scrollIntoView({ block: "nearest" });
    }
  }
  ```

  **No dependencies, no previous values, no cleanup**, and each is deliberate:

  - Nothing is tracked while it runs, so there is no dependency list to get wrong — and no repeat of the trap that makes an effect the wrong tool for this: an effect re-runs when a dependency _changes_, and a dependency that is an array or object rebuilt by a props callback changes on every render.
  - The `if` that would want previous props is reconstructing what changed, which is `@watchProp`'s job. The `if` that belongs here asks "is the DOM already how I want it?" — and only the author can answer that. So: **reacting to a value → `@watchProp`; touching the DOM afterwards → `@updated`**.
  - Cleanup is `@destroyed`'s; a subscription is `createSubscriptionDecorator`'s.

  It fires unconditionally, so guard an expensive body — a `getBoundingClientRect` forces a layout, which costs orders of magnitude more than the dispatch (~270ns).

  Runs **children before parents**, after this commit's mounts and effects, and never on the server. Writing state in it schedules another render (the measure-store-render pattern); a runaway is reported as RMD009.

  A component that does not declare it pays a length check, not an entry in the flush.

- 465918f: `@watchProp` on a **hook** now watches the hook's own props, not the owner component's.

  A hook shares its owner's runtime, so `runtime.watchProps` holds the component's entries and every hook's in one list — and running that list handed all of them the COMPONENT's `rawProps`. A hook watching its own prop therefore never fired, while its selector was quietly reading a bag it has no relationship to:

  ```ts
  class Loader extends Hook<{ target: string }> {
    @watchProp((p: { target: string }) => p.target)
    reload(next: string) { … }   // never ran — the selector was given the owner's props
  }
  ```

  Each entry now records the instance it was declared on, and the runtime reads that instance's props (`WatchPropEntry.owner`). Components are unaffected: they were always given their own props, and still are.

  **Breaking only for code that relied on the old reading** — a hook using `@watchProp` to observe the _owner's_ props. Pass the value into the hook instead, which is what the props callback is for:

  ```ts
  loader = this.use(Loader, (self: Panel) => ({ target: self.props.userId }));
  ```

### Patch Changes

- 2806fb1: A subscription decorator applied to the wrong kind of class now says so.

  `createSubscriptionDecorator`'s owner requirement was expressed as `This extends Owner` on
  the returned decorator. It worked — a class that did not satisfy the `connect`'s owner type
  was rejected — but the message was about `access.has` being contravariant and about the
  decorated method being missing from the owner type. True, and unreadable.

  It is a brand now, the same shape `@StableProps` uses for its prop names, so the failure
  lands on a named property and the message carries the owner type that was required.

  Also documented, because nothing said it: annotating `connect`'s `owner` parameter is how a
  decorator demands something of the class it goes on, and it gets the concrete instance —
  `(owner: Component<{ id: string }>, …) => store.subscribe(handler, owner.props.id)`. Leaving
  it unannotated makes the decorator work on any component or hook, which is what the built-in
  ones do. Three tests now lock all of it, including the one thing that does NOT work: the
  decorated method's parameters still need annotating (TS7006), for the same TypeScript reason
  `@watchProp`'s do.

## 0.0.2

### Patch Changes

- 7b530bb: Fix an unhandled rejection in dev mode when `@ramonda/devtools` isn't installed.

  In development, core dynamically imports the optional `@ramonda/devtools` for its
  side effect (registering the in-page inspector). That import had no `.catch`, so in a
  project that never installed devtools — e.g. a scaffold created with the testing add-on
  but not the devtools one — running a test surfaced a stray
  `Cannot find package '@ramonda/devtools'` unhandled rejection, even though the test
  itself passed. The import is now guarded to the browser (`typeof document`) and its
  absence is swallowed: no devtools just means no inspector, not an error.

- 72fb118: **Breaking:** unify hook input on `props`, and rename `@shouldUpdateProps`.

  A hook's input is now called **props**, the same word (and idea) as a component's —
  read from `this.props`, not `this.options`. One concept, one name. The `HookOptions`
  type is now `HookProps`, and a write to a hook's props throws `RMD015` worded around
  `props`.

  ```ts
  // before
  class Counter extends Hook<CounterOptions> {
    @state n = this.options.start;
  }
  // after
  class Counter extends Hook<CounterProps> {
    @state n = this.props.start;
  }
  ```

  The `@shouldUpdateProps` decorator is now **`@shouldUpdateOnPropsChange`**. The old
  name read like "should the props update" — but props always update; the decorator
  decides whether new props from the parent are _taken up at all_ (their signals update
  and a render is scheduled). Returning `false` drops the whole update, props included —
  this is now documented accurately. It runs only on prop changes, never on the
  component's own `@state` writes. It is **components only** and now throws if placed on
  a hook (a hook has no parent-driven prop update to gate), instead of silently doing
  nothing.

- 7b530bb: `@created`, `@mounted` and `@destroyed` now receive the render side as an argument.

  The decorated method is called with `env: RenderEnv` (`"client" | "server"`), read from the
  component's own runtime — so a shared lifecycle method can branch on where it is running (for
  example, skip a browser-only fetch during the server render) without a `typeof window` check.
  That check is unreliable anyway: server rendering runs under a DOM shim where `window` and
  `document` exist, so it can't tell the two sides apart. The argument is correct even inside an
  `async` method after an `await`, and even across concurrent server renders.

  Declaring the parameter is optional — existing zero-argument lifecycle methods are unaffected.
  The `RenderEnv` type is now exported.

  Note: this gates where code _runs_, not whether it _ships_. A `server` method's body is still
  bundled to the client, so it is not a place for secrets — keep those behind an API.

- 30979b6: Add **RMD019**, a dev-mode diagnostic for non-serializable `@state`.

  `@state` is carried to the client in the hydration blob as JSON, so it can only hold
  JSON-serializable data. Assigning a **function**, **symbol**, or **bigint** to a
  `@state` field — at its initializer or a later write — is now reported (dev only), at
  the moment it happens, on the client too. Previously this was only noticed by the SSR
  serializer, and only during a server render.

  The check is scoped to `@state` (not props, which legitimately hold callback
  functions) and is O(1), so it stays off the hot path's back. Deeper cases (a `Map`, a
  circular object) remain the SSR serializer's job.

- 7b530bb: Server renders can now redirect the request instead of producing a page.

  New exports `ServerRedirect` and `captureServerRedirect`. When code in the tree
  asks — during a server render — to navigate elsewhere (a route guard sending an
  unauthenticated visitor to `/login`, say), `renderToString` throws `ServerRedirect`
  rather than returning markup. A server boundary catches it and answers with a
  redirect (a 302 and a `Location`), so the browser navigates to the right URL and
  requests the correct page — instead of being handed markup for the wrong one, which
  would then snap back the instant the client read `window.location`.

  `captureServerRedirect()` is the low-level primitive the router builds on: called
  synchronously while the tree is being built, it returns a function that records a
  redirect for _this_ render (or `undefined` on the client). First writer wins.
  `renderPage` also clears the document head on the redirect path so a long-lived
  server process cannot leak one request's head tags into the next.
