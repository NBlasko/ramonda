# @ramonda/core

## 0.24.1

### Patch Changes

- 5c71153: The devtools panel the entry wires up is under test, and a comment stops naming a file that does not exist

  `index.ts` does three things for the panel at module load, inside `if (__DEV__)`: it appends
  `<ramonda-devtools>` once the element is defined, it turns Alt+D into a `ramonda:toggle-devtools`
  event, and it attempts an optional import of `@ramonda/devtools`. Nothing tested any of them. The
  file's own comment records what that cost once — the append and the shortcut used to live inside that
  import's `.then()`, so an app that imported the panel itself got the logs and no badge.

  Four tests now hold it: exactly one panel and in the body, Alt+D and only Alt+D, no second panel when
  the entry is loaded again, and the shape of the block itself.

  The last one reads the source, and that is not laziness. Measured: `vi.doMock("@ramonda/devtools")`
  never runs, because the specifier is held in a variable — deliberately, since a literal one breaks
  `vite build` for every app that has not installed the panel. `@ramonda/devtools` is also a
  devDependency of core, so in a test run that import RESOLVES and the panel appears whether or not the
  mount depends on it. Planting the historical bug back proves the point exactly: with the mount and
  the shortcut moved into the import's callback, the three runtime tests still pass and only the shape
  test fails.

  The comment that pointed at `NodeEnvironment.test.ts` for the no-DOM guarantee now points at what
  actually holds it: `scripts/check-bare-import.mjs`, which imports every published entry in its own
  Node process with no DOM, and lists `@ramonda/devtools` as browser-only while `@ramonda/core` is not.
  That file has never existed anywhere in the repository.

## 0.24.0

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

### Patch Changes

- dbc9721: **A diagnostic and the page it sends you to cannot drift apart any more.**

  Nothing compared the words a diagnostic PRINTS against the words that document it. Only the code was
  checked, so a section could go on describing a different fault entirely: `RMD041` drifted until the
  message blamed a decorator that had been removed while the reference blamed a selector the framework
  never had — two convincing, incompatible explanations of one code.

  Three surfaces now have to say the same sentence, and it is the shipped `title` they are compared
  against, because that is the one with a right answer: the words the reader just saw in the console.
  The advice PROSE is deliberately not compared — a reference page is meant to explain at more length
  than a console line, so a gate over the paragraphs would be either wrong or ignored.

  - `DiagnosticsRegistry.test.ts` pins core's own `DIAGNOSTICS.md`, both its Codes table and each
    single-code section heading. The `RMD033–RMD040` section covers eight codes and is exempt; the
    exemption is a shape rather than a list, so a heading in neither shape is reported instead of
    quietly escaping.
  - `apps/docs/scripts/check-api-coverage.mjs` pins the site's `reference/diagnostics.md` headings,
    reading the registry rather than a second list.

  Measured before writing it: 6 of 52 table rows, 15 of 29 section headings and 9 of 52 site headings
  described their code in different words. All of them now read as the code reports.

  `RMD009`'s title says `Update loop: a component never stopped re-rendering` — a colon where it had an
  em dash, so the sentence survives being written as a heading, and so it matches the production
  counter's own wording in `Task.ts`.

  Named limits: `lens`, `query` and `form` carry no `title` in their spec tables — their message is
  written at the call site, so one code has several, and there is nothing single to compare a heading
  against. Their headings are still guarded only by existing.

- 47ba44a: A query's failure is always an `Error`

  `query.error`, `mutation.error` and an `InfiniteQuery`'s were `unknown`, and honestly so: a fetcher
  is app code and rejects with what it likes. Measured, a rejected string, number or plain object
  reached `error` exactly as thrown.

  The cost was paid at every call site. The obvious read is `(error as Error).message`, which is
  `undefined` for three of those four shapes — so the page rendered an **empty** failure in the one
  place a reader needs words. This repository taught that read in nine places, including the
  `@catchError` example in `@ramonda/core`'s published types.

  A rejection is now normalised where it is caught: an `Error` is passed through as itself, anything
  else is wrapped in `new Error(String(thrown), { cause: thrown })`. So `error.message` always says
  something, `error instanceof YourError` still holds for an error you threw, and what the fetcher
  actually rejected with is on `cause`.

  **The types follow the value rather than flattering it.** `error` is `Error | undefined` on `Query`,
  `Mutation` and `InfiniteQuery`; `QueryResult`'s error arm is `Error`; `RetryPolicy`,
  `RetryDelayPolicy` and a mutation's `onError` all receive an `Error`. Typing them without normalising
  would have turned a visible cast into an invisible `undefined`.

  **A retry predicate that inspected a thrown non-Error reads `cause` now** — the one thing in here
  that can need a change. `retry: (n, error) => (error as HttpError).status >= 500` becomes
  `error instanceof HttpError && error.status >= 500`, which is what the docs now show.

  It also settles a disagreement between the two halves of a page: a failure restored from a server
  render already arrived as `ServerQueryError`, a real `Error`, while the same failure fetched on the
  client arrived as whatever was thrown. Identical app code behaved differently depending on whether
  the page was server-rendered.

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

- 5ea8179: Every message names its component, even when the class has no name

  A class expression assigned to nothing has a `constructor` whose `name` is the empty string — a
  factory that returns a class, an anonymous default export, a class built inline. Read bare and
  interpolated, that prints a message with no subject.

  Twenty-nine sites did exactly that, across `renderPhase`, `updateRules`, `timerGuard`,
  `computeChurn`, `renderStability`, `lifecycleMenagement`, `common`, `hydrate`, `Task`, `Component`,
  `Hook` and `decorators` — so `RMD004`, `RMD015`, `RMD006`, `RMD008`, `RMD009`, `RMD021`, `RMD030`,
  `RMD055` and the hydration family could each arrive with nothing where the component should be. All
  of them go through `displayName` now, which answers `"Unknown"` for an empty name and for an
  instance with no `constructor` at all. `@ramonda/query`'s missing-provider error took the same fix at
  the one place it is printed.

  **The sweep that was supposed to have done this missed them, and that is why there is now a gate.**
  The earlier pass fixed the sites carrying an explicit fallback by grepping for `??` and `||`; a site
  with no fallback matches neither, so twenty-nine survived and one was found by accident three days
  later while reading an unrelated function. `scripts/check-nameless-class.mjs` greps for the READ
  instead, and fails on a new one. A read that is COMPARED rather than printed, or already answered by
  `?? "…"` / `|| "…"`, is not a subject and needs no exception — which leaves the table at one entry.

  Two of the messages are pinned by tests and the rest cannot be, for a reason worth knowing: a class
  expression with a DECORATED member is named by the transpiler, so anything needing `@state` or
  `@created` to fire never sees an empty name. The two that need no decorator are the two that THROW.

- d5053c6: A diagnostic about a component whose class has no name now names something

  A class expression assigned to nothing has a `constructor` whose `name` is the empty string, and
  `displayName` answered that empty string. Its own note said `??` could not become `||` "without
  changing "" into Unknown" — and never asked whether any caller wanted `""`. None did: every one
  either interpolates it into a sentence or puts it in a dedup key.

  Measured, on the one code in the family a nameless class can actually reach:

        [RMD060] render() is async
        < />'s `render()` is async — it returns a promise, not markup.

  A subject that reads as a syntax error rather than a name. It says `<Unknown />` now.

  **The other direction was worse, and it was a lie rather than a gap.** `renderPhase`,
  `hydrationMismatch`, `jsxRules` and `lintChildren` each distinguish "no component at all" — `outside
a render`, `root`, `A render`, `the root` — from a component, and `??` handed the nameless one the
  word for NO component. So a report said the markup belonged to nobody about a component that was
  right there, and every nameless component shared that group's dedup key: two of them with the same
  duplicate key reported once between them.

  Also corrected: the devtools panel labelled a nameless component's row and a nameless hook's row
  with the empty string; `<tag>` in RMD039 was empty when a COMPONENT was the one given `class`; a
  list's rows reported "Two rows rendered by ."; and `hydration/serialize.ts`'s fallback word was
  ungrammatical in the case `??` did catch — `holds a object` is now `holds a class instance`.

  Nine mechanisms, each proven by putting the `??` back and watching the suite fail. Three sites are
  changed for uniformity and say so where they stand rather than looking finished: two cannot be
  reached at all, and one is a shape I could not construct — the test written for it passed with the
  operator changed back, so it was deleted rather than kept.

  Found by unioning both coverage runs: three of core's four thinnest files by branch coverage had the
  same unhit branch, and it was this one.

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

- 41cf5e9: Importing `@ramonda/core` in a process with no DOM no longer throws

  `debug/logger.ts` called `window.addEventListener` at MODULE LOAD, inside `if (__DEV__)`, with no
  check for a DOM. The development build is the `default` export condition and replaces `__DEV__` with
  `true`, so this:

      import "@ramonda/core";

  threw `ReferenceError: window is not defined` in a bare Node process, before the caller's first line
  ran. Measured against `dist/index.js` rather than argued from the source.

  Nothing in the repository could see it. Our own SSR installs its DOM shim first, the suites run
  under jsdom, and the `sideEffects` gate asks a BUNDLER what survives importing each entry — a
  bundler never evaluates the module. What a user does that we did not: a script, a CLI, a codegen
  step, a test runner in the node environment, or an app that imports the framework before installing
  its shim.

  The same check now guards `ramondaLog`'s event dispatch, which is reachable with no DOM for the same
  reason: a decorator reports at class DEFINITION time, so a Node process that merely imports a
  component module raises diagnostics without rendering anything. The console line and the log vault
  are unaffected, so a panel that connects later still gets everything.

  Found from the other side, which is worth recording: `debug/timerGuard.ts` guards the same thing at
  the same moment and always did. Its guard is unhit in every suite and reads exactly like the dead
  ones deleted from `Listener` and `@onWindow` — it is the one place that had it right.

  `scripts/check-bare-import.mjs` now imports every published package's development AND production
  entry in its own Node process, and fails if either throws. `@ramonda/devtools` is listed as
  browser-only with its reason, and is required to keep failing, so the exception cannot rot into
  silence.

- b5571db: Two pages said TypeScript refuses a function as a JSX tag. It refuses two thirds of it.

  `JSX.ElementType` is deliberately not declared, so the compiler's default rule applies: a tag has to
  return one `JSX.Element`. Measured on all three shapes against core's own types:

  | the function returns           | the compiler      |
  | ------------------------------ | ----------------- |
  | several nodes — `[<p/>, <p/>]` | refused, `TS2786` |
  | anything that is not a node    | refused, `TS2786` |
  | exactly ONE node — `<p/>`      | **accepted**      |

  The accepted one is how a function component gets written out of habit, so the shape most likely to
  appear was the one nothing typed caught. `RMD011` catches it at runtime and its own page said the
  compiler had already refused it — which is the sentence that would stop somebody looking.

  Corrected in `reference/diagnostics.md`, in `why/classes.md`, and beside the decision itself in
  `global.ts`, where the note said the default rule "rejects a function returning an array of vnodes"
  and left the single-node case unsaid.

- 95b0656: The third `false` a `Listener` promises now has a test

  `listen()` documents three ways it returns `false`: on the server, once the owner is gone, and when
  the target resolves to nothing. The first two had tests. The third had none, and it is the one a
  caller most easily meets — `on` is a function, and a function reaching for a ref before the node
  exists, or for an element a branch has not rendered, answers `null`.

  The test pins both halves of that promise: the return value is `false`, and the refusal is SILENT,
  because a missing target is a state rather than a fault. It fails if the guard returns `true` instead,
  and it fails if the refusal throws.

  Found by measuring rather than guessing: `base/Listener.ts` had the weakest branch coverage in the
  package at 50%, and this was the only unhit branch of the three that can actually be reached.

  A `Portal` target that arrives late is tested too, and the page says what it takes

  The class doc promises that "a `target` absent at mount and supplied later is placed then, not lost",
  and nothing measured it — the guard that makes it true was the only unhit branch on that path.

  It holds, and the test says what it depends on: the target has to be read from a SIGNAL. `reconcile`
  runs again on `@watchProp(props.children)`, and `children` only gets a new identity when the props
  factory re-runs, which it does when a signal it read has moved. A factory that reads none is built
  once — so `target: document.getElementById("x")!` with nothing reactive around it places nothing and
  then never tries again.

  The class doc called that "the uncommon case, worth knowing". The portal page, whose own example uses
  exactly that lookup, did not mention it. It does now, with the shape that recovers.

  The Firefox and Safari stack shape is parsed by something now

  `sourceLocation` reads where a class is defined out of the first construction's stack, so devtools can
  open your editor on it. Its parser handles two engine shapes and says so in its own note — V8's
  `at new Foo (file:line:col)` and Firefox/Safari's `Foo@file:line:col`. The tests run on V8, so only the
  first was ever exercised. The second is not an edge case; it is half the browsers somebody opens
  devtools in.

  Six more shapes come with it, each one a promise the file already makes: a V8 frame through the same
  entry point, a frame that names the class but carries no position (skipped rather than reported as
  `line: NaN` at a file an editor cannot open), a stack that names nothing, no stack at all, an
  anonymous class, and `definitionOf` asked about something that is not a class.

- 821ac09: `Listener`'s `on` says why it needs `as const`, with both ways out measured

  `this.use(Listener, () => ({ on: "document", … }))` does not compile — an object literal widens
  `"document"` to `string` — so the call site writes `as const`. Two ways round it were tried on
  TypeScript 5.9.3 and written down beside the prop, because "worth a fresh look" is how a question
  gets re-derived every year:

  - **`NoInfer<Q>` on the props factory**, the textbook fix for a parameter inferred from two places,
    **crashes the compiler**: `Debug Failure. No error for 3 or fewer overload signatures`, thrown
    from `resolveCall`. Not that it fails to help — tsc does not finish.
  - **A `const` type parameter** works, and the example compiles with no `as const`. It also keeps
    every inferred array as a READONLY tuple, and hook props take arrays: six call sites in core's own
    tests stop compiling, `children: [<Wrap />, <u />]` among them.

  And it is one prop rather than a pattern — `on` is the only hook prop in the framework typed as a
  string-literal union, so the `as const` is a single line in a single API.

  Comments only; no behaviour and no types changed.

- 76819c8: Three places still argued that a wrapper costs an element. It has not for a while.

  When a component became a range of nodes rather than one element, wrapping stopped adding anything
  to the page — a component renders exactly what its `render()` returns, so one handing back
  `this.props.children` contributes no node of its own. The documentation did not follow.

  `composition/inheritance.md` answered _"what do I wrap these in?"_ with **"None — nothing wraps
  anything"**, which was the old constraint's selling point and is no longer a distinction. It now
  says both are available, neither adds an element, and the choice is about what you are REUSING:
  extend when you are building on a component's own markup and behaviour, because `super.render()` is
  what a wrapper cannot do; wrap when you are adding something around children you do not own,
  because a wrapper takes anything and a subclass is tied to one parent.

  `why/classes.md` said reuse "does not mean nesting, and nesting costs nothing" — which argues
  against nesting and then says it is free, in one sentence.

  And a test in core still said Ramonda's units of reuse are "the class and the Hook, neither of
  which nests". A class nests perfectly well now; what it does not do is leave an element behind.
  That test's subject — composition inside a `<tr>`, where only `<td>` is legal — is where the claim
  is settled rather than asserted, so it is worth stating correctly.

  Comments and documentation only.

