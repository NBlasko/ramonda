# @ramonda/core

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
  child→parent while `@create` runs parent→child, so an effect handed a nested route's title
  back to its layout on the first commit. A `@watchProp` runs in the same order as `@create`
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

  `@mount` runs once, with the element in the document. `@updated` runs after every commit after that, and it is the only way an app can read or correct its own committed DOM: updates are batched through a microtask, so the DOM is not touched yet when the handler that changed state returns — and not every update has a write site of yours to stand in (a parent re-renders you with new props, a context value changes, a hook you use writes its state).

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
  - Cleanup is `@destroy`'s; a subscription is `createSubscriptionDecorator`'s.

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

- 7b530bb: `@create`, `@mount` and `@destroy` now receive the render side as an argument.

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