## 0.23.1

### Patch Changes

- 04f8c76: The context object's second publisher is now held to the protocol, not just described by it

  `createContext` writes a per-key signal channel onto a component's context object. The `Head` hook
  writes the node its descendants hang under — same object, same mechanism, a key of its own. The
  protocol that makes that safe is stated in one place already, and both sides obey it.

  Nothing enforced it. `Head` does not go through `createContext`, no test put the two of them on one
  component, and two invariants it depends on were invisible from any call site: the object is
  prototype-chained per component, and a publisher writes an OWN property so descendants inherit the
  slot and siblings do not.

  Both are now pinned. Making the per-component object unchained fails the first test; making `Head`
  publish onto the parent's object instead of its own fails the second — and that second one only bites
  on a TEARDOWN, which is why the test drops a branch and checks that its descendant's tags go with it
  while its sibling's stay. Asserting merely that every tag exists passed with the fault in place.

  A shared read/write helper was considered and not written: the four accesses are two reads and two
  writes of `object[key]`, so wrapping them adds an indirection over what the type's own note calls the
  design — "the read is where the shape is named" — and would still not fail if the object stopped being
  prototype-chained. The test does.

## 0.23.0

### Minor Changes

- 46dff27: A boolean attribute is written the way HTML spells it

  `disabled`, `checked`, `selected`, `muted` and the rest of the HTML boolean attributes are written
  as the empty string when they are on, rather than as `="true"`. A browser reads only whether a
  boolean attribute is PRESENT, so nothing behaved differently — but the word sat in every served
  page for nothing to read, and the markup did not round-trip: the same element read back through
  `outerHTML` says `disabled=""`.

  Keyed on the attribute name, so `aria-hidden={true}` still writes `"true"` and a `data-*` flag
  keeps its word. ARIA states are enumerated strings rather than boolean attributes, and a data
  attribute's value is data that something reads back.

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

- bfb46fb: `<Select>`, because a select's state is its children

  A `<select>` is the one element whose own state is not a property of itself: it is which child is
  chosen. `<Select value={x}>` says that once, on the element that owns the choice, and settles it
  when the options are in the element — told to the select on the client, written onto the chosen
  option on the server, which serializes markup and cannot carry a property. So the right option is
  showing before any script runs. `<Select multiple value={["a", "b"]}>` takes a list.

  It passes everything else straight through: `className`, `disabled`, `name`, every event, every
  `data-` and `aria-`.

  **`<select>` is now a type error**, and the message TypeScript prints is the instruction. `selected`
  on an option is a claim rather than a fact: HTML keeps the later of two and gives a select holding
  none the first option it is handed, so what the markup means depends on the order the options
  reached the select — an order no author writes and none can see. Measured, with `b` asked for out of
  `a b c`: the page showed `c`.

  `<option>` is untouched. It has no choice to make, so it stays an ordinary tag, in a `<datalist>` as
  much as in a select.

- d4e6e5f: `<TextArea>`, because a textarea's value is its child

  HTML gives a `<textarea>` no `value` attribute — the value is the element's TEXT — so
  `<textarea value="hello">` was markup a browser ignores. The reader was shown an EMPTY field, which
  filled itself in when the bundle arrived.

  `<TextArea value={x}>` writes the value as the element's child, so a served page shows the text
  before any script runs, and sets the property afterwards, which is what keeps the field controlled
  once somebody has typed in it. Everything else written on it — `className`, `disabled`, `rows`,
  every event, every `data-` and `aria-` — passes straight through.

  **`<textarea>` is now a type error**, and the message TypeScript prints is the instruction. It has to
  be a component rather than a line in the attribute writer: the value must become a CHILD, and the
  attribute pass runs before the children, so a text node written there is one the children pass has
  never heard of and unmounts as a leftover.

- b395733: `EventOn<T>` — the one line the DOM's own types cannot type

  The event itself has always been typed from the name: `onclick` gives a `PointerEvent`, `onkeydown` a
  `KeyboardEvent`, from the DOM's own map. Reading the ELEMENT is a separate question, and it did not
  work:

  ```tsx
  <input onchange={(e) => (this.draft = e.currentTarget.value)} />
  //                                     Property 'value' does not exist on type 'EventTarget'
  ```

  `currentTarget` is `EventTarget | null`, because in the DOM an event can be listened for anywhere. So
  every handler that reads a field off its own element opened with a cast — the type system being told
  to look away.

  ```tsx
  import type { EventOn } from "@ramonda/core";

  <input onchange={(e: EventOn<HTMLInputElement>) => (this.draft = e.currentTarget.value)} />
  <button onclick={(e: EventOn<HTMLButtonElement, PointerEvent>) => e.currentTarget.blur()} />
  ```

  ## Why it is opt-in, with the numbers

  The obvious version is to parameterise the whole handler map by the element, so no annotation is
  needed anywhere. It works, and it costs. Measured on `apps/docs` with `--extendedDiagnostics`, type
  **instantiations went from 244,875 to 346,688** — and not as a fixed cost: `packages/router` moved a
  third as far, so it scales with how much JSX a codebase contains. That is a tax on every consumer's
  build in exchange for saving an annotation.

  Narrowing it to the events people actually reach for does **not** help: restricting the intersection
  to eight event names produced 346,688 instantiations, to the digit. TypeScript instantiates the whole
  mapped type per element type whatever is inside it. The note in the source says so, so nobody
  measures it twice.

  ## `target` is deliberately not narrowed

  `currentTarget` is the element the listener is attached TO, which the framework knows because it
  attached it. `target` is where the event ORIGINATED, and for anything that bubbles that is any
  descendant — a click on a `<span>` inside a `<button>` has the span as its target. A type naming it
  as the button would be wrong exactly when a reader most needs it right.

  ## It is an annotation, not a proof

  Naming the wrong element compiles: `EventOn<HTMLSelectElement>` on an `<input>` is accepted, because
  a handler prop is bivariant in its parameter — which is the same property that lets a narrowed
  parameter stand there at all. Nothing cross-checks the element against the tag.

  It is still worth having. The alternative at that line is `(e.currentTarget as HTMLInputElement)`,
  which asserts exactly as much in more characters. But `Listener.run` rejected method syntax
  specifically for making this bivariance LOOK like a check, so the limit is written down rather than
  left for somebody to trust and discover.

  All three claims are pinned in `JsxTypeClaims.tsx`, in both directions, and each was checked by
  relaxing it and watching the `@ts-expect-error` go unused.

  `RamondaEvent<T>` is gone. It typed `target: T` — the unsound half — was used nowhere, and was never
  exported from the package, so it could not be reached even deliberately.

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

### Patch Changes

- 135d017: The teardown of a component that owns nothing where it lives and something where it does not

  A component with no node of its own is already known to be reached through the record — the record is
  the only thing that knows it is there. This pins the combination that makes the record's job visible:
  the component owns NOTHING in its parent and owns a whole block of nodes in a different element,
  through a `Portal`.

  Nothing in its parent's DOM says either of those things. A teardown that ever decided by asking "does
  this region hold any nodes?" would skip it: the hook would never be disposed, and the block would be
  left standing in a target that is SHARED, where nobody owns it and the next region to write there
  anchors against its leftovers. So the test asserts the TARGET is left empty, anchors included.

  It fails when an empty region is skipped as having nothing to tear down, and when a disposed block
  leaves its anchors behind.

- 69ae9b7: Two shapes a component's variable node count can be asked in, pinned by tests

  A `ComponentRegion` may own two nodes, then one, then none, where a host element was always exactly
  one node that was always there. A region owning nothing has no neighbour of its own to read, so the
  engine answers from the record — and `nextNodeAfter` has to tell three answers apart: a node,
  "nothing follows it", and "it is not in this record".

  The first shape was probed and found correct in every ordering tried: driven from the parent and from
  the component's own state, in both tick orders, with an empty region in front of a full one and with
  an empty region last, each time while the siblings rotated. No fault, and the file says so — it exists
  to keep an answer that is currently right from drifting.

  The second was a hole. Folding "not in this record" into "nothing follows it" passed all 1416 tests in
  the package. The existing portal tests each cover one half: an empty component filling in, but into a
  bare target with no record of its own; and a target that keeps a record, but with a component that is
  never empty. Neither can reach the record branch with a region that is genuinely absent from it. The
  new test is the intersection, and it fails when the two answers are folded together.

- effec83: A `Portal` block survives a `@destroyed` that clears the target it writes into

  `ChildrenRegion.reconcile` unmounts the children a pass dropped and then inserts the new ones in
  front of the block's closing anchor. Unmounting runs user code, and a `Portal`'s target is SHARED —
  so the `@destroyed` of a child on its way out can take that anchor away with everything else it
  tidies. Measured on a child clearing the element it had been writing into: `NotFoundError: The child
can not be found in the parent`, thrown out of the reconcile, with the children this pass produced
  never reaching the page and the target left empty.

  The render path already had this window and closed it by searching for its anchor again. That is not
  available here — these anchors are the block's own structure rather than a neighbour, so once they
  are gone there is nothing to find. They are put back instead, BOTH of them, at the end of the target:
  leaving a surviving opening anchor where it stands and appending a fresh closing one would stretch
  the block across every node in between, including nodes another region in the same target owns.

  That is now the complete list. Two places carry an anchor across user code — the component
  self-render and this one — and both re-check it; the other three unmount-then-insert windows derive
  their reference at the point of use.

- dfe3513: A coverage floor, so a drop in this package's tests fails the build instead of passing quietly.

  **Nothing a consumer installs changes.** The floor lives in the test configuration, and the published
  bundle is byte for byte what it was.

  `vitest.coverage.mjs` gained a `withFloor(lines)` beside the settings it already exported, and core's
  own config asks for 97 — against 97.95 measured the day the range rewrite merged. A floor rather than
  a target: set a point under today's number so ordinary work does not fight it, while ~40 untested
  lines does. Per package, because one number across the repo would have to be the weakest package's,
  and per run, because `test:prod` executes only the production-only branches and asking it for a whole
  package's number is asking the wrong question.

- c46a61f: A hydration mismatch no longer points the reader at the framework's own bookkeeping

  When a component renders more nodes on the client than the server wrote, the walk runs out of server
  nodes inside that component's run — so the cursor is standing on its own closing marker. The DOM was
  already handled correctly: a comment is structure, so the fresh node goes in front of it rather than
  replacing it. The diagnostic was not. Naming the node by `nodeName` produced

      <Inner /> rendered <b> but the server sent <#comment>.

  and the comment is a marker this framework wrote, not anything the server was asked to send. There is
  nothing there for a reader to go and look at.

  What it says now is what happened: the server's run for that component ended, so it sent **nothing**.
  An OPENING marker reads as "a component" — the marker carries an id rather than a class name, so the
  name is not ours to give — and any other comment as "a comment". One helper decides it, and all three
  places that report a structure mismatch go through it.

  Two tests come with it, both covering the direction that had none: a component whose server block is
  SHORTER than its client render, and one the server rendered empty and the client fills in.

  A text node in the way is named the same way: by what it says, not as `<#text>`.

- ba680c1: The retired one-element rule stops being taught, including in a message readers see

  `Every JSX tag is exactly one element` was the framework's headline rule and is not
  true any more — a component renders one element, several, or none. The rule was
  retired; the sentences arguing FROM it were not, and they were spread across four
  packages.

  The one that reached users: the fragment error said `<>…</>` is refused because it
  `would make one tag produce several elements`. That is now something a component
  does routinely, so the message argued from a rule the framework no longer has. It
  gives the reason that still holds — a fragment has no state, no lifecycle and no
  identity the diff can hold, and a component covers every case it would.

  The rest were comments and one reference page, each rewritten to the reason that
  survives rather than deleted: `RMD011` and its DEV guard, `__h`'s contract (one
  vnode per tag, which is a claim about the vnode and not about the DOM), why
  `createContext`, `QueryClientProvider` and `Router` are hooks (they put nothing on
  the page — not that a wrapper was forbidden), and why attribute names are not
  aliased.

  Two comments also described `<ramonda-host>`, which no longer exists anywhere in
  the source. `AsyncLoad` renders the loaded module and nothing around it.

  `list()` argued from the rule under a third spelling — "it does not bend the
  one-tag-one-element rule" — which a search for the headline sentence did not reach.
  The reason that survives is why a `<For>` TAG would still be wrong: a tag whose whole
  job is to stand in for N siblings and be nothing itself is a fragment with extra
  steps, and that is the thing Ramonda does not have.

- 82d2988: `muted` and `indeterminate` reach the element, and an attribute HTML does not have is not written

  An attribute is the state an element STARTED with, which for most elements is the whole story. For
  these it is not, and the property was missing:

  - `<video muted>` went out with `.muted === false`, so the video played with sound — and a browser
    refuses to autoplay one that is not muted, so `<video muted autoplay>` did not play at all.
  - `indeterminate={true}` left `.indeterminate` false and put `indeterminate="true"` in the markup.
    There is no such attribute in HTML: a checkbox's third state exists only as a property. A
    server-rendered page therefore cannot carry it — the box arrives unchecked and becomes mixed when
    the page hydrates.

  Both now turn off with the model as well, which removing an attribute cannot do once the element is
  live. That is the rule `checked` already followed.

  Behind them, one rule replaces what would have been a branch per tag: an attribute HTML does not
  give an element is not written at all. `value` on a `<textarea>` or a `<select>` is the same case —
  each name is real HTML elsewhere and means nothing there. The list lives in `@ramonda/dom-facts`,
  where `@ramonda/check` can report the same names where they are typed.

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

- e177dff: The derived node order, pinned one region deeper — through a list

  A region's node set is flattened out of `entries` rather than remembered, so an ancestor walking it
  sees what a descendant that re-rendered on its own really left in the document. That was already
  pinned for a component nested directly in a component.

  It is now pinned one level deeper, where the walk has to pass through a `ListRegion` to reach the
  component whose contents changed, and where the ancestor REORDERS rather than appends — a reorder
  places every node against a reference taken from the set it just derived, so a single stale entry
  misplaces its neighbours and not only the new nodes. The row is emptied first, because a row that
  contributes no node at all is where a remembered set and a derived one differ most.

  Both tests fail when the flattened order is cached instead of derived.

- 658faee: Test only: `AsyncLoad` inside a list inside a slot

  Three mechanisms one inside another, each tested alone and never together. A `list()` mints identity
  and reuses rows across a change; a slot is written in one component and rendered in another;
  `AsyncLoad` holds a promise in flight. Nested, the question is whether a load already running
  survives what the list does to its row — dropped, reordered, or failing beside a sibling.

  Four cases, and no behaviour changed. The reorder case asserts how many times each module was ASKED
  for, not what the page shows: every visible outcome is identical under the wrong identity, because
  `AsyncLoad` is driven entirely by its props and props follow position. Planted with identity by
  position, the page looks right and each module is requested twice.

- 145aa66: `AsyncLoad` stops recommending the shape it reports

  Its own docstring wrote `lazy={() => import("./HeavyChart")}` and an inline arrow for
  `errorFallback`, while `RMD020` reported both — measured, with `strictRender` on, as
  `AsyncLoad.lazy` and `AsyncLoad.errorFallback`. The framework was arguing with itself, and the
  side that loses is the reader who copied the example.

  The examples now hoist the thunk — `const loadChart = () => import("./HeavyChart")` — and pass a
  bound method for the fallback. An `import()` inside a thunk does not run until the thunk is
  called, so hoisting costs nothing, and a table of them is the answer when the module is chosen at
  runtime: `lazy={pageLoaders[path]}`, which is what the documentation site already did.

  The module CACHE still tolerates a rebuilt `lazy` — the key is derived from the thunk's source
  rather than its identity, so nothing loads twice. The docstring now says that is a defence against
  the mistake rather than a licence for it: what the cache cannot save you is the render.

  Comments only; no behaviour changed.

- e133c7d: Test only: a slot reads the context it lands under

  Two rules that had never met in a test. A slot **belongs where it lands, not where it was written** —
  that is what decides its lifecycle order and its depth — and context is looked up the component
  tree. Together they settle a question neither answers alone, and the answer is the one the design
  intends: a reader written inside one provider and handed to a component that provides something else
  reads the one it **lands** under.

  Five cases, including the one that looks like the opposite answer and is the same rule: when the
  landing component provides nothing, the search keeps climbing and reaches the writer — which is on
  that path because it rendered the landing component. Nothing about where the JSX was typed changes
  what is found.

  No behaviour changed. `Context.ts` already carried the rule as a measurement; nothing had pinned it,
  and planting a broken context chain fails four of the five.

- deb3ef9: Test only: `ErrorBoundary` around the shapes a slot and a list build

  Queue item 5. A throw from a displaced slot is caught by the nearest boundary above where the slot
  LANDED — the same rule context follows, and the one that decides a slot's lifecycle and depth.
  Asserted from all three sides, including the case that looks like the exception: the writer's
  boundary catches when the writer is what rendered the landing component, which puts it on that path.

  Also pinned: how much a boundary takes with it (outside a slot it replaces the slot and its host,
  per row it replaces the row), that a module which throws while RENDERING goes to the boundary rather
  than to `AsyncLoad`'s `errorFallback` — those are different failures and only one of them is the
  loader's — and that `reset` sends a boundary back to its children.

  No behaviour changed. Planting a walk that skips the nearest boundary fails all seven.

- d0707b7: A row keeps the reader in it when a list reorders

  Moving a node means removing and re-inserting it, and a removed node is blurred — the platform, and
  the same in plain JavaScript. Everything else about the row already survived: its node, the text
  being typed, the caret, its own `@state`. Only focus did not, which is the one loss with no sign on
  the page. The reader goes on typing into nothing.

  It is restored by the reorder, because nothing else can: no render says which of its rows the
  platform is about to pick up.

  It costs one `document.activeElement` read per walk that actually moves something — a render whose
  DOM already matches returns before reaching it — and one `focus()` only when the element really lost
  it. Re-focusing something that never lost it would fire a second `focus` event for nothing.

  This closes a decision the test suite had been holding open: `ListRowKeepsWhatTheUserTyped` asserted
  the loss and said it would start failing the day somebody took the decision.

- 2143a3b: Test only: the nested shapes served and then adopted

  Queue item 6, the half of this path where the faults were — five of the eight findings in round four
  of the range review were here. A shape that renders correctly twice can still be wrong across the
  boundary, because hydration does not re-render the server's markup: it walks it, and a client
  expecting a different tree adopts the wrong nodes or reports a divergence on markup that was right.

  Five shapes, all already correct: context read through a displaced slot, a list inside a slot, an
  `AsyncLoad` the server waited for and served loaded, a boundary that caught on both sides, and one
  that was fine on the server and threw on the CLIENT — caught during adoption, which a boundary that
  only worked on a fresh render would have let escape after the page was already shown.

  Each asserts that a node the server built is still the node on the page, not only that the text
  matches. With adoption disabled, two of the five stayed green on text alone.

- 9798d6a: Test only: the inspector's view while the tree moves

  Queue item 8, the last of the campaign. The inspector is the one thing here that watches rather than
  renders, and it reads the CHILD RECORD rather than walking the DOM — it has to, because a component
  owns a range of nodes and may own none. So it can be wrong in a way nothing else notices: the page
  stays correct while the panel draws rows in an order they are not in, or a component that unmounted
  three renders ago.

  Four cases: a slot's contents are drawn where they LAND, a reorder is drawn in the new order, a
  dropped row leaves the picture, and a portal's contents are drawn where their NODES are — absent
  from the container they were declared in, present as a root beside the app.

  The last two rules are opposite and both right: a slot's content really is rendered by the component
  it lands in, while a portal's is rendered into a target that belongs to nobody.

  Order is asserted along with shape, since two rows both called `Leaf` pass any assertion about names
  alone. No behaviour changed.

- 5eb4454: A controlled field keeps its caret when the model rewrites in place

  Assigning `.value` drops the caret to the end of the field. That is the platform, and for most
  writes it never shows: a value only reaches the writer when it DIFFERS from what the element holds,
  so a model that echoes back what the reader typed writes nothing and the caret is untouched.

  What was left is a model that REWRITES — `toUpperCase()`, a mask. The reader clicked into the middle
  of the text and the next keystroke landed at the end. Measured: `axbc` uppercased to `AXBC`, caret
  at 4 rather than 2.

  The caret is restored when the rewrite left the LENGTH unchanged, because then every offset still
  means the position it meant. When the length changed it is not: after `123` becomes `1,234` the old
  offset points between the separator and the `2`. Placing it there would be a guess, and deciding
  where it really belongs needs to know which characters are separators — the app's knowledge, not the
  framework's. An app that formats reads `selectionStart` in `@updated` and applies its own rule.

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

- c71cab1: A reorder stops searching every element for a portal that is not in it

  `reorderChildren` has to know whether an element holds a `Portal`'s block, because a block is
  appended into its target and so sits after the element's own children — a fresh child has to go in
  BEFORE it or the guest ends up in the middle of the host's own run.

  It answered by walking every child. The answer is no for almost every element, and it was reached
  after visiting all of them: measured on 500 rows moving one, 1501 sibling steps against 1001 with
  the search taken out, and on 60 rows 121 against 181. One whole extra pass over the children, on
  every reorder, to find nothing.

  `ChildrenRegion.place` marks the targets it uses, so an element that was never one now stops at a
  property read. The mark is never taken off: clearing it correctly would need a count of the blocks a
  target holds, and the cost of leaving it is that an element which once hosted a block goes on
  walking — which is what every element did before, so the worst case is the present.

## 0.22.0

### Minor Changes

- 6244c55: `Timeout` and `Interval` — a scheduled call the app starts, and the framework still owns.

  `@interval` and `@timeout` answer one question: run this on a clock for as long as I am on the page.
  They answer it in one line and they are unchanged. These answer a different one — **start now, and stop
  when I say** — which no decorator can express, because a decorator fires relative to MOUNT.

  ```tsx
  private removal = this.use(Timeout, () => ({ run: this.dropRow }));

  leave() {
    this.leaving = true;
    this.removal.start(3000);
  }

  stay() {
    this.removal.stop();
  }
  ```

  **`run` belongs to the hook, `ms` to the start**, split by how long each one lives. An API that takes
  the body per call reads as "order as many as you like" while behaving as "only the last survives" — and
  it invites a fresh function at every call site, where nothing then says whether that function captured
  a local or reads `this.props`. Measured, because the difference is invisible: `() => this.props.id`
  reads the id when it FIRES, so after a reorder it is a different row's, while a captured argument is
  frozen at start. Declared once, there is nothing to capture.

  `run` is read **when the call fires**, so a `run` chosen by a signal takes effect on a call already
  waiting, without restarting the countdown — and it cancels nothing. Cancelling is `stop()`, always
  explicit: the props callback re-runs whenever any signal it read changes, including one read for
  something else, so a timer that cancelled itself on that would be one an unrelated re-render could
  kill. `ms` is read at `start`, because a delay is a property of that start — a retry's backoff differs
  every time — and that keeps a signal out of it entirely.

  **One instance is one timer.** Starting a running one restarts it, so `stop()` never asks which and no
  handle travels back to the caller. Two timers means two hooks. The verb is in the NAME rather than at
  the call site, which is why this is two hooks and not one: with only `start()`, the name is the only
  place left to say whether it repeats.

  **Why hooks rather than making the decorators call-armed.** A decorator cannot add a member TypeScript
  can see. Measured: a decorator that replaces the method with a function carrying `stop` gives
  `TS2339: Property 'stop' does not exist on type '() => void'` — a decorator may change what runs, never
  the declared type.

  **Nothing starts during a server render**, and `start` returns `false` rather than throwing. Quietly,
  because that is what makes it safe to call from shared code: the same `@created` runs on both sides, so
  a throw would force every call site to branch on which side it is — the one thing the hydration rules
  tell an author not to do. It returns `false` once the owner is gone too, which is a second leak and not
  the same one: `@destroyed` has already run, so nothing would ever clear that timer. A caller that has
  promised somebody an answer must check it — measured on the first caller, where a silent refusal left a
  view transition holding a snapshot over the page for ever.

  **A delay is refused in every build**, not only in development, because it arrives at runtime:
  `start(this.props.backoffMs)` may be handed `undefined` by an API, and guarded, development would throw
  while production called `setTimeout(fn, NaN)` and coerced it to `0` — a retry storm in the only build
  where it matters. That is the shape `useCommon`'s `RMD055` throw and `@compute`'s `assertNoParameters`
  are both unguarded for. The ceiling is `2147483647` ms, about 24.8 days, because `setTimeout` truncates
  anything larger and fires it at once.

  Twenty-six tests plus three in a production run, and the planted ones earned their place. Clearing the
  handle after the body instead of before wipes the one a re-starting body just installed, and every other
  test passed under both orderings; putting the delay check back under `__DEV__` fails all three
  production tests while all twenty-six development ones pass.

  `RMD006` and `RMD008` name these in their fix text now, beside the decorators.

### Patch Changes

- 0e1fca0: Every package and app extends one `tsconfig.base.json`, and three type checks that thirteen of them
  were missing are now on for all of them.

  Nothing published changes — these are the configs the build reads, not anything shipped. What changes
  is that a config edit is one file instead of seventeen, and that the floor is the same everywhere.

  **The duplication was the smaller half.** Measured across the seventeen: only FOUR options were
  identical (`module`, `moduleResolution`, `skipLibCheck`, `strict`). The rest had drifted, and the drift
  was not a set of decisions — **thirteen projects got none of `noUnusedParameters`,
  `noImplicitOverride` or `noFallthroughCasesInSwitch`**, while `core`, `dom-facts` and `theme` got all
  three and `devtools` got two. The blocks were copied at different times, so the strictness a package
  happened to be checked at was an accident of when it was created.

  Turning those three on for everyone cost **two errors across fourteen projects, and both were real**:
  an unused parameter in `duplicate-key-among-siblings`, and — in `InheritanceDemo`, the demo that
  TEACHES inheritance — a method overriding its base without `override` (`TS4114`). The demo says why
  the keyword matters now, which it could not before.

  `noUnusedLocals` is deliberately NOT in the base: measured at **103 errors**, and they are not dead
  code. Nearly all are `const provider = …` in tests, built for a side effect and never read on purpose.
  The three packages that want it keep it themselves.

  `scripts/check-tsconfigs.mjs` joins the gate and is planted three ways: a config that stops extending
  the base, one that re-declares what the base already sets, and a typo in the `extends` path — which is
  the quiet one, because a bad path is not an error, it is a config that silently sets nothing.

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

## 0.21.0

### Minor Changes

- bc89e75: **`@compute` and `@memoized` are allowed on `render`**, and a cached render is NOTED rather than warned
  about.

  The ban existed because `@compute` used to turn `render` into a property and the page died with
  `component.render is not a function`. The method form installs a function now, so that is gone — and the
  ban was protecting nobody anyway: `@compute get body()` returned from `render` does exactly the same thing
  and was always legal. Measured, the wrapper blinds `RMD020` and freezes on a plain field identically. A rule
  that costs one wrapper to step around teaches that the rule is arbitrary.

  **What replaced it is one `info` line, once per component**, with no diagnostic code:

  > `<Board />` has a cached render, so RMD020 cannot compare its output — an inline handler, an object
  > rebuilt in place and a value that does not come from state go unreported in the render itself. A
  > `list()` row is still checked, because the list builds each row twice on its own. And a cached render
  > refreshes only when a SIGNAL it read moves, so anything else it reads keeps its old value. All of it is
  > the deal; nothing here is wrong.

  A `list()` row keeps its cover, and that is measured: `listEngine` builds each row twice itself, so a
  handler built per row is still reported while the render around it is cached.

  Not a warning, because caching a render is a deliberate choice and a warning on one of those is how a
  codebase learns to scroll past warnings. Not a code, because a code puts it in the list of faults to sweep
  for.

  **It asks the decorator, not the output.** Identity was the first attempt and it has false positives,
  measured: `render() { return this.props.children }` and `render() { return A_CONSTANT }` also hand back one
  object and hide nothing the parent did not already check. The cost of asking the decorator is stated rather
  than hidden — a `@compute` body returned from `render` is the same deal and is not noted, because at that
  point nothing distinguishes it from those two.

  The ban stays for every decorator where it still means something: `@created`, `@mounted`, `@updated`,
  `@destroyed` change when the render runs, `@catchError` makes it the handler for its own subtree, and
  `@state`/`@persist` mean "serialise me", which a render is not.

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

- 0a5df09: **`@StableProps` goes on a component now**, and means there what it means on a hook: _these props
  are values, compare them by content._

  An object written in the JSX is a new object every render, so `<Panel filter={{ q: "open" }} />`
  hands the child a changed prop every time and re-renders it forever. Measured: 5 parent renders, 5
  child renders, for markup where nothing moved. Declaring the prop settles it:

      @StableProps("filter", "flags")
      export class Panel extends Component<{ filter: { q: string }; flags: string[] }> {}

  Now the same markup re-renders the child **zero** times, and contents that really do move still
  reach it — a declaration is not a freeze.

  **It takes names, not a rule, and that is the point.** The other control a component had was
  `@ShouldUpdateOnPropsChange`, which takes a PREDICATE — a thing an app can get wrong in the
  direction that matters, a component that stops rendering when it should. The worst a wrong name here
  can do is fail to type-check, and the names are checked against the component's own props exactly as
  they are for a hook.

  **The double render knows about it.** `RMD020` reports a value the second render built afresh, which
  is precisely what an object literal in JSX is — so reporting it on a declared prop would be
  reporting the fix the diagnostic's own advice recommends. It skips declared props now, and still
  reports an undeclared one.

  **Beside `@ShouldUpdateOnPropsChange`, the order is settled and tested.** `resolveStable` runs
  first, so a hand-written gate is handed the SETTLED props — `previous.filter !== next.filter` sees
  "the same" when the contents match, which is what the declaration promised. Resolving after the gate
  would mean a component taking props identical to the ones it already had.

  Under the hood it is the same `resolveStable` a hook's props already went through: the diff hands
  back the identity the component already had while the contents match, so the bag comparison, the
  signals and `@watchProp` all see what they would see if the parent had never rebuilt it. Nothing
  downstream needed a special case, and a class that declares nothing skips the work entirely.

  A function prop is still left alone — two closures with the same body are not equal by any
  comparison that is safe to make — and contents are compared to a bounded depth, so a deeply nested
  literal gets a fresh reference rather than a wrong one.

- db7f1b0: RMD020 reaches inside a row. An inline handler or a rebuilt object on a `.map()`ed row, or in a `list()`
  row callback, was silent — the same thing written by hand was reported.

  **Why it was silent, which is one cause with two halves.** `h.ts` wraps any array in children position
  into the same `IS_LIST`-branded shape a `list()` descriptor has, and the comparison had one branch for
  both: compare `each`, stop. That is right for a descriptor, whose builder has not run and whose rows do
  not exist yet. A `.map()` region is the opposite — its rows are already built and sitting in `vnodes`, in
  both outputs — and they were discarded. So `<li onClick={() => …}>` was reported when written by hand and
  silent the moment it came from an array.

  **Two fixes, in the two places that have something to compare.**

  A region's rows are compared where the render output is walked, which costs no BUILDS: nobody builds
  anything that was not built anyway. Each row is checked on its own budget rather than sharing one with its
  neighbours, because sharing truncated — measured, a 1000-row `.map()` whose only mistake was on the last
  row went unreported.

  A `list()` row is built by the engine during the diff, so `listEngine.ts` builds it a second time there —
  with the tracker detached, so the throwaway build adds no dependencies — and compares. That is also the
  cheap place:

  ```
  100 rows, a stable callback, mount then three more renders
  check on:   200 row builds on mount, 200 after the three
  check off:  100                      100
  ```

  Twice for a row that is **built**, nothing for one that is reused. A list whose rows are steady pays
  nothing after the first render, and `configureDev({ strictRender: false })` turns off the second build
  along with everything else.

  **One consequence to expect:** a row callback with a side effect performs it twice in development, exactly
  as a `render()` already did.

  **One report per callback, not per row.** The row index is left out of the path deliberately —
  `diagnose` keys a report by owner, path and kind, so an index would turn one mistake into one report per
  row. Rows that are wrong in _different_ ways still separate themselves, because the tag and the attribute
  name are in the path.

### Patch Changes

- 64c5f15: `/concepts/compute` taught a line that throws.

  The "getter or a method" block read `total() {} // this.total()` — a call. Measured: `@compute` installs an
  accessor, so a method stops being callable. `this.total` holds the value; `this.total()` throws
  `total is not a function`.

  **Nothing caught it because the claim was in a comment.** `check-examples` compiles the code in a block,
  and `// this.total()` is prose. The page now says both forms are read as a property, and why: the method
  form is a spelling, not a different kind of thing.

  It also says what follows from that, which was the missing half — a `@compute` method takes no parameters
  because nothing would ever pass one, and `@memoized` is the decorator keyed by arguments.

  Pinned in `DecoratorValidation.test.tsx`: the property holds the value, and calling it throws.
  `/concepts/caching` shows both forms too — it had the method form in one table cell while every example was
  a getter, which is how a reader concludes the getter is the only shape.

- 89efb35: `@compute` refuses a method that declares a parameter, in the build that has no types.

  A typed build already refuses it — `compute`'s target is `(this: T) => R`, so a parameter is `TS1241` —
  and that half is now pinned in `__tests__/DecoratorTypeClaims.tsx`. Bypass the type and it was silent:
  measured under vitest, which transpiles rather than checks, `@compute times(n: number)` left `this.times`
  holding **`NaN`**, with the body run once for `n === undefined`. `@compute` on a method installs an
  accessor, so nothing was ever going to pass an argument.

  It says which decorator does take one, because that is the line between the two: **`@compute` is keyed by
  nothing, `@memoized` is keyed by its arguments.** The parameter list is where they are told apart, and
  asking whether the two names collide is what turned this up.

- fbb552f: The guarantee about list rows is documented for what it covers, and the one boundary is documented next to
  it. No behaviour changed.

  The lists page said "what you never get is a stale row", without qualification — and you can, in one shape
  that core's own test already asserts. `ListCallbackIdentity.test.tsx` reads the same non-`@state` field
  twice in one component, once in the markup and once in a stable row callback, and the two answers differ:
  `render()` runs whole and re-reads it, a reused row does not run at all. The test called that "the
  documented behaviour" while nothing documented it.

  So the promise is stated for what it is — every signal a row reads while it is built is recorded against
  that row, and a write marks exactly the rows that read it — and the boundary is stated with the reason it
  looks like it works until the callback becomes a method. The fix is the one `@state` already gives: mark the
  field, or leave the callback inline, which rebuilds every row and so reads it again.

- cc70e51: `@StableProps` settles children, and it is now written down that it does.

  Measured rather than assumed, in `ChildrenAreProps.test.tsx`: a component given children renders
  four times over three renders of its parent, where a childless one renders once. A rendered node is
  built during the render, so children are a fresh value every time and the shallow comparison can
  never match them — even when the children are a piece of static text. A node handed over as a prop,
  `header={<Header />}`, is the same thing wearing a different hat.

  Nothing changed in the runtime; `children` was always a prop and `@StableProps` always named props.
  What was missing is that anyone would think to write it:

  ```tsx
  @StableProps("children", "header")
  export class Panel extends Component<{
    header?: unknown;
    children?: unknown;
  }> {}
  ```

  The tests pin the behaviour, including that it is not a freeze — children that really change still
  arrive, and so does content nested deeper than the comparison goes. Also measured: a slot taking the
  component CLASS, `view={Header}`, costs nothing to begin with, because a class is the same reference
  for the life of the module.

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

- c6d2a30: A third pass over `any`: **60 → 38**, still zero `as any` — and the answer to a question item 33 had left
  open.

  **`never[]`, not `unknown[]`, is the bound a lifecycle decorator wants.** `@updated` and
  `@deferHydration` declared `value: (...args: any[]) => void`, with a comment saying a repo-wide
  type-check could not prove `unknown[]` safe. Measured on the shape nothing here contains:

  ```
  any[]      accepts `@updated after(n: number)`, and is `any`
  unknown[]  REFUSES it — TS1241, because a parameter is contravariant
  never[]    accepts it, and is not `any`
  ```

  So the signature did not need to lose its parameters; it needed the right bottom type. The same applies to
  every constructor CONSTRAINT — `@Host`, `@ShouldUpdateOnPropsChange`, and the `InstanceOf`/`PropsOf`/
  `HookPropsOf` helpers. `src/__tests__/DecoratorTypeClaims.tsx` pins it: put `unknown[]` back and two
  `TS1241`s appear, which is what a false green looked like.

  **And the opposite direction, which is the other half of the rule.** `@ramonda/router`'s
  `NoPropsHookClass` needed `unknown`, not `never`: it types a VALUE that must accept core's real
  `Runtime`, and a parameter typed `never` refuses it. `never` is right in a constraint, `unknown` is right
  in a value's parameter, and `any` was standing in for both.

  **Three types that were claiming the wrong thing, found because an `any` had been hiding them:**

  - `Effect.effect` was `() => undefined | (() => void)` while the runner guards with
    `typeof res === "function"` and ignores anything else. It is `() => unknown` now, with the one
    assumption named in an `isCleanup` predicate instead of bridged by an `any` in `attachEffect`.
  - `ComponentRuntime.rawProps` was `RenderableProps<any>`, which is the props SHAPE — but every reader
    treats it as a bag, and `debug/inspector.ts` already declared it as one. Typed
    `Record<string | symbol, unknown>`, it also deletes the two casts in `Component.ts` that said so.
  - `areStringRecordsEqual` took `Record<string, string | undefined>` and its one caller passes props,
    whose values are handlers and objects. Renamed `arePropsBagsEqual`, over `unknown` — the body only
    counts keys and compares with `!==`.

  `EnhancedHTMLNode._listeners` is `Record<string, EventListener>`, which is exactly what goes in and comes
  out of `add`/`removeEventListener`.

  The counting script now lives at `scripts/dev/count-any.mjs` rather than in a scratch directory, because
  the last two passes' numbers were not comparable once their script was gone.

- 62cdeb3: A page for the two caching decorators: `/concepts/caching` — "One per component, or one per item".

  `@compute` and `@memoized` look alike from outside. Both hold a result, both hand back the same thing
  until a signal their body read has moved — and that shared machinery is the visible part, which is why
  people reach for the wrong one. The page leads with what actually separates them: **the key**. `@compute`
  is keyed by nothing, so there is one value per component; `@memoized` is keyed by its arguments, so there
  is one per argument.

  So the decision is one question with no grey area — _is there one of this value per component, or one per
  item?_ — and the page says why a `@compute` cannot do the second: it has exactly one slot, so there is
  nowhere to put a value per row.

  It also covers what the similarity really is (both watch the signals their body read, both freeze what the
  builder captured), that a typed build refuses `@compute` with a parameter so the wrong choice cannot be
  made by accident, that `@memoized` caches a value as readily as a handler, that the arguments have to be
  keyable, and when the answer is neither.

  `/concepts/timers` and `/concepts/refs` move down one place to make room after `/concepts/compute`.

- f99f11a: `@StableProps` now type-checks on a context Provider.

  It always WORKED there — declaring a key takes a consumer from four renders to one, measured in
  `ContextValueIdentity.test.tsx` — but it would not compile, which is the worst way for a gate to be
  wrong: the recommended fix was a type error.

  `createContext` hands back `new (owner, options: T) => BaseHook<T> & Readonly<T>`, and `BaseHook`
  carries no props phantom the way `Hook` does. So the decorator fell through to its COMPONENT branch,
  which reads the props off the constructor's first parameter — and for a hook that parameter is the
  runtime. Every name was then "not a prop of this class".

  It is told apart by its RETURN, like the branch beside it, so a component cannot reach it. Putting
  the phantom on `BaseHook` instead was tried and reverted: reading the type parameter makes the class
  variant in it, and `this.use()`'s overloads stopped resolving for every hook in the repo.

- 497e452: The scaffold check prints why a command failed. It was swallowing the reason.

  `String(error.stdout ?? error.stderr ?? error)` looks like a fallback chain and is not one: `??` falls
  through only on `null` and `undefined`, and a command that writes its error to stderr leaves `stdout` as
  `""`. So the detail was the empty string, `if (detail)` was false, and the check printed a headline with
  nothing under it — which is exactly what a CI run did:

  ```
  [scaffold] `npm ci --omit=dev` failed — a production install of the generated project
  Error: Process completed with exit code 1.
  ```

  Both streams are read now, and the tail is 60 lines rather than 25 — an `npm ci` failure puts its useful
  line above a wall of flag documentation. Planted to prove it: with the lockfile removed, npm's own output
  now reaches the log, and before this it did not.

  This is the whole change. It does not fix that CI run — that run's reason is gone, because it was never
  printed — it makes the next one say so.

- cf9fda9: `/concepts/lifecycle` documents what `@updated` is for beyond measuring: it is the signal a browser view
  transition waits for.

  A CSS transition needs the element to exist while it plays, and removing a row takes the node out — so the
  exit never runs. `document.startViewTransition` snapshots the old frame instead, and waits for your
  callback's promise to resolve once the DOM matches the new state. That is `@updated`, exactly, so the
  pattern needs nothing new: six lines of app code.

  **And it says what not to do.** Updates are batched on a microtask, so awaiting a few turns inside the
  callback happens to be enough — measured, and "happens to be" is the whole problem with it. Both edges are
  written down too: a change that schedules no render never fires `@updated`, so the callback needs a
  deadline as a net; and in a cascade the first `@updated` resolves before the last pass.

  The playground has it as a hook rather than a decorator — `apps/playground-core/src/demos/ViewTransition.tsx`
  — because the framework already has the signal, and the half that needs thought is `view-transition-name`
  in a stylesheet, which no decorator can reach.

- dc3368d: **`@memoized` on two methods of one component returned the same handler.** The second method's
  call ran the first one's body — no diagnostic, nothing thrown.

  The cache is one map per instance, shared by every memoized method on it, and the key was built from the
  arguments alone. So `removeFor(1)` and `editFor(1)` collided:

  ```
  removeFor(1) === editFor(1)     // true
  remove(); edit();               // "remove:1", "remove:1"
  ```

  That is the commonest shape there is in a list row — several per-item handlers keyed by the same id. The
  member's name is part of the key now, separated by a NUL (`\u0000`) because a caller's own string goes
  straight into the key and `editFor("remove")` could otherwise land on `removeFor`'s entry. A test pins
  that case too.

  **How it was found, which is the part worth repeating.** A playground page with three buttons per row —
  remove, remove-after-a-class, remove-inside-a-view-transition — where all three did the same thing. Every
  existing test used one memoized method per component, so nothing in core's 1174 tests could see it.

- 370c92f: `/reference/decorators` said `@compute` on `render` "turned the method into a cached property, so rendering
  died with `component.render is not a function`". That crash is gone, and what replaced it is worse in the
  way that matters.

  The method form installs a function now, so `render` stays callable. Measured in a production run, where
  the development guard is stripped:

  - a state write still reaches the DOM — the render is cached on the signals it read, and state is one;
  - so does a props change;
  - and a **plain field freezes the page**. The same component without the decorator shows `new`; the
    computed one keeps `old`, because nothing it read had moved.

  So the guard exists because this fails **silently**, not because it crashes — the old symptom was loud and
  immediate. And the type does not refuse it either: `@compute render()` is exactly the shape `compute`
  accepts, which makes `assertNotRender` the only net, and that one is stripped from production.

  `__tests__/prod/ComputeOnRender.prod.test.tsx` holds all four measurements, with the undecorated control
  beside the computed one — that pair is what makes the freeze a fact rather than an argument.

## 0.20.0

### Minor Changes

- c779b40: A cached callback can no longer serve a stale value — `list()`'s rows and `@memoizedHandler`.

  Two caches in the framework decided when to re-run a callback from the signals that callback READ. Reads
  are tracked wherever they happen — any call depth, any module, measured through two helpers in a second
  file. What neither cache could see is a value read OUTSIDE the callback and closed over, and both served
  it for ever.

  **`list()`.** A row callback that captured a local kept the first value for the life of the list:

  ```tsx
  const label = this.label;
  list(rows, () => <li>{label}</li>); // "old", for ever
  ```

  Measured: `"old"` in the row where the same field in the markup beside it read `"new"`. A `@state`
  signal read one line too high behaves identically — the trigger was never "a plain field", it was "not
  read inside the callback".

  Nothing can look inside a closure and enumerate what it captured, so the engine goes by what it can see:
  **a callback whose reference is new might have captured anything, so its rows are rebuilt; a callback
  that cannot capture a render's locals keeps the fast path.** Measured over three renders — a class
  method gives 1 distinct reference, a module-level function 1, an inline arrow 3 — so one identity check
  separates every form with nothing static and no guessing. The whole-list skip is gated on it too, which
  is the half that is easy to miss: it returns the cached node without calling the callback at all.

  **What it costs, measured at 10 000 rows over five re-renders:** the stable form does 0 row builds and
  the inline form 50 000 — and **both do 5 DOM writes.** The diff finds the rows identical and touches
  nothing, so the price is closures and small objects and never the document. Wall clock could not answer
  it here and is not quoted: jsdom swung wider than the effect, and one attempt was outright invalid.

  **`@memoizedHandler`.** The same shape. The cache is keyed by the arguments, so the method runs once per
  key and whatever it read on that call is frozen into the handler. Measured: a builder reading
  `this.prefix` served `"old:a"` on every click while `prefix` already said `"new"`. The builder now runs
  inside a tracker and a change to anything it read **drops that one entry** — per entry, not the map,
  which is what keeps a handler built for other arguments identical:

  ```tsx
  pick(id) { let val = 0; if (id === 2) { val = this.mode; } return () => …; }
  ```

  `pick(1)` read nothing, so its function never changes. Only `pick(2)` is rebuilt. Both halves are pinned,
  and wiping the map instead fails the second.

  **What the review caught, and it was the important half.** The first version of the memo fix REPLACED the
  enclosing tracker instead of forwarding to it, so the builder's reads were visible to nothing: the entry
  was dropped when the signal moved, but the region holding the handler was never invalidated and the stale
  handler stayed in the DOM. Measured in the decorator's canonical use — one handler per list row —
  `"old:a"` on both clicks. The deps are now forwarded through `trackDependency` on the way out, on the hit
  path as much as the miss path, exactly as `@compute` and the props cache do and for the reason they
  document. And the per-entry subscriptions are released from `clearReactives` on destroy, which the first
  version also missed: a builder reading a signal that outlives the component left its listener attached
  for the life of the page.

  **Free for correct code, in both places.** A row callback written as a method, and a handler builder that
  reads nothing, track nothing and are never invalidated — which is the whole purpose of each cache. When a
  signal WAS read, a rebuild is the honest answer: the row or the handler behaves differently now.

  **A pre-existing fault came with the review and is fixed here**, because it lives in the same set of
  remembered fields: `list(undefined, …)` returned an empty node while still remembering the array from the
  pass before, so handing the same array back later matched the whole-list skip against that empty node and
  the rows never returned. Measured on `main` as well: `rows → undefined → the same rows` gave 2 rows, then
  0, then 0. Pinned for both callback forms.

  Both halves are real runtime code rather than development checks, and the production bundle grew by
  **146 B gzipped** — 21043 → 21189, measured by bundling `core`'s entry with `--define:__DEV__=false`
  against the same file on `main`.

  Ten tests across `ListCallbackIdentity.test.tsx` and `MemoizedHandlerStaleness.test.tsx`, including the
  four nested-list combinations (both inline, both stable, only outer, only inner) and the boundary that is
  NOT fixed and now says so: a stable callback reading a plain field still caches it, exactly as a
  `@compute` over a plain field does.

  Seven existing tests moved their mapper to a method, because that is now the form the cache applies to —
  their intent is unchanged and each says why beside itself. Documented on `/lists` and `/concepts/events`.

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

- 915505f: `htmlFor` now writes the `for` attribute. It used to write nothing.

  `concepts/jsx` states the pair as one rule — "`class` and `for` are keywords in JavaScript, so JSX
  borrows the DOM property names instead: `className` and `htmlFor`" — and only half of it was
  implemented. An HTML attribute is written through `setAttribute`, which lowercases the name, and
  `className` was special-cased into `class` while its twin was not.

  Measured, not inferred: `<label htmlFor="a">` rendered `htmlfor="a"`, and `label.htmlFor` read `""`.
  The label was associated with nothing — no error, no warning, in markup that typechecks and looks
  correct. Both the DOM and the server path go through the same writer, so both were affected.

  `<label for="a">` always worked and still does; the read-back path normalizes both to the spelling
  the JSX uses, so a diff compares like with like. Removal goes through `for` as well — removing it
  under the JSX's name would have been the same no-op `className` documents beside its own.

  Found while writing `control-with-no-label`, which had been built around an attribute that did
  nothing.

- d8e6d01: `<img>`, `<area>` and `<iframe>` now have to be named, in the types.

  These are the elements with nothing inside them to work them out from, so the name is the content
  rather than a nicety. Any of `alt`, `aria-label`, `aria-labelledby` or `title` satisfies it —
  `<iframe>` takes the last three, since `alt` is not one of its attributes.

  **A union rather than `alt: string`**, deliberately. `unnamed-image` already accepts all four, and a
  type demanding `alt` alone would refuse `<img aria-label="…">` — markup the checker calls correct.
  A type and a rule disagreeing about the same line is worse than either being slightly lax. `alt=""`
  satisfies it, which is right: it is the documented way to say "decoration, skip me", and that is a
  decision somebody made rather than one they forgot.

  **What it does to a spread is the point.** `<img {...rest} />` with an untyped bag is refused,
  because nothing about that bag says a name is in it — and that is exactly the case the checker
  cannot speak about, since a spreading element is handed to no rule at all. The two halves cover each
  other instead of overlapping. A spread whose TYPE carries a name passes, which is the shape a
  wrapper component should have anyway.

  Measured across every app and package here: zero errors, scaffold templates unaffected, and the
  documentation's own examples typecheck unchanged. The production bundle is byte-identical — types
  are erased.

  **A spread is not restricted.** The requirement is about the name, and anything that proves one is
  there satisfies it — the spread's own type, or an attribute written beside it:

  ```tsx
  <img {...anything} alt="written out" />   // fine — the name is right there
  <img {...imgProps} />                     // fine — the type carries one of the four
  <img {...bag} />                          // refused — nothing says a name is in it
  ```

  Controls are untouched: nothing is required on an `<input>`, `<select>` or `<textarea>`, so a form's
  `bind` spread goes on exactly as before.

  All of it is pinned by `packages/core/src/__tests__/JsxTypeClaims.tsx`, which states every claim in
  both directions — shapes that must compile, and shapes under `@ts-expect-error` that must not. A
  directive that stops being necessary is itself an error, so relaxing any of this fails the typecheck
  rather than passing quietly. Verified by relaxing the image requirement (four directives went
  unused) and one refused name (one did).

- 328e9fd: A second pass over `any`, and the `__isComponent` probe written once.

  **Counted the same way each time, and the method is now written down so the next pass is
  comparable:** every published package's `src`, tests and `.d.ts` excluded, comments and string
  literals stripped, `any` matched as a word. **105 → 60, and `as any` stays at zero.** The 111 quoted
  by the previous pass came from a script that no longer exists, so 105 is this script's reading of the
  same tree before this change, not a claim that six went missing.

  What went, each measured rather than assumed:

  - **`State<any>`, all eleven of them** — the tracker's dependency sets, `propsSignals`,
    `@compute`'s cache. `State<unknown>` accepts a `State<number>` because `set` is declared as a
    method and methods are bivariant, so nothing at the edges had to change. Core's type-check covers
    175 test files with concrete signal types in them, which is what makes this a real green.
  - **`BaseComponent<any>`, all ten** — the task queue, the lifecycle walks, the effect runner.
    `BaseComponent<unknown>` works; `BaseComponent<never>` does not, and the error says why — `props`
    is read, so `never` is the wrong end. `testing.ts` gets away with `never` because there it is a
    RETURN type.
  - **The props bag inside `useCommon`** is now a named `Bag = Record<string, unknown>` — build,
    compare, cache and hand on, all by key, nothing reading into a value. Typing it named a state the
    code had left unsaid: `PropsCache.bag` was `undefined` until the first build, which is now the
    shared `NO_BAG` beside the `isDirty` flag that already says when the bag is meaningful.
  - **`Lazy` is `() => Promise<Record<string, unknown>>`** rather than `Promise<any>`, so the module
    namespace a page loader resolves is typed and `res[namedExport]` is `unknown` at the point where
    the code already asks `typeof component !== "function"`. Proved against the real shape:
    `() => import("./mod")` is assignable. `apps/docs`' generated loader map now imports `Lazy` instead
    of restating the signature, which is what caught this at all.
  - **`@state`'s ignored initializer, its setter, `buildKey`, `describeUnkeyableArgs`, `memoMap`'s key,
    `hooksOptions`, `componentFactory`'s props** — each of these took `any` where the code only ever
    passes the value on or asks `typeof` about it.
  - **`@memoizedHandler`'s context is `ClassMethodDecoratorContext<{ [GLOBAL_RUNTIME]: Runtime }, T>`**
    rather than bare, so the initializer's `this` is typed by the context instead of by `any`. It also
    refuses the decorator on a class the framework does not own, which is a class it never worked on.

  **`isComponentClass` in `vdom/guards.ts`.** The same probe was written five ways — four carrying
  `as unknown as { __isComponent?: boolean }` and one taking its argument as `any`. `@Host`,
  `@ShouldUpdateOnPropsChange`, `@StableProps` and `lazy`'s `toRenderable` now ask it once, and the
  casts have nowhere left to be. Four casts and one `any` gone. Breaking the predicate on purpose fails
  **290 of core's 1122 tests**, so it is under a gate rather than beside one.

  `h.ts` is the one caller that keeps its own probe, and the reason is written beside it: `name` there
  is `ComponentKind | UnsupportedTagFn`, and `UnsupportedTagFn` is `(props: never) => RamondaNode`,
  which TypeScript will not separate from a construct signature — so the predicate narrows to a union
  of the two and the cast comes straight back.

  **Where `any` earns its keep, so the next pass does not repeat the experiment:**
  `@compute`'s `addInitializer(function (this: any))` cannot be typed from the context, because
  `ClassMethodDecoratorContext<This, …>` declares `this` as the unconstrained `This`; typing it costs
  two casts inside and constraining `This` is a surface change rather than a tightening. The same is
  true of `@memoizedHandler`'s returned handler, which has to stay assignable to the method's own `T`.
  The rest are inference and constraint positions — `new (...args: any[]) => infer I`,
  `Record<string, any>` on JSX attributes and on a decorator context's instance type — where `unknown[]`
  is refused for the reason `decorators.ts` already records.

  **A MINOR rather than a patch, because two of these narrow a published type.** `Lazy` no longer
  accepts a promise of anything — a `lazy` that resolved the component itself rather than a module
  namespace stops type-checking, and it never worked at runtime either (`res[namedExport]` was
  `undefined` and threw "Missing named export"). And `@memoizedHandler`'s context now requires the class
  to carry the framework's runtime, which refuses the decorator on a class it never worked on. Neither
  changes behaviour, and both are refusals a build will show you.

  Behaviour is unchanged: 1122 of core's tests pass, and all 28 `check-types` tasks are green.

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

- c583271: The JSX types now refuse five attribute names that reach the DOM verbatim and do nothing, with the
  correct spelling written into the error.

  An HTML attribute is given to `setAttribute` as it stands, which lowercases it. Exactly two names
  are aliased on the way, because they are reserved words: `className` → `class`, `htmlFor` → `for`.
  Everything else is written as HTML spells it — **including the hyphens**. So a camelCase name whose
  real attribute is spelled differently arrives as something no browser reads. It renders, it does
  nothing, and there is nothing on the page to see.

  Measured by rendering every camelCase name a JSX author might reach for and reading back what landed
  in the document. These six came back dead; the rest (`readOnly`, `maxLength`, `tabIndex`, `colSpan`,
  `srcdoc`, `datetime`, `contentEditable`, and the rest) all lowercase correctly and are untouched:

  | refused                    | write instead                                                                                   |
  | -------------------------- | ----------------------------------------------------------------------------------------------- |
  | `httpEquiv`                | `http-equiv`                                                                                    |
  | `acceptCharset`            | `accept-charset`                                                                                |
  | `defaultValue`             | `value` — the attribute **is** the initial value; there is no controlled/uncontrolled pair here |
  | `defaultChecked`           | `checked`                                                                                       |
  | `innerHTML`, `textContent` | the element's children                                                                          |

  The refusal is a string literal type rather than `never`, so the error carries the answer:
  TypeScript prints the expected type, and the expected type is the advice.

  ```
  Type '"refresh"' is not assignable to type '"write `http-equiv`, with the hyphen, as HTML spells it"'.
  ```

  Kept short deliberately — the error is read in an editor tooltip and on one terminal line, which is
  the most cramped place any of this project's prose appears.

  Refused rather than aliased on purpose. `class` and `for` are aliased because they are reserved
  words, and that rule is complete — nothing here is reserved, and `http-equiv` is writable exactly as
  HTML spells it. Aliasing would turn a two-name exception into a list that grows forever.

  Zero errors across every app and package in this repository, and the production bundle is
  byte-identical: types are erased.

- 35920e5: RMD020 and RMD022 report a `Date`, a `Map`, a `Set` or a class instance built inside a render — and an
  inline function inside an object prop is named as the handler it is.

  **A gap that two files documented as covered.** `classify` asked `isPlainObject`, which is
  `Object.prototype`-or-null and nothing else, so any value with a prototype fell through to "this
  difference says nothing about how it was built". Measured, `new Date()` was reported in no position at
  all — not as a component prop, not as a DOM attribute, not as a child — while `debug/purityGuard.ts`
  listed it under "what covers the clock then" as _"RMD020, every time (a fresh object has a fresh
  identity)"_, and `renderStability.ts` said the same. Being a fresh object only helps if the comparison
  looks at it.

  There is a new `instance` verdict for it, separate from `object` because the contents genuinely are not
  read: `valueEqual` walks own enumerable keys and a `Map`'s entries are not those. So it says the object
  is FRESH rather than claiming it matched. Two different prototypes from two calls in one tick stays
  non-determinism — a render that builds its own `class` is exactly that.

  **And a report that named the wrong fault.** `cfg={{ fn: () => 1 }}` was reported as _"produced a
  different value … so the value does not come from state"_, advising a hunt for a `new Date()` or a
  `Math.random()` in an app containing neither — the two bags differ only in a closure's identity. A plain
  object prop whose contents are not equal is now descended into, so each key answers for itself and the
  report says `cfg.fn`, "the source is the same". A differing _set_ of keys is not a rebuild and stays
  non-determinism. `children` one level down is an ordinary key, not a tree.

  Nothing that was quiet becomes loud by accident: a stable field, a `@compute` or a module constant passes
  `Object.is` long before any of this, so only a value constructed during the render can reach it.

- e1cd3aa: `RMD033` now catches what it has always said it catches.

  Its `fix` text reads: "a function, a class instance, a **Map** or a **Date** is lost on the way".
  The implementation was a `try`/`catch` around `JSON.stringify`, which only ever sees a THROW — and
  none of those throw. Measured by round-tripping every common type through the hydration blob:

  ```
  new Map([["k", 7]])  ->  "{}"            every entry gone
  new Set([1, 2])      ->  "{}"            every entry gone
  new Date(0)          ->  "1970-01-…"     a string, so .getTime() throws on the client
  ```

  All three crossed **silently**, with no diagnostic at all, and the page then failed later with a
  `TypeError` on a method the value no longer had. A `Date` in state is not an exotic case; it is the
  ordinary shape of a created-at field.

  The check now asks about the SHAPE rather than matching a list of types: anything that is not a
  plain object, an array or a primitive comes back from the blob without its prototype and usually
  without its contents. That covers `Map`, `Set`, `Date`, `RegExp`, `URL` and any class instance,
  including the ones nobody thought to list. It recurses, bounded, because the commonest shape of all
  is a plain object holding one — `{ createdAt: new Date() }` travels as an object whose date has
  quietly become a string.

  No new diagnostic code: `RMD033` already meant this. Development-only, on the serializer's
  once-per-render path rather than the per-write one.

- e501d2d: `RMD058` — the request blob could not be read.

  `hydrateRoot` reads the values a page opted into from an attribute the server stamped on the root
  element. When that string does not parse, nothing is restored: every `requestContext().get(key)` on
  the client answers `undefined`, including keys that were exposed correctly. That was already the
  behaviour and it is the right one — a page that renders with a value missing beats a page that does
  not render, which is the same stance `RMD036` takes for the state blob.

  **What was missing is the report.** Silence here is expensive, because two other diagnostics fire in
  its place and both point away from the cause. Measured on a page whose blob was mangled after it was
  served: `RMD025` says the key was not exposed — it was — and `RMD007` reports the render mismatch
  that follows, whose advice is about clocks and random numbers. The page looks correct throughout,
  because the server's markup is still on screen. A reader is sent to add `exposeToClient` to a key
  that already has it, and then to hunt non-determinism that is not there.

  `RMD058` is the one that says what actually happened. Its test asserts the other two beside it —
  neither is a bug, each is right about what it can see, and this is the code that explains them.

  A warning rather than an error, matching `RMD036`.

### Patch Changes

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

- 59bf7b5: The `Context` type says what a context is, and the object two publishers share is under a gate.

  `Context` was declared `Record<string | number, State<any>>`. Nothing has stored a `State` there
  since a context became one signal per key, and one of its two publishers keys by a symbol, which
  that declaration does not even permit — so both of them cast their way past it, and a cast is what
  lets one place quietly break the other. It is now `Record<string | number | symbol, unknown>`, and
  the invariant lives on it in one place: a component's object is created FROM its parent's, so a read
  walks up to the nearest ancestor that published; a publish lands as an OWN property, so a sibling
  reading the same ancestor never sees it. Two casts deleted, one `State<any>` gone, and the
  `Object.create` in `createComponent` typed instead of `any`. Every read keeps its cast, which is the
  publisher naming the shape it published.

  No helper was added. What both publishers do is `context[key]` and `context[key] = value`, and a
  function around either is a call-site wrapper — the honest type is what makes them safe, not a
  second way to spell them.

  **Measured by breaking it on purpose.** Replacing `Object.create(parentContext || null)` with the
  parent's own object — the change anyone would make to save an allocation — failed **2 of core's 1116
  tests, both about `Head`**; the same break in the hydration creator failed **none of the 1121**. So
  the context half of the mechanism was unguarded in both places and the hydration half entirely.
  `ContextIsOnePerComponent.test.tsx` holds six cases for the two publishers together — sibling
  isolation, the chain across wrappers a provider does not sit on, the nearer provider shadowing for
  its own branch only, a change still arriving down the chain, a `Head` and a context sharing one
  object undisturbed, and the same isolation after a real server render and hydration. Against those
  breaks it now fails 3 of 6 and 1 of 6.

  Behaviour is unchanged: 1121 of core's tests pass before and after.

- 55e5c90: RMD056: one context provided twice by the same component.

  A component publishes a context on ONE object — its own — so a second Provider of the same context
  replaced the first under the same key, and every descendant read the second. Nothing said so.

  **Measured before it was written.** `first = this.use(ThemeProvider, () => ({ theme: "first" }))` and
  `second = this.use(ThemeProvider, () => ({ theme: "second" }))` on one component: the descendant reads
  `"second"`, while the component itself reads `first.theme === "first"` and
  `second.theme === "second"`. That is what hid it — a Provider provides AND reads, so the component
  that made the mistake is the one place it looks fine.

  The check is `Object.hasOwn(owner.context, contextId)`, and own-ness is the whole question. A context
  object is `Object.create(parentContext)`, so a Provider ABOVE this component leaves the key inherited
  here rather than own — that is nesting, it is ordinary, and it stays silent. Only a second publish on
  one component makes the key own. Both directions are under a gate: silencing the check fails the
  report test, and widening it to `in` fails the nesting test, which is the mistake the shorter spelling
  would make.

  **It reports rather than throwing**, unlike a plain-object props bag (RMD055). There a shipped bundle
  would go on serving a value nobody set; here the page has one deterministic reading, and refusing it
  would break an app that has been living with the first Provider ignored. Severity `error`, so the
  devtools panel raises its alert, and a later version can refuse.

  **It fires twice on this repository, and both are real.** `@ramonda/form`'s tests mount two `Form`
  hooks on one component — `Focus.test.tsx` and `Validation.test.tsx` both do it deliberately — and a
  `Form` publishes itself on the form context so descendants can find it. So the second form replaces
  the first, and **a descendant that reaches its form through the context binds to the second one
  whichever form's markup it is in**. Measured: submit the first form and its own `submitCount` is 1
  while a descendant `FormState` reads 0. Form's own tests do not catch it because they all reach the
  forms directly, as `this.a` and `this.b`. That is `@ramonda/form`'s to fix and is not touched here;
  the diagnostic is what found it.

  Deduped per context and owning component. DEV only — the check and its message are inside `__DEV__`,
  and measured on a production bundle of `Context.ts`: `consumedBy`, both probes, the report function,
  `diagnose` and both codes are absent.

- 6ce885e: The ten-second watch armed for a deferred subtree is now cleared when that subtree resumes.

  It was harmless in the sense that mattered least: the callback re-checks `hydrationPending` and
  `isDestroyed`, so it could never report falsely — which is exactly why nobody noticed. What it did
  was hold on. The timer's closure holds the component, and `unref` (the only thing that used to be
  done about it) is **Node-only**, so in a browser every deferred subtree kept its component alive for
  ten seconds after it was finished with. A page full of them holds a page full of dead components.

  Cleared at the top of `resumeHydration`, above its early returns rather than beside the successful
  path: the watch is over the moment the promise settles, whichever way it settled, and a subtree that
  resumed into a torn-down component has answered the question just as much as one that rendered.

  The armed timers live in a `WeakMap` rather than on the component runtime — every component would
  carry that field while only a deferred subtree ever arms a timer, and an entry keyed by the
  component needs no teardown of its own. +115 bytes raw in the production bundle.

  Asserted by counting the timer, because the diagnostic cannot: a resumed subtree produces no report
  whether the timer is cleared or not. The test fails without the fix.

- 1f0ea2a: RMD020 and RMD022 descend into an **array** prop as well as an object one.

  `cols={[{ key: "name", render: () => … }]}` — a table's column definitions — reported _"produced a
  different value … so the value does not come from state"_ against the whole array, which sends the reader
  looking for a `Math.random()` that is not there. The two arrays differ only because a closure inside item
  0 does. It reports `cols[0].render`, "the source is the same".

  An array whose _length_ disagrees between the two calls is not a rebuild, so that stays non-determinism —
  the same rule the object side already applied to a differing set of keys.

- f30286d: Two diagnostics were telling readers the wrong thing, found while auditing which of them could be
  answered statically.

  **`RMD042` reported working code, and carried `RMD043`'s advice while doing it.**

  It fired for every `@onElement` on a default host. Most of those work: measured — a click on a child
  of a boxless host reaches the listener, because bubbling needs an ancestor rather than a box. It now
  fires only for an event that does not bubble, which is one dispatched at its target and nowhere
  else: `mouseenter` needs a box to enter, `focus` needs something focusable.

  And the advice was wrong twice over. Its fix text was, word for word, the paragraph about `Head` matching `<meta>` tags by `name`,
  `property` or `http-equiv` — copied from `RMD043`, and never noticed, because a fix text is only read
  by somebody who already has the problem. It now explains the boxless host, and says why a bubbling
  event is not this fault.

  **`RMD041` described a mechanism that does not exist.** It said "the selector matched nothing", and
  advised attaching to the host instead — but the three event decorators take no selector. They resolve
  to `window`, to `document`, or to the component's own host, so the only way to reach that report is
  `@onElement` on a component whose host was not there when the effect ran. The advice now says that,
  and says what to look at when it repeats.

  Neither was reachable by a test: a fix text is prose nothing asserts. They were found by reading each
  diagnostic against what raises it.

## 0.19.0

### Minor Changes

- 3d59d25: A page that has not moved ships no hydration state.

  A field still holding the primitive its own initializer produced is left out of the blob. The
  browser runs the same initializer and arrives at the same value, so writing it down was bytes for
  nothing — and a component whose whole tree carries nothing now gets no `data-ramonda-state`
  attribute at all.

  What it was costing, measured on `@ramonda/form`'s five-row SSR page: **942 of 1935 bytes** were
  hydration state, and nearly all of it was `{"version":0}` — the subscription counter every watched
  component carries, always zero on the server, because a `@state` counter is the only thing that
  attaches the owning component's rebuild and `@state` MEANS "serialize me". At 300 rows that was
  around 17 KB of markup saying nothing.

  After: **985 bytes and zero blobs** on that page, and the SSR playground's own `/` went from 13488
  to 12704 bytes. The framework pays 239 bytes gzipped once (22544 → 22783); every server-rendered
  page collects.

  **Primitives only, and that bound is correctness rather than thrift.** An in-place mutation keeps
  the very object the initializer produced, so an identity test on an object would call a filled value
  untouched and hand the client an empty one — measured, `this.rows.push(…)` does reach the blob
  today, RMD005 and all. A primitive has no in-place to mutate.

  **A field the server EMPTIES now travels as such.** This was already broken and is fixed here:
  `JSON.stringify({ name: undefined })` is `{}`, so a field cleared on the server was indistinguishable
  from one never touched, and the browser's own initializer put the old value back — a signed-out
  visitor got the signed-in name. Cleared keys ride in their own list on the node and are applied on
  restore, through the same declared-keys filter every other restored value passes, so a tampered blob
  still cannot name a property the instance never declared. `null` is untouched and deliberately not
  folded in: JSON carries it, and conflating the two would make an explicit `null` unrepresentable.

  **What this does break is already documented as a mistake.** A non-deterministic primitive
  initializer — `@state now = Date.now()` — used to survive because the blob carried the server's
  number; measured, 101 on the server now becomes 103 after hydration. `/ssr/mismatches` already marks
  that spelling wrong and prescribes computing in `@created({ env: "server" })`, and that prescription
  is untouched, because a computed value is not the one the initializer produced. The page now says
  why the blob does not rescue it.

  Four faults planted, and the fourth is the one worth carrying. Removing the primitives-only guard
  was NOT caught at first: `mutationGuard` hands out a proxy in development, so `this.rows` never
  matched the raw array and the identity test could not fire — the test passed while the fault would
  have shipped to production, where there is no proxy. The test uses a class instance instead, which
  the guard leaves alone, so identity is the same on both sides.

  The tests that asserted the old format were rewritten to write their values first rather than to
  expect the smaller blob: a suite that asserted `{}` everywhere would pass just as well if
  serialization stopped working.

- 01a0628: A hook's props are a callback. The plain-object form is refused, in every build.

  `this.use(Counter, { start: this.count })` reads as if it passes `count`, and it does — once. A field
  initializer runs while the owner is being constructed, so the object holds what was true at that
  moment and holds it for the life of the hook. Measured with `{ seed: this.n }` and `n` moved 1 → 7:
  the hook reads **1** forever, the callback form reads **7**, the owner reads **7**, and nothing
  reported the difference.

  Nothing could report it. `use()` is handed a finished object with no way to tell `{ seed: this.n }`
  from `{ seed: 1 }`, so no runtime check exists that is not a heuristic — which leaves the FORM as the
  only visible half, and the form is now what the framework holds you to. `@ramonda/check` cannot cover
  for it either: a value reaching the bag through a helper or a build with no types is past what any
  static rule sees.

  **The migration is `() => ({ … })`,** and it costs nothing where the object looked cheapest. A
  callback that reads no signal is called **once, at mount, and never again**, and the inline functions
  in it keep their identity across every render of the owner — so a bag of constants and closures
  (`fetch`, `retryDelay`) is built exactly as many times as the object was, with no churn for RMD022 to
  report. `core/__tests__/PropsBagRuns.test.tsx` pins both halves, and the mirror beside them: a bag
  that DOES read a signal re-runs, with fresh functions each time, which is what `@StableProps` is for.

  A development build calls it more than that, and keeps none of it: twice at mount, so RMD022 can
  compare the two bags, and once per render of the owner, so RMD027 can check the cache has not gone
  stale. Both counts are measured in that file's second suite, with `strictRender` on as it is by
  default. The hook is handed the one bag in either build.

  **It throws rather than warns,** the same rule as a write to props (RMD004, RMD015), and outside
  `if (__DEV__)` so a shipped bundle cannot go on serving one stale value for the life of the page.
  Development adds the explanation and a record naming the owner, the hook and the keys the object
  carried; production carries the code and one sentence. Production core grows **63 bytes gzipped**
  (23,609 → 23,672; raw +334), and `apps/docs`'s production-build tripwire now names `RMD055` among
  the codes a production bundle may carry.

  The types refuse it first: the `props: Q` overload is gone from `Component.use` and `Hook.use`, so the
  mistake is a compile error before it is ever a thrown one.

  `RMD055` is the code, on [the diagnostics reference](https://ramonda.pages.dev/reference/diagnostics#rmd055-a-hooks-props-passed-as-a-plain-object).

  **126 call sites moved** across this repository — 9 in the example apps, 95 in tests, the rest in
  documentation and JSDoc. Two comments went with them: both defended the object form with churn a
  callback would supposedly cause, and neither was true, since a bag that reads no signal is not
  rebuilt.

- 17aba74: A per-request slot is named by its key, not by a string written twice.

  `renderToString(vnode, { request })` took its pre-resolved values as `Map<string, unknown>` — a
  label the server writes, and the same label written again where the slot is declared, with nothing
  relating the two. It is now `Map<RequestKey<unknown>, unknown>`: the key itself.

  **Why a type and not a check.** Measured before the change: seeding `"currentUsr"` against a key
  declared `"currentUser"` renders `undefined` into the page **on the server**, silently. No
  diagnostic could have caught it either, and that is the interesting part — a read is legitimately
  allowed to find nothing, because an anonymous visitor has no user, so at runtime a typo and an
  absent value are the same event. The only place to refuse it is where the two spellings meet, and
  naming the key means there is only one.

  **`exposedLabels` is gone.** It was a module-level set that `requestKey` added to as a side effect,
  and the serializer consulted it when stamping the page — so what a page exposed depended on whether
  the module declaring the key had been **imported** yet. Measured: the same render with the same
  seeded value emitted no client blob before the declaration ran and a full one after, which is what a
  key declared in a lazily-loaded route would have hit. Exposure is read from the key now and kept on
  the request scope.

  Worth stating precisely, because the two are easy to confuse: what closes the lateness is the seed
  taking a **key**, not exposure moving off the registry. You cannot seed without holding the key, and
  holding it means `requestKey` has already run. The registry became unreachable rather than wrong,
  and was deleted because dead state is worth deleting.

  Migration is mechanical, and the compiler names every site:

  ```diff
  - values: new Map([["currentUser", user]]),
  + values: new Map([[currentUser, user] as const]),
  ```

  `seedRequest(key, value)` is unchanged and remains the door for anything resolved once the render is
  under way — it also ties each value's type to its own key, which a heterogeneous map cannot: the map
  checks that every entry IS a key, and stops there.

  Two tests came out of planting rather than out of writing. `seedRequest` had leaned on the same
  registry for exposure and had to start marking it itself — a regression this change introduced, that
  none of the 165 hydration tests caught. And the first test written for the lateness claimed to catch
  the old bug while passing either way, because the old bug is no longer reachable through the new
  door; it now asserts only the property that survives.

- 01d5913: A production build can now report three faults to a collector, where it previously reported nothing
  at all.

  Every `diagnose()` call is behind `if (__DEV__)`, so production emits nothing — which is right for
  most of what it catches. A mistake in code fires deterministically, on the first render, on the
  machine of whoever made it; shipping those would cost every app bytes to be told something
  development already said.

  Three are not like that. They need the world to go wrong, so they cannot be found before shipping,
  and until now nothing said a word about them afterwards either:

  - **RMD017** — a deferred hydration that never resumed. The server's markup is still on screen, so
    the page looks finished; the subtree has no listeners and answers nothing.
  - **RMD047** — `@memoizedHandler` with an argument it cannot key on. Development throws; a build
    whose affected path nobody ran rebuilds the handler on every render instead, and everything it is
    passed to re-renders with it, for the life of the page.
  - **RMD054** — a post-commit callback threw and the failure was swallowed. New code, production
    only: in development the same failure goes to the console with the error object, which is more
    than a record can carry.

  It is opt-in with nothing to configure. The record goes to `__RAMONDA_DIAGNOSTICS__` and nowhere
  else, so an app that installs no collector behaves exactly as before — including the cost: the
  stall watchdog is not even armed without one. The framework sends nothing anywhere; what leaves the
  process is the app's decision, made in the collector it wrote.

  The records carry what happened and not how to fix it — no `fix` prose, no `data`, no value from the
  app, and never the message of a thrown error. Nothing throws to deliver one.

  Production core grows 402 bytes gzipped (22,489 → 22,891), and `apps/docs`'s production-build
  tripwire now names these three as codes a production bundle may carry.

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

- 5b5f8ef: The panel says what each `@compute`'s cache actually did.

  A `@compute` is a claim that a value is worth caching, and the claim can be false in a way nothing
  else reports: the compute is invalidated by something that moves on every pass, so every read runs
  the body, tears the dependency set down and builds it again. The answer is correct, so nothing looks
  wrong.

  The components tab now carries a **Computed** section per instance:

  ```
  Computed
    total   never cached — ran on all 41 reads
    label   18 of 21 reads cached
  ```

  **A measurement, not a verdict, and that is the design rather than caution.** A compute that never
  hits may be perfectly reasonable — its dependencies may genuinely move every time, and a plain
  getter would be no cheaper. What is worth showing is the gap between "cache this" and "nothing was
  ever cached"; the person reading their own component is the one who can close it. The heading was
  nearly "Wasted computes", which is a verdict the panel is not entitled to make, and correct code
  would have been sitting under that word.

  RMD024 is the neighbouring check and stays where it is: it catches the strictly narrower case that
  IS a fault — recomputing to an equal value several times running. A compute that misses every time
  and returns something different every time is invisible to it, correct, and still paying for a cache
  it never uses.

  Per instance, not per class: two rows of one component are two different questions, and one of them
  never using its cache says nothing about the other. A compute nobody has read yet is left out
  entirely rather than shown as `0/0`, which would read like a finding about a compute that has simply
  not been asked for.

  **The production cost is two bytes, and getting there took a measurement worth recording.** The
  counters started as two fields on the compute's cache object: 16 bytes of production bundle and two
  hidden-class slots per compute per instance, for something no production build can read. Moving them
  to `const counters = __DEV__ ? { hits: 0, misses: 0 } : undefined` with a later `if (counters)` made
  it **worse** — esbuild folded the ternary but did not propagate the constant into the branch, so the
  counters and both increments shipped anyway. With `__DEV__` leading every guard the minifier sees
  `if (false)` and deletes the block: `misses` appears nowhere in the production bundle and the raw
  total moves 62160 → 62162.

  Also worth carrying, having now seen it three times: the gzipped total across separately-compressed
  chunks moves by ~100 bytes on a change worth 2, because the chunk boundaries shift. For a change
  this size the raw total is the honest measure.

### Patch Changes

- 9f7f425: A cast that names one property, and the three places `any` was only ever looseness.

  Counted first, over every published package's `src` with tests, comments and string literals
  excluded: **126 uses of `any`, 7 of them `as any`**. After this pass, **111 and zero** — every
  remaining one is a type annotation with a reason, and the reasons are now written beside them.

  What went:

  - **`State.get()` and the effect's mutation set** cast `this` to `any` to reach `State<any>`. Both
    were vestigial: `this` is a `State<T>` and `State<T>` is assignable to `State<any>`. Two casts
    deleted, nothing else changed.
  - **The props proxy** read `rawProps as any` twice. It is `Record<symbol, unknown>` for the symbol
    branch and `Record<string, unknown>` for the string one — the cast names the shape being indexed
    rather than opening the object.
  - **`@state`'s registration** wrote `this as any` to reach the framework's own `STATE_KEYS` symbol. It
    is `{ [STATE_KEYS]?: Set<string> }`, so the cast covers the one property it writes.
  - **`createRuntime(that: any)`** has exactly one call site, and it passes a component. It is
    `BaseComponent<any>`.
  - **`filterVirtualChild(rawChild: any)`** takes whatever JSX produced, which is `unknown` — the
    function's whole job is to narrow it. The number-and-friends branch returns `String(rawChild)`
    instead of reassigning the parameter.
  - **The devtools panel's three listeners** were `(e: any)`. `WindowEventMap` is augmented with the
    three channels core speaks on, so `e.detail` is typed at each one and the payloads are named in a
    single place. `DevLogPayload.data` and core's log entry are `unknown`: both are printed or rendered
    as JSON, never read into.
  - **`Object.entries(...).forEach(([key, val]: any) => …)`** annotated the pattern, so both halves
    were `any`. Removing the annotation types both from `_listeners`.

  What stays, each measured rather than assumed:

  - **A decorator's `value: (...args: any[]) => any`.** `unknown[]` type-checks across this entire
    repository — and would refuse the first user who wrote `@updated after(n: number)`, with TS1241,
    because a parameter is contravariant. Nothing here declares a parameter on such a method, which is
    why the repo-wide check is a false green. The note is in `decorators.ts` so the next pass does not
    repeat the experiment.
  - **`setNextOnenhancedNode`'s `value: any`.** It branches on what the attribute is — a `ref`, a
    listener, a string, a boolean — and hands each to a DOM API with its own type. `unknown` is 11
    narrowing casts, measured, which moves the looseness rather than removing it. Deleting it means
    making a vnode carry a discriminated attribute value, which is a redesign.
  - **`Record<string, any>` on JSX attributes** carries the whole surface a host element accepts.

  Behaviour is unchanged, and the one line that could have changed it is covered: breaking
  `filterVirtualChild`'s coercion branch on purpose fails **98 of core's 1107 tests**.

- b5ff5b3: A diagnostic compares to the end — RMD020, RMD022 and RMD027 stop reading a bound as a finding.

  `valueEqual` is bounded at a depth of two and at fifty entries of an array, and past either it
  answers "different". That is the right answer for `resolveStable`, which runs per declared prop per
  render and only has to CHOOSE a reference: a fresh one is correct, merely not optimal. Three
  diagnostics were reading that same answer as evidence, and each of them says something to an app.

  Two of them were saying it falsely:

  - **A JSX value in a props bag was reported as "does not come from state".** A two-level subtree —
    `() => ({ children: <div><h2 /></div> })`, which is what a `Portal` is handed — is past the depth,
    so RMD022 called two identical trees non-deterministic and put advice about `Math.random()`
    underneath. RMD020 did the same for an element attribute holding a nested object.
  - **RMD020's churn wording asserted contents it had not compared.** "Builds a new object with the
    same contents, hold it in a `@compute`" is the wrong sentence for a value that is genuinely not a
    function of state, and there is no run counter in front of RMD020 to soften it.

  And two were silent where they should have spoken, both once an array passed fifty entries — the
  width cap answers "different" without comparing a single element:

  - **RMD027 stopped reporting a stale wide array**: `rows` held in a plain field, reassigned with no
    signal write, is the shape its own documentation is written about, and a table with 51 rows was
    past the cap.
  - **RMD022 could not report a wide array that churned for real.** The cross-run gate needs the value
    to compare EQUAL across runs to count a run; the cap made that impossible, so neither half of the
    check could ever speak.

  `valueEqualThorough` is the entry point for a caller that reports — depth 24, width 1000, the same
  recursion. Measured per comparison: a two-level JSX tree **1.31 ns → 3.15 ns**, a sixty-row array
  **0.55 ns → 34.88 ns**, where the cheap answer was the cap bailing out without looking. It is paid in
  a development build, under the double render, on a pair already known to differ by reference.

  Five cases are pinned now, in `PropsStability.test.tsx` and `RenderStability.test.tsx`. The one that
  would have caught the JSX report is the plainest of them: mount a component with a JSX bag and assert
  nothing is reported.

  What a development build costs a props callback is measured rather than assumed, in
  `PropsBagRuns.test.tsx`'s second suite: with `strictRender` on — the default, and off in core's own
  test setup — a bag of constants is called **twice at mount** (RMD022's comparison) and **once per
  render of the owner** (RMD027's freshness probe), and every one of those results is discarded. The
  hook is handed one bag, and the functions in it keep one identity, in every build.

- 8908555: A predicate narrows; a `boolean` does not — which is why one probe was written seven ways.

  `vdom/h.ts` held a local whose only job was to hold a cast:

  ```ts
  const vnode = child as {
    type?: unknown;
    name?: unknown;
    attributes?: { key?: unknown };
  };
  ```

  Measured across the repository, non-test and non-dist: **76 `as { … }` casts, 42 of them bound to a
  local `const`**. About half are legitimate and stay — `globalThis as { CSS?… }`,
  `window as unknown as { __RAMONDA_INSPECT__ }`, `JSON.parse(raw) as { … }` are real boundaries with an
  untyped host on the other side.

  The rest were one fact spelled several ways, and the cause is worth naming: a helper that returns
  `boolean` answers the question and narrows nothing, so the caller casts on the very next line anyway.
  `isListLike` in `h.ts` and `isVNode` in `debug/renderStability.ts` were both that shape, and both had
  an anonymous `as { … }` sitting under them.

  `vdom/guards.ts` now holds the two predicates the vdom actually asks, as `value is ListNode` and
  `value is VNode`. It is a leaf on purpose: `isListNode` used to live in `core/DiffAndMerge.ts`, which
  imports `generateRenderOutput`, so half the callers could never have imported it back.

  - **Seven hand-rolled `IS_LIST` probes become one call** — `h.ts` ×2, `helpers/listEngine.ts`,
    `helpers/generateRenderOutput.ts`, `debug/renderStability.ts` ×2, `debug/lintChildren.ts`.
  - **A `@ts-ignore` in `normalizeChildren` is gone**, because the line under it was asking exactly what
    `isVNode` asks.
  - **Four byte-identical copies of `constructor?.name ?? "Unknown"`** — `hydration/serialize.ts`,
    `hydration/restore.ts`, `hydration/lint.ts`, `helpers/watchProps.ts` — plus three `this` casts in
    `base/decorators.ts`, become `displayName`. `base/Context.ts` keeps its own: there `undefined` is an
    answer the message branches on, and `"Unknown"` would change what RMD003 prints.
  - The two remaining `owner` casts say what they do — they defeat `readonly`, because stamping an
    owner is those two lines' job and nobody else's.

  Left alone deliberately: `isLazyList` asks a different question (a descriptor, not a built list) and
  was already a proper predicate; `debug/renderStability.ts` keeps a LOOSER local check, because it
  walks two arbitrary render outputs looking for instability rather than deciding what may reach the
  diff.

  Measured, because a shared guard is a function call in a hot path: 1000 children × 20 000 passes over
  a realistic mix of vnodes, lists and holes — the call is **0.80×–0.91× the inline probe** across five
  rounds, under half a nanosecond per probe and if anything in the guard's favour. Production bundle:
  raw **−58 bytes**, gzipped **+94** (22 450 → 22 544), the difference being chunk boundaries moving
  rather than code being added.

  Faults planted, and the second one is the reason this ships with a test. Loosening `isListNode` to
  "any object" fails **908 of core's 1066 tests**. Loosening `isVNode` to the "has a `type` and a
  `name`" spelling passed **all 1066** — nothing pinned the strictness at all, and a foreign object
  carrying two very ordinary field names would have been waved past RMD037 and into the diff.
  `src/__tests__/VNodeGuards.test.tsx` closes that, end to end as well as at the unit.

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

## 0.18.0

### Minor Changes

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

- c0e7552: `render` takes no decorator, and says so where the class is defined.

  `render` is the one member Ramonda reserves, and it was reserved only by TypeScript's `abstract` —
  a build with no types refused nothing. The two worst outcomes said nothing either. Measured, one
  class per decorator:

  - **`@compute get render()`** turns the method into a cached property, so the framework's
    `component.render()` dies with `TypeError: component.render is not a function` — before a page
    appears, out of the framework, with no diagnostic at all.
  - **`@memoizedHandler render()`** is worse, because it does not throw. The render is memoised on
    arguments it does not have, and the component **never updates again**: measured `"0" -> "0"`
    after a state write that should have shown `1`. A frozen page, in silence.
  - `@created`, `@mounted`, `@updated` and `@destroyed` register the render as a lifecycle callback,
    so it runs outside the render pass as well as inside it.
  - `@catchError` makes the render the handler for errors thrown by its own subtree.
  - `@state` and `@persist` mean "serialise me", which a render is not.

  **TypeScript catches exactly one of these, and it is the wrong one.** A getter cannot override a
  method, so `@compute get render()` is refused by the type system — and that is the case that throws
  loudly anyway. `@memoizedHandler render()`, which freezes the page in silence, type-checks
  perfectly.

  None of those is a shade of wrong, so the rule is total rather than a list: no decorator goes on
  `render`. The check sits in the three shared asserts every member decorator already calls, so it
  covers all eleven of them and any that arrive later — and it is DEV-only, like the rest of that
  file, because a decorator is fixed at the source and the cheapest moment to refuse it is the moment
  the class is defined.

  Put the behaviour on a member of its own and call it from `render`.

### Patch Changes

- bc85ac6: `Head` gives back a tag the page author wrote, instead of deleting it.

  The registry adopts a matching element rather than adding a second one beside it — which is right,
  and the reason a page whose `index.html` already has a `<meta name="description">` does not end up
  with two. But it then **removed** that element when no page asked for it any more, whether it had
  created it or merely borrowed it. The author's tag was gone from the document for good.

  `title` never did this: the registry captures `originalTitle` when it is made and puts it back. The
  tags simply never got the same treatment, which is what makes this a fault rather than a design —
  measured, a `<title>` came back as `from index.html` while the description beside it was gone.

  An element is the author's when it does **not** already carry Ramonda's marker. One that does was
  written by this framework on the server and adopted on hydration — the marker is how `collectHead`
  found it to serialize — so it belongs to the page and still goes when the page does. Two hydration
  tests say exactly that, and they were right; what was wrong was that one of them stripped the marker
  its own server render emits.

## 0.17.2

### Patch Changes

- f373d7c: `Head` stops republishing on renders that changed nothing it owns.

  `meta` and `link` arrive as fresh array literals every time a call site's callback is evaluated,
  and every prop is a signal comparing by reference. So the head re-applied on every render of
  whatever mounted it — correct output, rebuilt for no reason.

  The watcher had been hiding this behind a serialized selector:

  ```ts
  @watchProp((props) => JSON.stringify([props.title, props.description, props.meta, props.link]))
  ```

  That worked, and it put the comparison in the wrong place. `Head` now declares the two arrays
  values, which is what `@StableProps` is for, and the watcher takes one selector per option:

  ```ts
  @StableProps("meta", "link")
  export class Head extends Hook<HeadOptions> { … }

  @watchProp((p) => p.title, (p) => p.description, (p) => p.meta, (p) => p.link)
  ```

  Measured over five re-renders with identical contents: the serialized selector fired 0 times, plain
  selectors fired 5, and plain selectors with `@StableProps` fire 0. The declaration reaches every
  consumer of those props rather than this one watcher — a `@compute` reading `props.meta` stops
  recomputing too — and `previous[i] === next[i]` now says WHICH option moved, which a single
  serialized value could not.

  A test pins the behaviour by counting mutations to `document.head`, because the alternative is
  silent: remove the declaration and every other test still passes.

- ccb7629: A prerendered page keeps its named portal targets, and a hand-assembled shell can place them.

  `Portal`'s plan was that a portalled subtree should be indistinguishable from a normally mounted
  one — full SSR into any named target, state restored on hydration, `list()` working inside it.
  Every part of that had unit tests and **not one application used it**, in this repository or in the
  docs site. Rendering one through a real build found two holes, both silent:

  **`renderStatic` dropped `portals`.** `renderPage` returns them; the build-time render that bakes a
  static page did not, and did not reset its containers before rendering either. A prerendered page
  therefore lost every named portal block — the file looked correct, and the client built the subtree
  a SECOND time on hydration because there was no container to adopt. Only a real static build could
  show it.

  **A hand-assembled shell had nowhere to put them.** `renderDocument` emits a container per target,
  but an app that writes its own shell — which the SSR template and this repository's playground both
  do — had no supported way to. `fillDocument` now takes `portals` and fills a `<!--portals-->` marker:

  ```js
  res.end(fillDocument({ template, html, title, head, portals }));
  ```

  ```html
  <div id="app"><!--ssr--></div>
  <!--portals-->
  ```

  A shell with blocks to place and no marker **throws**, naming the targets. That is the one missing
  marker not returned quietly: a missing `<!--ssr-->` gives a page with no app in it, which announces
  itself, while a dropped portal gives a page that looks perfect and then duplicates a modal in the
  browser.

  The markup matches `renderDocument` exactly — same attribute, same escaping, same position after
  the app root — because the two disagreeing is itself a way to make hydration rebuild.

  **A scaffolded SSR project ships the head it renders, and has somewhere to put a portal.**

  It rendered with `renderToString`, which hands back the body and nothing else — no title, no meta,
  no portal blocks. A generated project that added a `<Head>` therefore shipped pages with **no title
  and no description**, invisible to exactly the crawlers server rendering exists for. Measured on a
  scaffolded project, not inferred. It now renders with `renderPage`, and the shell carries
  `<!--head-->` and `<!--portals-->`.

  The portals marker is there before anything uses one, on purpose: `fillDocument` refuses a render
  that collected blocks with no marker, so without it the first `<Portal target={portalTarget(…)}>`
  someone writes breaks their build, and the fix is one line in a file they had no reason to open.

  Its ISR entries now cache the **whole document** rather than the body. Filling the shell at send
  time works until the shell changes under a cached page — and with a head collected per page, the
  head is what goes stale first: one page's cached entry served with another's title.

  `fillDocument` also stops taking an EMPTY title literally. `renderPage` returns `""` when no `Head`
  set one, which is a report of absence; writing it emptied the shell's own `<title>`, and a
  scaffolded project shipped `<title></title>`. Found by building one.

  **A finished `renderPage` no longer leaves a page's portal containers standing.** It resets the head
  in its `finally` for a stated reason — keeping a long-lived server from carrying one request's tags
  into the next — and portals were missing it, though they hold whole DOM subtrees rather than a few
  tags. Measured: a container still held the last page's markup after the call returned, while
  `renderStatic` cleared both.

## 0.17.1

### Patch Changes

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

## 0.17.0

### Minor Changes

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

- 5c54de8: `RMD052` — a component among JSX children, where an element was meant.

  `{Panel}` names the class instead of rendering it. It is not markup, so it is dropped and the page
  comes up without it — and until now nothing said so: the check beside it looks for an OBJECT among
  children, and a class is a function, so it fell through with the strings and numbers. Measured before
  the code was written: the component simply never appears, and no record is emitted.

  Only reported, never replaced. A function child already renders nothing, so putting a hole there
  instead would change no page — the report is what was missing.

  Handing a component to something else is an attribute rather than a child: `<Slot view={Panel} />`
  passes it as a prop, which is a different thing entirely.

  `ramonda-check` reports the same mistake from the source, before anything renders.

### Patch Changes

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

## 0.16.0

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

## 0.15.0

### Minor Changes

- f7dc629: A refetch updates its rows instead of destroying and rebuilding them.

  Data from outside — a refetch, a `JSON.parse`, anything round-tripped through the network — hands over fresh objects meaning the same rows, so matching by reference found none of them and every row was destroyed and built again: `@destroyed`, `@created`, and whatever each row's component was holding. Measured on a two-row list where one title changed: both rows recreated and a half-typed draft lost. `key: (item) => item.id` existed for this.

  `list()` now aligns the incoming array against the one it is showing and carries each row's identity across, so a row that changed keeps its DOM node, its component instance and its state. Rows equal by content are the anchors; rows between two anchors are paired by how much they still have in common. No field is privileged — an `id` counts for exactly as much as any other, because a framework cannot know which field is an identity.

  Two arrays with nothing in common have no anchors and share nothing, so page 2 of a table never inherits page 1's rows. A `{ ...row }` copy is a new row: identity is a non-enumerable symbol, invisible to spread, `JSON.stringify` and every equality check. A frozen row keeps matching by reference.

  This changes what a replaced row object costs. It used to reset that row's state; it now carries it, and `key` is no longer needed for re-created objects.

- f478b92: `list()` uses the key you write, and its callback no longer takes an index.

  Which row is which is now answered in three steps, and the first two are exact. **The object** — while a row is the same object it is the same row, which covers every update that keeps its references. **Your key** — the moment an object is new (a refetch, a `for`/`push` in a `@compute`) the object cannot answer, and a `key` on the vnode is what still can. **A guess** — with no key and a new object, the incoming array is aligned against the one on screen by what the rows still have in common.

  A key used to be accepted and then silently overwritten with the list's own id. It is now left exactly as written, and the list fills one in only when there is none, so a list that declares nothing behaves as it did.

  Two rows under one key are reported (`RMD002`). The same OBJECT twice is not a collision — those rows are told apart by which occurrence they are, as always.

  **Breaking.** The second argument is always a function; passing a component class directly is gone, because that form leaves nowhere to put a key. And the callback takes the item alone — no index. A row that shows its position had to be rebuilt whenever it moved, and an index is the one thing that must never become a row's identity. Resolve the position where the data is built instead.

  ```diff
  -list(this.rows, TaskRow)
  +list(this.rows, (task) => <TaskRow key={task.id} item={task} />)

  -list(this.cells, (cell, index) => <td data-label={labels[index]}>{cell}</td>)
  +// pair the label with the cell in a @compute, then
  +list(this.labelled, (at) => <td data-label={at.label}>{at.cell}</td>)
  ```

- 3176268: `list()` works wherever a hook consumes renderable children, not only in a render slot.

  A `list()` handed to a hook — `this.use(Portal, () => ({ children: list({ each, as }), target }))` — used to crash: the descriptor fell into the diff's component branch with no `.name`. It now goes through the real region reconcile, so it gets what a list in `render()` gets: minted identity, per-item reactive scopes, the whole-list skip, and the LIS reorder.

  The mechanism is a new internal `ChildrenRegion` — a contiguous block of children owned by something other than an element's render, with a record of its own and a trailing anchor so it can share a target with the shell's content and with other portals. `Portal` is rewritten on top of it and no longer hand-rolls a reconcile.

- 1d65b53: `list()` takes two arguments, and `key` is gone.

  ```diff
  -list({ each: this.todo, as: TaskRow })
  +list(this.todo, TaskRow)

  -list({ each: this.rows, render: (r) => <li>{r.t}</li> })
  +list(this.rows, (r) => <li>{r.t}</li>)

  -list({ each: this.users, key: (u) => u.id, as: UserRow })
  +list(this.users, UserRow)
  ```

  The options bag had one field left worth having. `key` stopped covering anything when identity started being carried on the item — a refetch keeps its rows without one — and `as` and `render` were always mutually exclusive, which is a shape that can be written wrong. Two positional arguments cannot be: the items, and the one way to turn an item into markup.

  The second argument is a component or a function, and nothing has to declare which. A class has a construct signature and no call signature, an arrow the reverse, so the two overloads are mutually exclusive with no union; at runtime the class is recognised by the `__isComponent` static that `Component` already carried.

  `RMD014` (both given, or neither) is retired — neither mistake is expressible. `ListOptions` is replaced by `Each`, `ItemRender` and `ItemComponent`.

  Also fixed: minted ids now come from the process-wide counter rather than a per-list one. A per-list counter was safe while an id never left its region; identity travels with the item now, so the same object shown in a second list carried an id that list had already minted for a different row.

- 7879405: `merge()` — structural sharing, and the one place an app can say which row is which.

  `list()` infers identity, and for the shapes real data takes it is right. But it is inference, and there was no way to tell it otherwise. `merge` is that way, and it sits at the data boundary rather than on the list — said once, where the rows arrive, instead of on every list that renders them.

  ```ts
  this.rows = merge(this.rows, await api.getRows()); // shares what did not change
  this.rows = merge(this.rows, await api.getRows(), (r) => r.id); // and pairs rows across a reorder or a resize
  ```

  With an identity, an unchanged row comes back as the same object wherever it moved to, and a changed row carries its predecessor's identity so it updates in place instead of being rebuilt. Without one, a refetch that changed nothing is not a change at all.

  `@ramonda/query` has done the structural-sharing half on every fetch for a while; it now uses this implementation, so an app gets the same function with the same bounds whether its data came through a query or not.

  **Also fixed:** a frozen row kept no identity. `Object.defineProperty` throws on a frozen object, so a refetch of frozen rows rebuilt every one of them — measured, changed or not. The write falls back to a WeakMap, so freezing your data no longer costs you row identity.

- 5d0c694: A portalled subtree survives a re-render, and a component inside a portal restores its server state.

  **Fixed:** a `Portal` marked its own tags with a `data-ramonda-portal` attribute, and the server emitted whatever carried it. An attribute cannot survive on a node the reconciler owns — the attribute diff reads a node's current attributes as the previous set and removes whatever the next vnode does not have — so the first re-render of anything in a portal's block erased the marker and the tag left the page silently. Any state write did it. A portal's block is now delimited by comment anchors, which no attribute pass can reach.

  **Served markup changes** for portals: `<!--r7-->…<!--/r7-->` around the block instead of `data-ramonda-portal` on each tag. `Head` is unaffected — it builds its own tags outside the reconciler and keeps the attribute.

  **New:** hydrating a portal runs the ordinary `hydrateLevel` walk over its block, so a component inside a portal is hydrated rather than rebuilt — its server state is restored, its host adopted. Server state blobs are now stamped inside portal blocks too; they only ever covered the body container.

- e9b5620: A portal can server-render into any target, not only `document.head`.

  `document.head` worked because the server's document has one. Every other container — a modal root in the body — does not exist during a server render: the shell is assembled after the render returns, so there is no element to point at. Those portals were client-only, and a component inside one was rebuilt rather than restored.

  `portalTarget("name")` names a target instead of pointing at it. The server collects that target's content into a container of its own and returns it on `page.portals`, keyed by name; `renderDocument` emits a container per entry after the app root, and a hand-rolled shell can place them itself using the exported `PORTAL_TARGET_ATTR`. On the client the name resolves to that container and the block inside it is adopted, anchors and all — so a component in it restores its server state. With no server render, the container is created on demand.

  A token rather than a selector string: a selector is a claim about markup the portal does not own, and it fails silently when the shell changes.

  `RenderedPage` gains `portals: Record<string, string>`.

- 928f63d: `.map()` is no longer discouraged — `RMD023` asks for a key instead.

  It used to say "use `list()` instead", and only for components, on the reasoning that plain markup survives being matched by position because the diff patches the text. That is true of the text and false of everything else on the element: an `<input>` inside a plain `<li>` holds a caret, a selection and whatever the user typed, and those follow the node.

  So a `.map()` is a supported way to render a list, and what it needs is the thing every framework asks for here. `RMD023` now asks for a key, for any element, and mentions `list()` as the lazier shape rather than the required one. It drops from `error` to `warning`.

  What a missing key costs is only which row _inside_ the array is which — rows built from an array cannot be confused with the siblings around them, keyed or not, because every array in JSX becomes its own group with its own key space.

- c1c2cf1: `RMD051` reports a list row that nothing can tell apart from its siblings.

  `list()` identifies a row by what sets it apart, so a row replaced by fresh objects is recognised and updated rather than rebuilt. A row whose every field is either nested (compared, never counted) or a value its siblings share — `{ tags: [...] }`, or rows carrying nothing but flags — cannot be identified by anything, so it is rebuilt on every replacement and whatever its component held goes with it.

  It does not fire for a row that is simply new: page 2 of a table is unpaired too, and warning about that would put a report on correct code. The question asked is about the row — could anything ever have identified it — not about whether it was matched.

  The fix is a field of the row's own, or `merge(previous, incoming, (row) => row.id)` where the data arrives.

### Patch Changes

- fedc99f: A lens write keeps hidden symbols across an edit, and `set` takes an option.

  `list()` recognises a row by the object it holds. Every immutable update replaces that object, so the row was torn down and built again — taking whatever its component was holding with it: a half-typed input, an open menu, a scroll position.

  Anything looking at the result afterwards has to GUESS which new object is which old row. A lens write does not have to: at the moment it replaces a value it is holding both versions, so the answer is known. It now carries the value's non-enumerable symbols onto the copy, and `focusOn(rows).at(0).merge({ done: true })` keeps that row's component exactly as it was.

  `set` is the exception. It is handed a value rather than deriving one, so `set(edited)` and `set(aDifferentRow)` are the same call, and carrying would give a different row the open editor of the row it replaced. It keeps nothing unless told:

  ```ts
  focusOn(items).at(0).set(other); // a different value
  focusOn(items).at(0).set(rebuilt, { keepSymbols: true }); // the same one, rebuilt
  focusOn(items)
    .at(0)
    .set(rebuilt, { keepSymbols: [MINE] }); // only this one
  ```

  The lens knows nothing about what the symbols mean — `keepSymbols` is generic, and `merge`, `update` and a write aimed deeper all keep automatically because they derive. Core exports `SAME_ITEM` as the ready-made option, so an app never has to name the symbol behind it:

  ```ts
  this.rows = focusOn(this.rows).at(0).set(fromTheForm, SAME_ITEM);
  ```

  `1.33 KB → 1.50 KB` gzipped.

- 00924fe: Reaching for a `list()` as if it were an array now says what it is.

  `list(items, (item) => …)` reads exactly like `items.map((item) => …)`, and the one thing that differs is the thing you cannot see: it does not iterate there. Nothing has run when it returns — the callback is called by the framework while it reconciles the rows, which is what makes a list whose array did not change cost nothing.

  Anyone expecting an array met `undefined`, `is not a function` and `is not iterable`, none of which say what happened. TypeScript refuses all three, so getting there means the types were bypassed; development now throws with an explanation and points at the two things that are right — render it, or use `.map()` if what you want is an array of values.

  The docs say the same thing up front, since the shared shape makes the difference easy to miss.

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
