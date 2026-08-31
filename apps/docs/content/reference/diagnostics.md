---
title: Diagnostics
description: Every diagnostic — RMD from the core, RMQ from the query cache, RMF from forms, RML from immutable updates — what it means, what causes it, and what to do instead.
section: Reference
order: 110
---

# Diagnostics

Ramonda reports the common mistakes below at runtime, in development only. Every message is wrapped
in `if (__DEV__)`, so a production build ships none of them. Nearly every *check* is stripped with
its message; the exception is named where it applies (`RML009`), because a guard that ran only in
development would protect the one build that was never exposed to a request.

**They exist because these mistakes are silent.** Almost every bug this framework has had produced
a *wrong result* rather than an error: state landing on the wrong row, a click doing nothing, a
subtree rendering into nodes nobody can see. None of them threw. A diagnostic is the framework
saying the thing a stack trace never would.

Most are deduplicated by cause, so a mistake in a list of a thousand rows is reported once. Whether
to dedupe is the reporting package's call, and it follows from what the fault depends on: a core
diagnostic fires from the render path for a fixed piece of code, so the second report carries nothing
new, while an `RML` miss depends on the data — the same line can miss for one record and land for the
next, and collapsing those would hide the case that matters.

**Error or warning says what is at stake, not how bad the code looks.** An **error** means the end
result is wrong — something renders the wrong thing, loses state, never becomes interactive, or
hands you a value that is not what you asked for; the devtools panel raises its alert for these. A
**warning** means the result is the same and the app just did more work to get there: a wasted
render, a refetch, a listener re-attached.

**The prefix says which package reported it**: `RMD` is `@ramonda/core`, `RMQ` is `@ramonda/query`,
`RMF` is `@ramonda/form`, `RML` is `@ramonda/lens`. They are listed apart below, because a reader who
hits `RMQ001` wants the query codes together and not one of them wedged between two core ones.

A code is stable forever and never reused. When a check is removed, its section stays and says
`retired` — a reader who hits an old message in an old build still lands somewhere.

---

## Capturing them

A diagnostic is also a **record**, so a devtools panel, a test, or a log collector can group and filter
reports instead of parsing prose. A collector installs one function, and a reporting package finds it
with no dependency on anything:

Every prefix arrives this way — `RMD`, `RML`, `RMQ` and `RMF`.

```ts
interface RamondaDiagnostic {
  /** Stable forever. The prefix says which package raised it. */
  code: string;
  /** Who emitted it — `"ramonda/lens"`. OpenTelemetry calls this `InstrumentationScope.name`. */
  scope: string;
  /** Mapping to OpenTelemetry SeverityNumber 5 · 9 · 13 · 17. */
  severity: "debug" | "info" | "warn" | "error";
  /** One sentence, human first. Interpolated values are fine — grouping is by `code`. */
  message: string;
  /** What to do instead. Always present for an `error`. */
  fix?: string;
  /** The values the message interpolated, structured. What a collector queries. */
  data?: Record<string, unknown>;
  /** Epoch millis. Sortable, comparable, locale-free. */
  time: number;
  /** Identifies the SOURCE of a fault. Absent means "never deduplicate this". */
  dedupKey?: string;
}

declare global {
  var __RAMONDA_DIAGNOSTICS__: ((record: RamondaDiagnostic) => void) | undefined;
}

globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => {
  if (record.severity === "error") myCollector.alert(record);
};
```

**If you have `@ramonda/devtools`, subscribe instead of assigning.** The sink is one function, so an
assignment replaces whoever was there — which is normally the panel's own bridge, and it then quietly
stops filling. `installDiagnostics` shares one sink between any number of subscribers and hands back
the uninstall:

```tsx
import { installDiagnostics } from "@ramonda/devtools";

const stop = installDiagnostics((record) => myCollector.alert(record));
```

A subscriber sees every prefix. The panel's `LOGS` tab is the one place that differs: `RMD` rows reach
it through core's own log channel, so the bridge does not carry them there a second time.

The assignment above is the protocol-level form, for a package that will not take a dependency to
report a warning. Write it when that is the situation, and chain what was already there:

```ts
const previous = globalThis.__RAMONDA_DIAGNOSTICS__;
globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => {
  previous?.(record);
  myCollector.alert(record);
};
```

Four rules make it work across packages that share no code:

- **`globalThis`, not an event on `window`.** The same line runs in the browser, in Node, in a worker
  and during a server render. A reporting package needs no dependency and no DOM.
- **A collector is optional.** With nothing installed, the call is one property read and the message
  still goes to the console. Installing a sink adds a consumer; it does not silence the console.
- **Read tolerantly.** Ignore fields you do not know, and assume only `code`, `scope`, `severity`,
  `message` and `time`. That is what lets the record grow without a version on every one of them.
- **`data` holds values, not live objects.** A collector keeps a bounded history, and a record holding
  a component or a DOM node would keep it alive for as long as that history does.

The field names line up with OpenTelemetry's log data model, so bridging to a collector is a rename
rather than a redesign. Anything can emit into this channel — the contract is the shape above and the
name of the sink, not a package to depend on.

On the server the sink is process-wide, so a collector sees every concurrent request at once; there
is no per-request attribution in the record.

---

# Core — `RMD`

## RMD001 — State written during `render()`

`render()` must be a function of state, not a place that changes it. A write there schedules
another render from inside the render that caused it.

Move it to [`@created`](/concepts/lifecycle) if it is initialisation, or to an event handler if it
is a response to something. If it is a value derived from other state, that is
[`@compute`](/concepts/compute).

## RMD002 — Duplicate key in a child list

Two siblings claiming the same identity. The diff will match one of them to the wrong node, and
the symptom is state appearing on the wrong row.

The real fix is usually to stop writing keys: [`list()`](/lists) derives identity from the items
themselves and cannot collide.

## RMD003 — Context consumed without a provider above it

The consumer fell back to the default declared in `createContext`. Reported when the component
**mounts**, before anything has read a value — so a panel behind a condition nobody has clicked
still says so, and the report names the component the provider has to go above.

Either add that provider, or — if the default really is the answer when nobody provides one —
declare the context `optional`. See [Context](/composition/context).

## RMD004 — Props mutated by the receiving component

Props belong to the parent. The assignment **throws**, in every build. Swallowing it instead lets
the mistake hide: you read the value back, get the old one, and have nothing telling you the write
was dropped.

Copy it into `@state`, or take a callback prop and ask the parent to change it. See
[Props](/concepts/props).

## RMD005 — Array in state mutated in place

`this.items.push(x)` does not re-render: the signal compares values, and the array you pushed into
is the same array.

Replace it: `this.items = [...this.items, x]`.

An object changed in place is the same fault and is reported as
[RMD048](#rmd048-object-in-state-changed-in-place).

## RMD006 — Timer still running after unmount

A `setInterval` or `setTimeout` outlived its component, so it will fire into something that no
longer exists.

Use [`@interval` / `@timeout`](/concepts/timers) for a clock that starts at mount, or the `Timeout`
and `Interval` hooks for one the component starts itself:

```tsx
private t = this.use(Timeout, () => ({ run: this.done }));
// this.t.start(ms), and this.t.stop() to end it early
```

Both clear themselves on teardown, so there is no id to keep.

## RMD007 — Server and client rendered different output

Hydration found the client rendering something other than what the server sent, so nodes were
replaced instead of adopted.

Usually a value that differs by nature (`Date`, `Math.random`), a browser-only API read during a
render, or a branch on the environment inside `render()`. See
[hydration mismatches](/ssr/mismatches) for the two-pass pattern that fixes it.

## RMD008 — State changed after the component was unmounted

A fetch that resolved after the user navigated away, most often. The update is **dropped** — in
production too, not only in development — so it cannot render into a detached tree.

Cancel the work in `@destroyed`, or check before writing.

## RMD009 — Update loop

A component kept re-rendering without settling. Two `@updated` methods writing what the other reads
is the usual cause; a write inside `render()` is the other.

The guard **stops** it rather than only reporting it, because a synchronous loop freezes the tab.
Production has a blunter version of the same stop that throws — a frozen tab is a worse outcome
than an error, and leaves nothing to debug.

### What a runaway does in production

Two counters, and they are the only errors the framework raises in a production build that can take a
page down. Both are deliberate: the alternative is a tab that stops responding.

| | what it counts | when it throws |
| --- | --- | --- |
| `MAX_BUILDS_PER_DRAIN` | components rebuilt in one drain | 100 000 |
| `MAX_WORK_PER_FLUSH` | `@mount` callbacks in one flush | 100 000 |

The message names the last component in the loop, which is where to look first, though the cause may
be any component it updates. Neither is reachable by an app that settles: a hundred thousand builds
in a single tick is a loop, not a busy page. In development this code is reported by name long before
either counter is approached.

Note that a *single* effect writing what it reads does **not** loop: the framework detaches a
signal an effect mutated itself. See [Subscriptions](/concepts/subscriptions).

## RMD011 — A function was used as a JSX tag

A function has nothing to construct, no state and no lifecycle, so as a tag it names nothing the
framework can keep hold of. TypeScript rejects it; this fires when the build has no types.

For markup you reuse, call the function in an expression slot — `{sideBar()}` — where it reads as
the value it is. For state and lifecycle with no markup, use a [Hook](/hooks). For both, make it a
component: a component owns whatever its render returns, including nothing at all.

## RMD012 — retired

Superseded by `list()`, which prevents the problem structurally rather than reporting it.

## RMD013 — A list item produced nothing

The render callback returned nothing for an item. A callback that returned something
which is not an element is [RMD031](#rmd031-a-list-item-that-is-not-an-element)
instead.

Give it something to render for that item, or filter the item out of the array before
it gets there. See [lists](/lists).

## RMD014 — retired

`list()` took an options bag with `as` and `render` in it, and this fired when both or
neither was given. The bag is gone: the second argument is the component or the
function, so neither mistake can be written.

## RMD015 — A hook's props assigned by the hook that received them

A hook's props belong to whoever called `this.use(...)`. The assignment **throws**, exactly like a
write to a component's props (RMD004) — one rule for read-only inputs, not two.

See [writing a hook](/hooks/writing).

## RMD016 — A component updated while its element is not in the document

Something removed the component's DOM without telling the framework, so it is still mounted: its
timers still fire, its listeners are still attached, and every render goes into nodes nobody can
see.

Ramonda's own removals are safe. This comes from outside — a `ref` handed to a library that
replaces the node, an app embedded in a page whose host removed the mount point, a hand-written
`innerHTML`. Call `unmount(container)` before the DOM goes away.

If the tree is detached **on purpose** and will be re-inserted, this is expected.

## RMD017 — A deferred hydration never resumed

A component returned a promise from [`@deferHydration`](/ssr/async), so the client adopted the
server's markup and left the subtree untouched, waiting. The promise never settled.

The page therefore **looks** finished — the content is on screen, correct and complete — but
nothing in that subtree responds. Usually a dynamic import that neither resolves nor rejects: a
chunk removed by a deploy, a request that hangs.

Make the promise settle. A rejected promise still releases the subtree; only one that never
settles leaves it frozen.

## RMD018 — State written during a `@compute`

A [`@compute`](/concepts/compute) derives a value and returns it. Writing reactive state while it
derives is worse than the same write in `render()` ([RMD001](#rmd001-state-written-during-render)):
if the compute reads the signal it wrote, it invalidates its own cache and recomputes forever; if
it reads another, every read of the compute now fires that signal's listeners too, re-rendering
whatever only wanted a derived value.

To **produce** a value, return it. To **cause** an effect, use an event handler or
[a subscription](/concepts/subscriptions). To **count runs** or otherwise instrument the compute, use a plain
(non-`@state`) field — render re-runs on the same changes and reads its latest value.

## RMD019 — State set to a value that cannot be serialized

`@state` travels to the client in the hydration blob as JSON, so it can only hold JSON-serializable
data. Assigning a **function**, a **symbol**, or a **bigint** to a `@state` field is flagged the
moment it happens — at the field initializer (`@state x = …`) or a later write — because JSON has no
way to carry it: a function and a symbol are dropped silently, a bigint makes serialization throw.
Either way the client would come alive with that field missing.

```tsx expect-report
@state onPick = () => {};   // ✗ a function — not serializable
@state total = 42n;         // ✗ a bigint
```

Keep behaviour off state: a function is a **method** on the class, or a **prop** passed in (props
are not serialized — the parent re-supplies them on the client). A symbol or bigint should be a
string or number in state. And if the field is genuinely client-only and never meant to travel, it
should be a plain field, not `@state`. Deeper cases — a `Map`, a `Date`, a circular object — are
caught by the server renderer when it serializes, rather than at the write.

---

## RMD020 — `render()` produced a different value the second time

A development build renders **every component twice** and compares the two outputs. Two calls in the
same tick, with no state change between them, must produce the same values — so anything that
differs was built by the render itself, or does not come from state at all.

That is what makes this precise: comparing against the *previous* render cannot tell a value that
was created in place from one that genuinely changed. Two calls in one tick can.

Four things get reported, each with its own fix.

**A function built in place.** The source is identical between the two calls, only the identity is
fresh. That is not just an allocation: an event handler whose identity changed is removed and re-added
on the element on every render, and a function passed to a child re-renders that child.

```tsx
<button onclick={() => this.save()}>   // ✗ a new function every render
<button onclick={this.save}>           // ✓ a bound method
```

For a handler that must be built per item, [`@memoized`](/concepts/events) caches it by its
arguments, per instance — so the second render hands back the same function and nothing is reported.

[`ramonda-check`](/reference/check) reports the same thing from the source, as
`function-built-in-the-markup`, so a handler on a page nobody has opened is found before anything
runs. It makes the same two exceptions this does: a `@memoized` call, and a prop the child declared
with `@StableProps`.

**An object or array built in place**, with the same contents. A child receiving it re-renders every
time, a [`@compute`](/concepts/compute) reading it recomputes every time, and if it is a
[list's](/lists) items then every row loses its identity and the whole list is rebuilt — per-item
state lost, `@destroyed` and `@created` run again.

```tsx
<Chart config={{ smooth: true }} />    // ✗ rebuilt every render
@compute get config() { … }            // ✓ recomputed only when its inputs change
```

If the two are **not** the same, the check walks *into* them — an object by key, an array by index — so
a function inside somebody's config is reported as the function it is, at the place it sits:

```tsx
<Table cfg={{ rows: 10, onRow: () => this.pick() }} />        // reported as `cfg.onRow`
<Table cols={[{ key: "name", render: () => this.cell() }]} /> // reported as `cols[0].render`
```

A bag whose *shape* disagrees between the two calls — a different set of keys, a different length — is
not a rebuild at all, so that is reported as the last case instead.

**An object with a prototype, constructed in place** — a `Date`, a `Map`, a `Set`, a class instance. The
consequence is the same as a plain object's, and so is the fix: construct it once and keep it in a field,
a `@compute`, or a module constant.

```tsx
<Row at={new Date()} />     // ✗ a new Date every render
readonly at = new Date();   // ✓ constructed once, with the component
<Row at={this.at} />
```

The report says the object is **fresh**, not that its contents matched, because they are not read: the
comparison walks own enumerable keys and a `Map`'s entries are not those. And a `class` written inside a
render is a *different* constructor every time, so its instances are reported as the next case instead.

**A value that does not come from state** — `Math.random()`, `performance.now()`. Decide the value once
in `@created` and keep it in `@state`. A render that produces two different *kinds* of value in one tick
lands here too — two prototypes that disagree is not a rebuild.

Only the part of that class which varies **within a tick**, though: the two renders are microseconds
apart, so a millisecond clock reads the same both times. Measured over 200,000 tries, two consecutive
`Date.now()` calls differ in 0.006% of them. `Date.now()` is caught by
[RMD007](#rmd007-server-and-client-rendered-different-output) instead — a server render and its
hydration are milliseconds to seconds apart. The two checks cover the class between them; neither
covers it alone.

**A CACHED render is noted, not reported.** `@compute` and `@memoized` are allowed on `render`, and a
cached render hands back one answer for both calls — so an inline handler, a rebuilt object and a
non-deterministic read go unreported in the render itself. Caching a render is a deliberate choice, so this
is not a warning and carries no code: it is one `info` line, once per component, saying what the check can no
longer see. A `list()` row is the exception and keeps its cover, because the list builds each row twice on
its own — measured, an inline row handler is still reported under a cached render.

```tsx
@compute
render() { … }   // an info line: RMD020 cannot see inside this component any more
```

The note names a second cost too: a cached render refreshes only when a **signal** it read moves, so
anything else it reads keeps its old value — measured, a plain field left the old text on screen where an
uncached render showed the new one. To keep the check, cache the expensive **data** in a `@compute` and read
it from an ordinary `render`.

It is asked of the decorator, not of the output, and that is deliberate: `render() { return
this.props.children }` and `render() { return A_CONSTANT }` also hand back one object, and neither hides
anything. A `@compute` body returned from `render` has the same cost and is **not** noted, for the same
reason — nothing distinguishes it from those two.

**Where it reaches, and the one place it cannot.** Every row of a `.map()`, a `filter` or an array
literal is compared — those rows are built by the render, so both renders have them, and each row is
checked in full rather than sharing one budget with its neighbours. A `list()` row is
compared too, but not from here: `list()` is lazy on purpose, so the builder is called by the engine
during the diff, and the check runs there. That has a cost worth knowing and a shape worth knowing:

```
100 rows, a stable callback, mount then three more renders
check on:   200 row builds on mount, 200 after the three
check off:  100                      100
```

Twice for a row that is **built**, and nothing at all for one that is reused — a reused row is never
rebuilt, so a list whose rows are all steady pays nothing after the first render. A mistake in one row
callback is **one** report, however many rows there are.

**What is deliberately not checked.** A hook's props callback exists in order to re-run on every
render of its owner — that is its contract — so the bag it returns is a fresh object by design, and so
are the values in it: a fetcher that closes over a prop cannot be a stable function. That churn is
real, and a [`@compute`](/concepts/compute) bag is the cure when a subscription's `connect` or a `@compute` reads
one, but reporting it would be a warning per hook with nothing to do about it. A **vnode** passed as a
prop — `onLoading={<p>…</p>}` — is not reported either, for the same reason at a smaller scale: JSX is
a fresh object every render. The check walks into it, so an inline handler inside still counts.

**One thing to expect:** a `render()` with a side effect performs it twice in development, and so does a
`list()` row callback, which is built twice for the same reason. `RMD001` already makes a state write
there an error, so "render is pure" is the rule either way — but a `console.log` in a render, or in a row,
really will appear twice. That is the check working.

**Turning it off.** When that is in the way — you are logging from `render()` to watch render order,
or a render is heavy enough that doubling it makes development uncomfortable — switch it off at your
entry point:

```ts
import { bootstrap, configureDev } from "@ramonda/core";

configureDev({ strictRender: false });   // keeps devtools and every other check
bootstrap(<App />, document.querySelector("#app")!);
```

It is a no-op in a production build, where the check is not compiled in at all.

## RMD021 — randomness during a render, a `@compute`, a `@memoized` member or a hook's props

`Math.random()`, `crypto.randomUUID()` and `crypto.getRandomValues()` are reported when
they are called while one of the four pure phases is running. The same call fails
differently in each, so the message differs with it:

- **In a `render()`** the output depends on when it ran, so a server render and its
  hydration disagree and the markup is thrown away
  ([RMD007](#rmd007-server-and-client-rendered-different-output)).
- **In a [`@compute`](/concepts/compute)** it is quieter and worse: the answer is
  cached, so the value is frozen at the moment it was first asked for, and only a
  dependency the compute actually READ can refresh it — which may be never.
- **In a [`@memoized`](/concepts/events) builder** it is cached *with the
  handler*, keyed by the arguments, so every call to that handler uses the one value.
  The builder runs during a render, so without its own report the fix would look like a
  render problem.
- **In a [hook's props callback](/hooks/writing)** it is the strangest of the four. The
  callback is [cached](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity) on
  the signals it reads, and a random or clock value is not one of them — so it is frozen
  into the bag until something *unrelated* invalidates the callback, and then it jumps. As
  a [query key](/query/queries): an entry that changes when somebody else's state moves,
  and never when yours does.

Read it once in `@created` and keep it in `@state` (or `@persist`, so it survives
hydration), take it as a prop, or read it in the event handler that needs it.

**The clock is deliberately not watched here.** The platform reads it behind your back —
an `Event` constructor stamps `timeStamp` — so a guard on it would report calls your app
never made, attributed to whichever component happened to be rendering. `new Date()` is
caught by [RMD020](#rmd020-render-produced-a-different-value-the-second-time) as a fresh
identity, and `Date.now()` only when a hydration disagrees
([RMD007](#rmd007-server-and-client-rendered-different-output)). In a client-only app
nothing catches it at runtime, which is why
[`ramonda-check`](/reference/check) reads it out of the source instead, as
`clock-read-while-rendering`.

## RMD022 — a hook's props callback built a new value for the same contents

The props callback is called **twice in the same tick** and the two bags compared — the
same check [RMD020](#rmd020-render-produced-a-different-value-the-second-time) runs on
`render()`, on the other place the framework asks the app for a value. It is part of the
strict render, so `configureDev({ strictRender: false })` turns both off.

Why it matters more here than it looks: **every prop is a signal**, and a signal compares
by reference. A rebuilt array is a *changed* prop, so a `@compute` reading it recomputes, a
`@watchProp` on it fires, and a subscription whose `connect` reads it reconnects — every
time the callback runs.

**Two conditions, not one.** The same-tick pair proves a value was built in place. That
alone is not worth saying: `key: ["user", self.props.id]` is built in place too, and when
`id` moves the array genuinely differs from last time — so the fix below would hand back
nothing. The second condition is a count *across* runs: this prop was rebuilt on four
consecutive runs of the callback and its value never moved. Below four, ordinary code gets
reported for coincidences; the same threshold, for the same reason, as
[RMD024](#rmd024-a-compute-recomputes-without-its-answer-changing).

A corollary worth knowing: a callback that is never invalidated cannot be reported for churn. It
runs once, its bag is [cached](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity), and
a value built once is not churn — the count never leaves zero. The **different-contents** finding
below still applies to it, and matters more there than anywhere: a value that is not a function of
state is frozen into that cache at mount and served for the life of the hook.

Three findings, three fixes:

- **an array or object** — hold it somewhere that has an identity (a `@compute`, a field,
  a module constant) and hand that over, so the callback passes a value along instead of
  building one. If you own the hook, [`@StableProps`](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity)
  declares the prop a value and settles it for every call site at once.
- **a function** — a bound method (`fetch: self.load`) reads `this` when it is called, so
  there is nothing to capture and the identity never changes;
  [`@memoized`](/concepts/events) when it has to be built per argument. A
  declaration cannot help here: two closures with the same body are not equal by any
  comparison that is safe to make, so a declared function prop is still reported.
- **different contents from two calls in one tick** — the callback is not a function of
  state. Read the value once in `@created` and keep it in `@state`, or read it where it is
  needed. Nothing can hide this one; what is compared is the contents. **Reported on the
  first occurrence**, with no count in front of it: this is a fault rather than churn, and
  it is the one kind the cache makes worse — a `Math.random()` in the bag is now frozen
  into the cached bag until something else invalidates it.

A `@compute` holding the whole bag fixes every value in it at once, and is the shortest
answer when several are unstable together.

## RMD023 — Children built from an array need a key

You rendered an array straight into children — a `.map()`, a `filter`, an array literal —
and its rows carry no `key`. That is supported, and it is what every framework asks for
here: give each row a key from your data.

```tsx
{this.items.map((item) => <Row key={item.id} item={item} />)}
```

Not the array index. The index **is** the position, so keying by it changes nothing.

Without a key the rows are matched by position, so inserting or removing anywhere but the
end hands every row below it the previous row's state and DOM — a half-typed input, an open
menu, a scroll position, all one row off, while the page still looks right.

**What is at stake is only the inside of the array.** Rows built this way cannot be confused
with the siblings around them: every array in JSX becomes its own group with its own key
space, so an element toggling in or out beside the array never reaches into it, and the
array never reaches out. A missing key costs you which row *inside* the array is which.

[`list()`](/lists) is the same thing without the eager build — the descriptor is rebuilt on
a render and the rows are not — and a key is good practice there too.

It does not fire for a single child, which has no sibling to be reordered against, nor when
any child carries a key, which means you are managing identity yourself.
## RMD024 — a `@compute` recomputes without its answer changing

Four recomputes in a row, each producing a value equal to the last. The cache is doing
nothing.

A `@compute` is invalidated by the signals it **read**, so if it recomputes on every pass while
answering the same thing, something it reads is being replaced every time — most often an array
or object literal rebuilt in a [hook's props bag](/hooks/writing#when-a-value-in-the-bag-should-keep-its-identity),
or a value derived from one. Declare that prop with `@StableProps` if you own the hook, and
hold the value somewhere stable if you do not — a `@compute` of its own, a field, a module
constant.

**Neither neighbour can see this one.** [RMD020](#rmd020-render-produced-a-different-value-the-second-time)
renders twice, and inside one strict render the compute is *cached* between the two calls, so
both get the same value and there is nothing to compare. [RMD022](#rmd022-a-hooks-props-callback-built-a-new-value-for-the-same-contents)
compares two props bags, but skips a prop the hook declared — and a compute reading a
*component's* prop is outside its reach entirely.

Three consecutive equal recomputes, not one: a dependency moving while the answer happens not to
change is ordinary, and reporting that would put a warning on correct code.

If nothing is being rebuilt, the compute is reading something that is not reactive at all — a
counter, `Date.now()`, a module variable. A `@compute` is the wrong place for that: read it once
in `@created` and keep it in [`@state`](/concepts/state). (The honest limit: a compute reading
*only* something non-reactive is never invalidated, so it is never observed either. Nothing can
report a value nobody asked for again.)

## RMD025 — per-request data read in the browser

`requestContext()` reads the real request on the **server**. In the browser only what the server
explicitly exposed is there, so a read of anything else returns nothing — and this says so, rather
than throwing and taking the page down.

```tsx
requestContext().cookies.get("session")   // ✗ in the browser — cookies are never exposed
requestContext().get(sessionKey)          // ✗ unless that key opted in
```

Two things are never exposed: **cookies and headers**. They belong to the server, and an httpOnly
cookie is invisible to JavaScript anyway. An app-defined value travels only if its key opted in:

```tsx
export const currentUser = requestKey<User | null>("currentUser", { exposeToClient: true });
```

Expose only what is safe to publish — a display name, an id, a role. Whatever you expose sits in
the page's HTML for anyone to read, so a session token or a database record never belongs there.

**Usually you need none of this.** Read the request in `@created` and keep the result in `@state`:
`@created` is skipped on hydration and the state is restored from the page, so the browser never
re-reads the request at all. Reach for `exposeToClient` when several components read the same
value straight from `requestContext()`.

If the server rendered something where this read is, the two sides now disagree and hydration
replaces the node — [`RMD007`](#rmd007-server-and-client-rendered-different-output) reports that separately.

## RMD027 — a props callback reads a value that is not reactive

A hook's props callback is cached on the signals it reads, so a render where none of them moved
does not call it again. This prop came out different anyway — which means the value reaching it
never passes through a signal, so nothing marked the cache stale.

```tsx
class Panel extends Component {
  items: string[] = [];                    // ✗ not @state
  add(x: string) {
    this.items = [...this.items, x];       // writes no signal
  }
  reader = this.use(List, (self) => ({ items: self.items }));
}
```

There are really two faults here, and the second is the one you feel: `items` is not reactive, so
assigning it schedules no render either. The hook is left holding a value the app has moved past,
and the page shows it.

Make the value reactive and both go away at once — `@state` for something the component owns,
`@compute` for something derived, a context signal for something shared. If it genuinely cannot be
(a `Date.now()`, a random id), read it once in `@created` and keep the result in `@state` rather
than reading it in the callback.

**The comparison is by value.** A callback that returns `{ filter: { q } }` builds a new object
every call by construction, and the cache absorbs exactly that — so a bag whose contents match
stays silent here. Identity is
[`RMD022`](#rmd022-a-hooks-props-callback-built-a-new-value-for-the-same-contents)'s subject, on
the renders where the callback does run.

**Function props are skipped.** `load: () => self.tick` reads the signal when it is *called*, so
one closure held across renders keeps answering with the current value — a fresh identity there
says nothing about staleness.

**The comparison goes to the end.** The one the framework uses to CHOOSE a reference is bounded at a
depth of two and at fifty array entries, because it runs on every render; past either it answers
"different", which costs a fresh reference and nothing more. A report cannot be built on that answer,
so this one compares thoroughly instead — deep enough for a JSX subtree passed through a bag, wide
enough for a table's worth of rows, which is where it used to go quiet for having compared nothing.

## What is non-deterministic in JavaScript, and what catches it

The inventory, because "collect how many of these exist" is the right instinct — and
the answer is that they fall into groups with different checks:

| read | RMD020 (render twice) | RMD021 (watch the call) |
|---|---|---|
| `Math.random()` | every time | yes |
| `crypto.randomUUID()` | every time | yes |
| `crypto.getRandomValues()` | every time | yes |
| `new Date()` (kept as an object) | every time, as `instance` | — |
| `performance.now()` | every time | — |
| `Date.now()` | **0.006%** | — |
| `new Date().toISOString()` | 0.091% | — |
| `process.hrtime()` (SSR) | every time | — |
| an app's own `let seq = 0; seq++` | every time | — |

RMD021 patches only the randomness family, and that is a finding rather than a
preference: a patched clock catches the PLATFORM's reads too. An `Event` constructor
stamps `timeStamp`, which under jsdom is a JS-visible `Date.now()` — so any diagnostic
raised during a render tripped it, and under jsdom is where every app runs its own
tests. Nothing in the platform generates randomness behind your back, so that half of
the check can be trusted.

**The residual gap, stated rather than papered over:** `Date.now()` read during a render
in a client-only app, with the value rendered. RMD020 misses it (same millisecond),
RMD021 does not watch it, and RMD007 never sees it because there is no server render to
disagree with. Server-render the app and RMD007 catches it immediately.

Not in scope for either, and a different mistake with a different fix: reading LAYOUT
or ambient state during a render — `getBoundingClientRect()`, `window.innerWidth`,
`scrollY`, `localStorage`, `document.activeElement`. Those are not non-deterministic so
much as a forced layout and a dependency on something outside the tree; `@updated` is
where that work belongs.

## RMD028 — an element the HTML parser is not allowed to keep here

```tsx
<p>
  intro
  <div>a block</div>   {/* reported */}
</p>
```

The client builds the DOM with `appendChild`, which puts a node exactly where it is told. A parser
does not:

```
your markup:    <p>intro<div>a block</div></p>
what a browser
builds from it: <p>intro</p><div>a block</div>
```

The `<p>` is closed early and the `<div>` becomes its sibling. **So this works perfectly until the
page is server-rendered**, and then the DOM the browser built is not the tree `render()` described.

Without this, what you would see at that point is
[RMD007](#rmd007-server-and-client-rendered-different-output) — a mismatch — whose advice is about `new Date()` and
`typeof window`. Neither is the problem: the server sent the right markup and the parser moved it.

What is reported, and what the parser does with each:

| markup | what happens |
| --- | --- |
| a block element inside `<p>` | the `<p>` is closed; the block becomes its sibling |
| `<li>` outside `<ul>` / `<ol>` / `<menu>` | relocated |
| `<tr>` outside a table, `<td>` outside a `<tr>` | relocated |
| `<option>` outside `<select>` / `<optgroup>` / `<datalist>` | relocated |
| `<form>` inside `<form>` | the inner one is **dropped**; its fields join the outer form |
| `<a>` inside `<a>` | the outer link is closed where the inner one starts |

"A block element" is every tag that closes a `<p>` by the parser's own rule — `div`, `ul`, `ol`,
`table`, `h1`–`h6`, `blockquote`, `form`, `hr`, `section`, `article`, `pre`, `figure`, and the rest
of flow content. Inline content — `<strong>`, `<em>`, `<a>`, `<span>` — is fine inside a `<p>`, which
is what a `<p>` is for.

**Put the element where the parser allows it.** A block beside the paragraph rather than inside it,
list items in a list, rows in a table. A component in between is invisible to this: what it renders
is what the parser sees, so the pair reported is the real parent and the real child however many
components sit between them in your JSX.

## RMD029 — a boolean attribute given the string "false"

```tsx
<input disabled="false" />     {/* reported — and the input IS disabled */}
<input disabled={false} />     {/* what was meant */}
```

A boolean attribute is true whenever it is **present**. The parser never reads its value, so the
string `"false"` turns the attribute on and the element does the opposite of what the line says:

| written | result |
| --- | --- |
| `disabled="false"` | the control is disabled and cannot be used |
| `hidden="false"` | the element is hidden |
| `readonly="false"` | the field cannot be edited |
| `required="false"` | the form will not submit without it |
| `checked="false"` | the box is checked |

Pass the boolean itself — `disabled={false}`, or `disabled={isLocked}`. A `false` **removes** the
attribute, and that is what makes it off.

**This is not fixed for you, on purpose.** `<input disabled="false">` is disabled in every browser,
by the HTML spec. A framework that quietly read the string and decided otherwise would make its JSX
mean something different from the markup it produces — the same page would behave one way rendered
by us and another way pasted into an HTML file.

**Only the exact string `"false"`, and only on a genuinely boolean attribute.** `aria-hidden="false"`
is valid and means what it says: ARIA attributes are enumerated strings rather than boolean
attributes. `data-open="false"` is your own data. `"no"`, `"off"` and `"0"` are not reported either —
they are probably mistakes, and probably is not enough to warn on.

Nothing in the type system catches this: JSX attributes are typed with an index signature, so any
value compiles.

## RMD030 — state written during `[INSPECT]()`

```tsx
[INSPECT]() {
  this.scans = this.scans + 1;   // reported
  return { scans: this.scans };
}
```

[`[INSPECT]()`](/devtools#what-an-instance-holds) describes an instance. It does
not change one.

The panel calls it **on every commit** while it is open on the components tab, so a write here closes
a circle: the write schedules a render, the render commits, the commit pings the panel, and the panel
asks again. Two things go wrong, and the second is the worse one:

- the app does more work to reach the same screen;
- **the values on screen stop being the values the app had** — handed to the one reader least able
  to doubt them, at exactly the moment they are trying to work out what is wrong.

**Read fields, derive values, return.** If something has to be computed, compute it into a local. If
something has to be cached, cache it in a **plain field** rather than `@state` — which is what
`Form` and `Mutation` already do, holding what their version counter stands for:

```tsx
[INSPECT]() {
  return { values: this.current, errors: [...this.issues], isDirty: this.isDirty };
}
```

A write that changes nothing is reported too. It schedules no render, so there is no loop — but the
method's contract is to read, and the same stance applies as in a
[`@compute`](#rmd018-state-written-during-a-compute). This is the third of that family:
[RMD001](#rmd001-state-written-during-render) during `render()`, RMD018 during a `@compute`, and
this one during a describe.

## RMD031 — A list item that is not an element

```tsx expect-error
// reported: a nested list() is a descriptor, not an element
list(pages, (page: Post[]) => list(page, (item) => <PostRow item={item} />));

// the way: a component, which is ONE item and renders the inner rows
list(pages, (item) => <PostPage item={item} />);
```

One item becomes exactly one element. The element is what carries the row's key and what the
diff matches rows on, so a string, a number, an array or a nested `list()` has nowhere to carry
its identity — the item is **skipped**, and the page renders one row short.

For plain values, wrap them: `list(names, (name) => <li>{name}</li>)`. For a nested list — a
list of pages, each holding rows — put a component between them, as
[nested lists](/lists/nested) shows: the component is one item to the outer list, and the rows are
what it renders.

TypeScript rejects all of this at the call site; this fires when the build has no types.

## RMD032 — More than one `@catchError` on a component

```tsx expect-error
class Panel extends Component {
  @catchError logIt(e: unknown) { report(e); }
  @catchError showFallback() { this.failed = true; }   // reported: the first never runs
  render() { … }
}
```

A component has one answer to "who handles an error from below?", so one of them gets it; the others
never run, and nothing says so — you read a handler that is dead.

**The one that runs is the LOWEST**, `showFallback` above. One rule covers this and
[`RMD040`](#rmd040-more-than-one-shouldupdateonpropschange-on-one-class): the declaration applied last
is the one that stands. `@catchError` is a **member** decorator and members initialise top to bottom,
so the lowest is applied last. A **class** decorator applies bottom-up, so there it is the highest —
the same rule, the opposite line.

Keep one, and let it decide. It receives the error, and returning `false` **declines** it, so the
next component above with a handler takes over:

```tsx
@catchError handle(e: unknown) {
  // Not mine — let the boundary above have it.
  if (!(e instanceof RangeError)) return false;
  this.failed = e.message;
}
```

A **subclass** declaring its own is not this. That is an override: the subclass's handler replaces
the base's, which is how a specialised boundary is written, and it is not reported. This fires only
for two declarations on the same class.
## RMD026 — retired

Superseded by the full fix for the ambiguity it reported, which removed the case rather than
describing it.

## RMD033 — State that cannot cross to the client

```tsx
@state formatter = new Intl.NumberFormat("sr-RS");   // reported
```

Only JSON-serializable state travels in the hydration blob, and it fails in three different ways. A
**function** is dropped, so the client starts with whatever the field initialises to. A value
`JSON.stringify` throws on — a `bigint`, a circular object — **never reaches the blob at all**, and the
whole component starts from its initialisers. And a `Date`, a `Map`, a `Set` or a class instance
**survives**: it arrives as a string or as a plain object, so the field is not missing, it is the wrong
type, and the first method call on it throws. Either way the two sides disagree from the first render.

Keep the value out of state and derive it on the client: in [`@created`](/concepts/lifecycle), which is
skipped during hydration, or in a [`@compute`](/concepts/compute). Where the server's own answer is
needed, store a serializable form of it — an id, an ISO string — and rebuild the object where it is
used.

## RMD034 — State written during create or mount is not carried to the client

`@created` and `@mounted` do not run again on the client: hydration adopts the server's DOM and restores
state from the blob. A value computed in either is therefore server-only unless it is `@state`, which
is serialized, or marked `@persist`.

Mark it `@persist` if the client needs the server's answer. If the work is cheap and deterministic,
move it somewhere that runs on both sides instead. See [hydration mismatches](/ssr/mismatches).

## RMD035 — The client's hook tree does not match the server's

State is restored by **position**, so both sides have to build the same hooks in the same order. A
`this.use()` behind a condition — `if (isServer)`, a feature flag, a branch on props — makes the
counts differ, and the state after it lands on the wrong hook or nowhere at all.

Call every `this.use()` unconditionally, at the top of the class. A hook that should do nothing is
still a hook that exists; give it options that make it idle rather than skipping it.

## RMD036 — The state blob could not be read

The component starts from its initial values instead of the server's, so the page can differ from what
was rendered — [`RMD007`](#rmd007-server-and-client-rendered-different-output) usually follows.

The blob is written into the markup, so this means it was altered on the way: HTML rewritten by a
proxy or a browser extension, a truncated response, or markup edited by hand. Compare what the server
sent with what arrived before looking anywhere else in the app.

## RMD037 — An object among JSX children that is not markup

```tsx
<p>{user}</p>          {/* reported, and dropped */}
<p>{user.name}</p>     {/* the way */}
```

It is dropped, so the page renders without it. Almost always a value meant to be read from rather than
rendered: a whole object where one of its fields belongs, a promise nobody awaited, or a `list()`
descriptor passed as a child instead of returned.

Render a string, a number, a vnode, or a list through [`list()`](/lists).

## RMD038 — A `@watchProp` selector threw

The selector returns `undefined` so the app keeps running, which means the watcher now sees a change
that is not one.

It almost always reads through something absent, so guard the path as you drill into it —
`p.foo?.[5]?.bar`. A selector runs on every props change and has to be total: no assertions, no
lookups that can fail.

The console line carries the error the selector threw, stack included, which is what names the failing
path. A record carries its message as text instead — see [what a record may hold](#capturing-them).

## RMD039 — `class` where `className` was meant

Ramonda reads `className`, and a `class` written on an element is **renamed to it** before the vnode
is built. So the element is styled and the page is not broken — this says the source does not match
what the element gets, and names the two cases where the rename cannot save it.

**`className` on the same element wins**, and the `class` beside it is dropped without a word:

```tsx expect-error
<span class="muted" className="loud" />   // renders class="loud"; "muted" goes nowhere
```

**A component is renamed too.** `<Panel class="muted" />` reaches `Panel` as `className`, so a `class`
prop that component declared reads `undefined` on every render:

```tsx expect-error
class Panel extends Component<{ class?: string }> {
  render() { return <span>{this.props.class}</span>; }   // always undefined
}
```

This is the one place the JSX deliberately differs from HTML, and the reason is the language: `class`
is a reserved word in the object a JSX factory receives.

Reported once per component and tag, so converting a codebase gets one report per place rather than one
for the first `class` and silence for the rest. `ramonda-check` reports the same attribute before it
renders, as `class-instead-of-classname`.

## RMD040 — More than one `@ShouldUpdateOnPropsChange` on one class

```tsx expect-error
@ShouldUpdateOnPropsChange((_self, previous, next) => next.v !== previous.v)   // this one decides
@ShouldUpdateOnPropsChange(() => false)                                       // never consulted
class Gated extends Component<{ v: number }> { render() { … } }
```

There can only be one answer to "take these props?", so one of them decides and the others never run —
a gate that looks present and is not.

**The one that decides is the HIGHEST**, which reads backwards. One rule covers this and
[`RMD032`](#rmd032-more-than-one-catcherror-on-a-component): the declaration applied last is the one
that stands. `@ShouldUpdateOnPropsChange` is a **class** decorator and class decorators apply bottom-up,
so the lower declaration writes the rule and the upper one overwrites it. A **member** decorator
initialises top to bottom, so there it is the lowest — the same rule, the opposite line.

Remove the extras and combine their conditions into one callback.

A **subclass** declaring its own is not this. That is an override — the ordinary way to specialise the
rule — and it is silent. This fires only for two applications on the same class.

## RMD041 — A listener with no target

The handler is never attached, so the event it waits for cannot arrive. A listener decorator resolves
its target when its effect runs on mount, and this one resolved nothing.

`@onWindow` and `@onDocument` are the only two, and they answer with `window` and `document` — which
are there for as long as the page is, and effects do not run on the server. So this means an effect
ran somewhere with no DOM at all: a component mounted in a bare Node process, or a test environment
set up without one.

Check where the mount happened rather than the listener.

## RMD043 — A `<meta>` with nothing to identify it

```tsx
// Skipped. Nothing identifies it, so an update could only append a second copy.
// The cast is what it takes to write this at all — see below.
skipped = this.use(Head, () => ({ meta: [{ content: "A framework." } as never] }));

// Written, and matched by its `name` when it changes.
described = this.use(Head, () => ({ meta: [{ name: "description", content: "A framework." }] }));
```

`Head` matches the tags it has already written so that an update replaces them rather than appending,
and a `<meta>` is matched by `name`, `property` or `http-equiv`. One with none of the three cannot be
found again, so it would be added on every update — it is skipped instead.

`MetaTag` requires one of the three, so TypeScript refuses the tag that would trip this. It fires for a
build with no types, or through a cast.

Reported once per set of fields the tag has, rather than once per tag: a `content` that carries the
page description is a different string on every navigation, and one report for each of them would say
nothing the first did not.

## RMD044 — An unknown element type in JSX

A tag has to be a string, a component class, or — for the one unsupported case — a function. This was
none of them, so an inert `<template>` renders in its place and whatever it was meant to be is
missing.

Usually a value used where a tag belongs: an object read off a map with the wrong key, or a component
whose import failed and arrived as `undefined`. A function in tag position is a different mistake with
its own advice — see [`RMD011`](#rmd011-a-function-was-used-as-a-jsx-tag).

The stand-in is rendered in every build, so a failed import costs that one element rather than the
page. Reported once per component, so two of these in two files are two reports.

## RMD046 — More than one `@StableProps` on one class

```tsx
@StableProps("a")
@StableProps("b")     // merged into the union, and reported
class Watcher extends Hook<{ a: readonly unknown[]; b: readonly unknown[] }> { … }
```

`@StableProps` names a **set**, and it already merges along the class chain — a subclass adds names
rather than shadowing the base's. So two on one class has an unambiguous reading, the union, and both
declarations take effect. Combine them: `@StableProps("a", "b")`.

**A warning rather than a refusal**, and the difference from the two above is the union: they have
none, so one declaration wins and the other silently does nothing. Here the result is exactly what
you asked for, written twice — so nothing is wrong except the spelling.

A **subclass** declaring its own is not this. That adds to the base's list, which is the intended way to
extend it.

## RMD047 — A `@memoized` member was given an argument it cannot key on

```tsx expect-error
@memoized
pick(row: Row) {          // reported: a Row cannot be part of a cache key
  return () => this.select(row.id);
}
```

```tsx
@memoized
pick(id: string) {        // the way: key on the primitive, read the rest inside
  return () => this.select(id);
}
```

`@memoized` caches by the ARGUMENTS, and a cache key can hold a string, a number or a
boolean. An object cannot: comparing it by value is not something the cache can do, and keying on its
identity would miss every time — a fresh object per render would fill the map and hand back a new
handler on every pass, which is the churn the decorator exists to prevent.

**Development throws**, so the mistake is not shipped. **Production builds the handler and moves on
without caching that call**: the page keeps working and only the memoisation is lost. It used to
throw there too, from inside a render, so one handler receiving an object took the whole page down —
and which handler that was depended on the data, so it could pass every test and fail for one user.

The code is on the thrown error as well as in the log, the way [RMD004](#rmd004-props-mutated-by-the-receiving-component)
is, so a codebase can be swept for it.

## RMD048 — Object in state changed in place

```tsx expect-error
this.user.name = "grace";              // reported: nothing renders
this.user.address.city = "paris";      // reported as `user.address.city`
```

```tsx
this.user = { ...this.user, name: "grace" };
this.user = { ...this.user, address: { ...this.user.address, city: "paris" } };
```

A signal fires when it is **assigned** a new value, not when the value it holds changes inside. So a
write into the object the signal already has changes nothing it can compare, nothing re-renders, and
the page goes on showing what it showed before.

The check wraps lazily: a read returns a guarded child only when something asks for that child, so it
follows the path a render actually touches. Reading `user.name` costs two proxies whatever the size
of `user`, and a `Date`, a `Map` or a class instance is left alone — their methods need the real
receiver.

[`@ramonda/lens`](/lens) is the shorter way to rebuild a path:
`this.user = focusOn(this.user).get("address").get("city").set(city)`.

The array form of the same fault is [RMD005](#rmd005-array-in-state-mutated-in-place).

## RMD049 — Two lazy functions with the same source

```tsx expect-error
const make = (path: string) => () => import(path);

<AsyncLoad lazy={make("./Dashboard")} onLoading={<i />} errorFallback={<i />} />
<AsyncLoad lazy={make("./Settings")} onLoading={<i />} errorFallback={<i />} />
```

```tsx
<AsyncLoad cacheKey="./Dashboard" lazy={make("./Dashboard")} onLoading={<i />} errorFallback={<i />} />
<AsyncLoad cacheKey="./Settings" lazy={make("./Settings")} onLoading={<i />} errorFallback={<i />} />
```

`AsyncLoad` identifies a module by the **source** of its `lazy`, which works when that source names
one. `() => import("./Thing")` says what it loads, so the same import written in two components is
two different functions with one meaning — and they share a cache entry, which is what you want.

A lazy a factory built names nothing: the path it closed over is not part of the source, so every
module the factory produces stringifies the same. Left alone, the first would load and cache and the
second would render the **first one's module** — nothing failing, nothing logged, and which module
you got depending on which rendered first.

Which of the two you have written cannot be read from the text of the function — the source a
bundler leaves behind is its own business, and a rule looking for a literal specifier would read one
bundler's output correctly and another's backwards. So nothing is guessed: when a second `lazy`
meets a key that is already taken, its module is loaded and **compared**. The module system serves a
genuine duplicate from its own registry, so the ordinary case pays one resolved promise and confirms
the sharing.

A module that turns out to be a different one is given a key of its own. It then renders what it
asked for; what it loses is the shared cache entry — a loading frame the second time. `cacheKey`
gives that back, and a route table that builds its lazies from a list is the usual way to meet this.

See [lazy loading](/composition/lazy) for the whole picture.

## RMD050 — A decorator whose effect this member already has

```tsx expect-error
@state @state count = 0;        // the same one twice
@state @persist token = "";     // @state already puts a field in the blob
```

Either the same decorator is on the member twice, or two of them give it the same thing. Delete the one
that adds nothing.

**A warning, not an error.** The member ends up right either way — a doubled `@state` renders once per
write with the right value, because the second application installs the same accessor over the first.
What is wrong is the belief that the second line was doing something.

**Two decorators that do different work on one member are silent, and that is most pairs.** A method that
is both `@created` and `@updated`, a handler on `@onWindow` and `@onDocument`, an `@interval` beside a
`@timeout`, a `@watchProp` that is also an `@updated` — each runs twice on purpose, which is the reason
for writing two.

And the pairs that make no sense at all never reach this code: `@state` with `@compute`, `@compute` with
`@persist`, `@state` with `@watchProp`, `@memoized` with `@compute` all **throw**, naming the member
and what it is, because one of the two is on the wrong kind of member entirely.

Reported once per member, not once per instance — a list of a thousand rows says it once.

# Forms — `RMF`

## RMF001 — a field was assigned to

```tsx
f.email.$.value = "a@b.c";   // throws
f.email.$.set("a@b.c");      // the way
```

A field node is a proxy over a path, not a place values live. An assignment would land on the
proxy and stop there: the form's values would be unchanged, nothing would revalidate, nothing
would re-render, and the next read would return the old value — a write that looks like it
worked. `set` records the change where the form can see it.

This one **throws** rather than warning, and in production too, because there is no correct
program in which the assignment does something. `RML009` is the only other check that survives
into production; every other report on this page is development only.

## RMF002 — the list members were used on a field that is not a list

`length`, `rows`, `append`, `insert` and `remove` belong to an array field. Reaching
for them on a field holding a string or a number is a path that does not say what it meant to —
usually a typo, or a schema that changed shape underneath the component.

An **absent** field is not this error: `undefined` and `null` read as an empty list, so a form
whose defaults have not filled in an optional array renders zero rows instead of throwing. Only
a value that is present and is not an array is reported.

## RMF003 — `onSubmit` threw

The form calls `onSubmit` from a DOM submit event, where nobody is waiting on the promise it
returns. A failure there is the app's to handle — the form does not know whether a network
error should become a message, a retry or a redirect — but it must not vanish either, so it is
reported and the form leaves `isSubmitting` behind it.

Handle it inside the handler, which is where the context is:

```tsx
async save(values: Signup) {
  try {
    await register(values);
  } catch {
    this.form.setError("email", "we could not reach the server");
  }
}
```

## RMF004 — the schema's validation rejected

Standard Schema says `validate` answers with a result or a promise of one. It does not say the
promise resolves, and an async rule doing real work rejects whenever that work does — a uniqueness
lookup against a server comes back as a rejected promise the moment the network fails. Every
validator propagates it.

The form keeps the messages it already had, because blanking them would claim the values had been
re-answered, and reports `isValid: false` — "we asked and did not hear back" is not "nothing
failed". A submit whose validation rejected does not call `onSubmit`, and releases `isSubmitting`
so the button is usable again.

Catch the failure inside the rule and turn it into an issue, so the reader is told what happened
instead of facing a form that will not answer:

```ts
import { object, string } from "bguard";
import type { ExceptionContext } from "bguard/core";

const schema = object({
  email: string().customAsync(async (received: string, ctx: ExceptionContext) => {
    try {
      if (await taken(received)) ctx.addIssue("unused", received, "u:taken");
    } catch {
      // The lookup failed, which is not the same as the address being taken. Saying so is what
      // keeps the form answerable.
      ctx.addIssue("a reachable server", received, "u:unreachable");
    }
  }),
});
```

# Query — `RMQ`

## RMQ001 — a query key that cannot be hashed

A key is turned into a string to find its cache entry, so what it holds has to survive that
trip. Two kinds of value do not, and each fails in its own direction:

**Dropped entirely** — a function or a symbol. `JSON.stringify` omits them, so
`["user", fn]` and `["user", otherFn]` hash **identically**: two queries share one entry and
each renders the other's data. Put the value you were about to close over in the key —
`["user", id]` — and keep the function in the fetcher.

**Serialized unstably** — a `Date`, a `Map`, a class instance. A `Date` becomes a timestamp that
differs on the next render, so the entry is never found again and every render starts a new
fetch; a `Map` or a class instance becomes whichever of its fields happen to be enumerable,
which is often nothing at all. Put a primitive in the key —
`date.toISOString().slice(0, 10)`, or the id — and keep the object in the fetcher.

Both are checked when the key is hashed, and the message names the kind it found. Arrays and
plain objects are walked, to a depth of ten.

## RMQ002 — a query failed and nothing rendered it

The query is in `error`, and the render that just happened read none of `isError`, `error`,
`status` or `result`. The report names the key and the failure.

It matters because **a failed refetch keeps the data it had**: the page can look perfectly
healthy while showing values that no longer refresh. Nothing throws, nothing is blank, and the
only sign is that a number stopped moving.

This is the answer to [`throwOnError`](/query/queries#when-the-failure-means-the-page-cannot-be-shown),
which `@ramonda/query` does not have. What that option is really for is *noticing*, and
noticing is a development-time report — where rethrowing into an error boundary would unmount
the subtree, run every cleanup, and throw away local state, focus and scroll for something as
ordinary as a timeout.

Reading any one of those four silences it, per render: a component that showed the error and
then stopped (a collapsed panel, a switched tab) is reported again, because each render is
judged on its own reads.

# Immutable updates — `RML`

Every one of these means **the write did not happen**: the value handed back is the original root,
unchanged and uncopied, and the app carried on with the value it already had. What the severity
separates is whether the *code* can be right —

- **error** — it cannot be, whatever the data holds. A wrong kind of value for the operation, a
  refused key, a branch that returns nothing.
- **warn** — it may well be, and the data was simply empty or absent. A path through a `null`, a
  predicate that matched nothing, a key already gone.

A path steps *through* a nullable value by design, so reporting that as an error would raise an alarm
about a program doing exactly what it was written to do.

None of them is deduplicated. [Messages you might see](/lens/messages) maps every message text to its
code, for when you have the console output and not the code.

## RML001 — a path that could not be reached

```tsx
const profile: { profile: { city: string } | null } = { profile: null };

focusOn(profile).get("profile").get("city").set("Niš");
// .profile is undefined, so .profile.city could not be reached.
```

A hop *before* the last one holds `undefined`, `null`, or a primitive, so there is nothing to descend
into. Only the last hop creates what it names — `set`, `update`, `push` and `insert` all write where
nothing is — and a gap before it cannot be walked through.

Set the intermediate value first, or `merge` the whole object into place. A warning rather than an
error because [stepping through an optional value](/lens/paths#stepping-through-optional-values) is
what the types are built for: the path is legal, and this run found the value absent.

## RML002 — a path into a `Map`, `Set` or `Date`

Those hold their contents in internal slots that a copy cannot reach, so a clone of one would look
right and throw on first use. They are fine as **values** — `set(new Date())` stores one like any
other leaf — but a path cannot descend into one.

Read the value out, rebuild it, and `set` the result:

```tsx
const store: { byId: Map<string, { title: string }> } = { byId: new Map() };

focusOn(store).get("byId").set(new Map(store.byId).set(id, { title: "Renamed" }));
```

## RML003 — an array hop on something that is not an array

`at` and `where` exist only where the focused value is an array, so TypeScript refuses this at the
call site. It fires when the build has no types, or through a cast. Use `get(key)` for an object.

## RML004 — an index outside the array

`at(i)` accepts `-length … length - 1`, negative counting from the end, so `at(-1)` is the last
element. `insert(i, …)` accepts one more — `length` itself, which appends, and `push` says that more
plainly.

A warning, not an error: the index is the code's, but the length is the data's, and an array that came
back shorter than expected is a normal thing for it to do.

## RML005 — a predicate that matched nothing

`where` matches **every** element that satisfies it, so matching none is a write with no target.
Reading the same path with `values()` shows what is actually there — a stale id and a comparison
against the wrong field both look like this.

Often legitimate: "publish every draft" over a list with no drafts left is a program working
correctly, which is why this warns rather than erring.

## RML006 — an operation that needs a different kind of value

`push` and `insert` need an array. A **missing or `null`** one counts as empty and is created; a value
that is present and is not an array — a number, a string, an object — is a genuine mistake.

`merge` needs an object and does **not** create one, and the line between them is what the operation
can supply: `push` hands over a complete array, while `merge` has only a `Partial`, so creating from it
would mint a half-built object typed as a whole one. Use `set` where the object itself may be missing.

## RML007 — nothing to remove

Either the container above the removal is not one, or the property named is already gone. Check the
hop before the one being removed, and the spelling of the key — a typo reads exactly the same way.

A warning: removing a key that is not there is the idempotent case, and a program that runs twice
lands here the second time.

## RML008 — a fork branch that returned nothing

```tsx
// ✗ returns undefined, so the branch is skipped
.and((post) => { post.get("title").set("Renamed"); })
// ✓
.and((post) => post.get("title").set("Renamed"))
```

What a branch returns *is* the new value of the forked node, so a block body without `return` hands
back `undefined`. TypeScript rejects it; this fires when the types were loose enough to let it
through. For the same reason a branch that ends in a **read** replaces the node with what it read.

## RML009 — a key a write is refused for

`get` takes a `string | number`, so a key can come from data — a field name, a key off a parsed
request body — and every write ends in an assignment into the copy. `__proto__`, `constructor` and
`prototype` are refused there, in `remove`, and in a `merge` partial: assigning to `__proto__` does
not create a property at all, it runs the setter `Object.prototype` provides and replaces the copy's
prototype.

If the key came from data, this is the guard doing its job — filter the key before building the path.

**This is the one check that is not compiled out of production**; only its message is. A check that
ran solely in development would protect the one build that was never exposed to a request.

## RML010 — a chain written through twice

```tsx
const blog: { posts: { title: string }[] } = { posts: [{ title: "a" }, { title: "b" }] };

const posts = focusOn(blog).get("posts");
posts.at(0).get("title").set("one");
posts.at(1).get("title").set("two"); // ✗ throws
```

`focusOn(root)` captures `root` once, so the second write is computed from the **original** value and
silently drops the first edit. The result looks plausible and is missing a change, which is far harder
to find than a throw.

Feed the result back in — `focusOn(next).…` — or make one [`and`](/lens/updating#several-edits-in-one-pass)
of the edits. Sharing a prefix to **read** is fine and never trips this.

## RML011 — `remove()` at the root

Removal needs the container holding the value, and the root has none. Focus the property or element
to drop first: `focusOn(state).get("home").remove()`.

`RML010` and `RML011` **throw** in development and are a silent no-op in production, so neither is
control flow to rely on — do not wrap either in a `try` expecting to catch something in a shipped
build.

## RMD051 — A list row cannot be told apart from its siblings

A list identifies a row by what sets it apart from the others, which is what lets a row
replaced by fresh objects — a refetch, a `JSON.parse` — be recognised as the row it replaces
and updated rather than destroyed and rebuilt. This row carries nothing that could do that:
every field it has is either nested (compared, but never counted as evidence) or a value its
siblings share.

```ts
[{ tags: ["a"] }, { tags: ["b"] }];                              // nothing but nested data
[{ done: false, kind: "task" }, { done: false, kind: "task" }];  // only shared flags
```

So the row is rebuilt whenever the array is replaced, and a half-typed input or an open menu
on it goes with it. Give the row a field of its own — an id is the usual answer — or say which
row is which where the data arrives, rather than on every list that renders it:

```ts
this.rows = merge(this.rows, incoming, (row) => row.id);
```

It does **not** fire for a row that is simply new. Page 2 of a table is unpaired too, and
warning about that would put a report on correct code. See [lists](/lists).

## RMD052 — A component among JSX children, where an element was meant

```tsx
render() {
  return <div>{Panel}</div>; // ✗ names the component
}
```

`{Panel}` puts the class itself among the children. It is not markup, so it is dropped and the page
comes up without it. Write the element:

```tsx
render() {
  return (
    <div>
      <Panel />
    </div>
  );
}
```

This is reported separately from [RMD037](#rmd037-an-object-among-jsx-children-that-is-not-markup),
which looks for an OBJECT among children — a class is a function, so it never reached that check and
the mistake was silent until now.

Handing a component to something else is an attribute rather than a child: `<Slot view={Panel} />`
passes it as a prop, and that is a different thing entirely.

[`ramonda-check`](/reference/check) reports the same mistake from the source, before anything
renders.

## RMD053 — The request was read with no request scope installed

```tsx
@mounted async load() {
  const posts = await fetchPosts();
  const user = requestContext().get(currentUser); // ✗ below the await
}
```

`requestContext()` is live only while the page is being rendered. On the server that means the
**synchronous** section: the scope is installed, the tree is mounted, and it is cleared before the
render's first `await`. A read below one arrives after it is gone.

The scope is cleared that early on purpose. It is one module-level value shared by every request the
server is handling at once, and holding it across a yield is what would let one visitor's render read
another visitor's user. Reading synchronously is the rule that makes the shared value safe.

Read it where the render is still running, and keep what you need:

```tsx
@state user = "";

@created init() {
  this.user = requestContext().get(currentUser); // ✓ synchronous
}

@mounted async load() {
  const posts = await fetchPosts();
  console.log(this.user); // the value travelled in @state
}
```

An `async` lifecycle method is fine **above** its first `await` — that part still runs inside the
synchronous section.

Holding the object does not help:

```tsx
const context = requestContext(); // ✓ called in time
await fetchPosts();
context.get(currentUser); // ✗ still a late read
```

Every member of what `requestContext()` returns is a getter over the current request, so the object
is a door rather than a copy. `@state` is what carries a value across a yield.

The other way to arrive here is calling `requestContext()` at module top level, before any render has
started.

This is **reported as well as thrown**, because the throw does not always arrive anywhere: inside an
async `@mounted` it goes into the server's work drain and is swallowed, so the page is served,
complete, and quietly missing the value. The report is what survives that. In a production build
there is no report — diagnostics are development-only — which is another reason to read the request
where the framework can see you do it.

Reading per-request data during a **static build** is a different thing and reports separately: see
[`renderStatic`](/ssr/static), where the read is what marks the route un-bakeable.

## RMD054 — A post-commit callback threw, and the failure was swallowed

**This one is reported only from a production build**, and it is the only code on this page that is.
In development the same failure goes to the console with the error object attached, which is more
than a record can carry and better to read.

Commit-level work is isolated the way a `@mounted` is: one piece of it must not stop the rest. It
has no component to hand a failure to — that is what makes it commit-level rather than a lifecycle
callback — and it is not rethrown, because it runs while a commit may already be unwinding and a
throw there would replace the real error with a metadata one.

The consequence is a swallowed exception, and in production nothing said so. Nothing renders
differently, nothing logs, and whoever wrote the callback has no way to learn it never ran. So if
your app has [installed a collector](#capturing-them), the fault is reported to it.

The record carries the code and nothing from the error. The message on a thrown error is written by
whatever threw — your code, or a library inside it — and a record that may leave the process is the
wrong place to discover what is in it for the first time. If you want the detail, catch it in the
callback, where you know what you are looking at.

## RMD055 — A hook's props passed as a plain object

```tsx expect-error
class Panel extends Component {
  @state count = 1;

  // ✗ the compiler refuses this, and `use()` throws if it arrives anyway
  counter = this.use(Counter, { start: this.count });
}
```

A field initializer runs once, so an object written in one holds what was true at that moment and goes
on holding it for the life of the hook. `start` there is `1` forever: `this.count` moving to `7`
changes the owner and reaches nothing inside `Counter`.

Pass a callback, and the props follow:

```tsx
counter = this.use(Counter, () => ({ start: this.count }));
```

The callback is cached on the signals it reads, so it is re-run on a render where one of them moved
and skipped on a render where none did.

**Constants are written the same way, and cost the same.** A callback that reads no signal is called
once, at mount, and never again, and the inline functions in it keep their identity across the owner's
renders — measured in core's `PropsBagRuns.test.tsx`. So there is no bag cheap enough for the shape to
be worth choosing.

A development build calls it more often than that, and keeps none of it: a second time at mount, so
[RMD022](#rmd022-a-hooks-props-callback-built-a-new-value-for-the-same-contents) can compare the two
bags and catch a value that is not a function of state, and once per render of the owner, so
[RMD027](#rmd027-a-props-callback-reads-a-value-that-is-not-reactive) can check the cache has not gone
stale. The hook is handed the first bag in every build.

**It throws in every build**, like a write to props ([RMD004](#rmd004-props-mutated-by-the-receiving-component),
[RMD015](#rmd015-a-hooks-props-assigned-by-the-hook-that-received-them)): the alternative is a shipped bundle serving one
stale value for the life of the page, silently. The report beside the throw is development-only, and it
names the owner, the hook, and the keys the object carried.

The mistake cannot be found from inside `use()`, which is handed a finished object with no way to tell
`{ start: this.count }` from `{ start: 1 }`. The FORM is the visible half, so the form is what the
framework holds you to.

## RMD056 — One context provided twice by the same component

```tsx expect-error
const [ThemeProvider] = createContext({ color: "slate" }, { label: "Theme" });

class Panel extends Component {
  // ✗ two Providers of one context, on one component — this throws
  base = this.use(ThemeProvider, () => ({ color: "slate" }));
  accent = this.use(ThemeProvider, () => ({ color: "amber" }));

  render() {
    return <Card />;
  }
}
```

A component publishes a context on one object, so the second Provider would replace the first under
the same key: every descendant reads `"amber"`, and `base` is unreachable from below.

What hides it is that `base` still works *here*. A Provider reads as well as provides, so
`this.base.color` is `"slate"` inside `Panel` while every component under it sees `"amber"` — **the
component that made the mistake is the one place the mistake is invisible.** That is why this
**throws in every build**, like a write to props
([RMD004](#rmd004-props-mutated-by-the-receiving-component)) and a plain-object props bag
([RMD055](#rmd055-a-hooks-props-passed-as-a-plain-object)): a development-only report would leave a
shipped page handing the wrong value to whichever descendant asked.

Write two scopes instead. A component that renders `this.props.children` scopes its context to what is
inside it, which is what a `<Provider>` element does in a framework that has fragments:

```tsx
const [ThemeProvider, ThemeConsumer] = createContext({ color: "slate" }, { label: "Theme" });

class Scope extends Component<{ color: string; children?: RamondaNode }> {
  theme = this.use(ThemeProvider, () => ({ color: this.props.color }));
  render() {
    return this.props.children;
  }
}

class Panel extends Component {
  render() {
    return (
      <div>
        <Scope color="slate">
          <Card />
        </Scope>
        <Scope color="amber">
          <Card />
        </Scope>
      </div>
    );
  }
}
```

Two independent scopes, and a consumer inside each finds its own **with nothing passed down**. That
works because a context object is created from the component that *renders* a node — so a child handed
in as `children` inherits the wrapper's context, not the context of whoever wrote the JSX.

**Nesting is untouched and needs no scope wrapper.** A Provider on a descendant component shadows the
one above it for its own branch, which is ordinary and is never refused: the check asks whether *this*
component already published the key itself, and a Provider above it never makes that true.

**`single` is a different question.** It declares whether *nesting* is a fault — two on one path, on
different components — and a context that welcomes nesting is still broken by two on one component. So
this takes no option: there is no version of it an author would choose.

**Splitting the keys between two Providers is not a way out**, and the types already close it. A
Provider takes its options whole, so the second cannot supply half — it would replace the channel and
the first half would fall back to the default. If the two values are for different purposes, they are
two contexts: call `createContext` twice.

## RMD057 — A context consumed above the provider on the same component

```tsx
const [ThemeProvider, ThemeConsumer] = createContext({ color: "slate" }, { label: "Theme" });

class Section extends Component {
  // ✗ resolves before the provider on the line below it exists
  outer = this.use(ThemeConsumer);
  own = this.use(ThemeProvider, () => ({ color: "amber" }));

  render() {
    return <Card />;
  }
}
```

A consumer resolves its channel **once**, when it is constructed, and hooks are constructed in
field-declaration order. So this one looked before its own component had published anything, and reads
the nearest provider on an **ancestor** — or the context's default, if there is none. Swapping the two
field declarations changes what the page shows.

If this component's own value was meant, read it through the **provider** hook. A Provider reads as
well as provides, so `this.own.color` always means this component's value and does not rest on which
line came first:

```tsx
const [ThemeProvider] = createContext({ color: "slate" }, { label: "Theme" });

class Section extends Component {
  own = this.use(ThemeProvider, () => ({ color: "amber" }));

  render() {
    return <p>{this.own.color}</p>;
  }
}
```

If the value from **above** was meant — reading the outer theme to derive an inner one — then the
example at the top is that arrangement working, and the order it needs is the order it has. Nothing in
the source says which of the two it is, which is why this is a **warning** rather than an error and why
the panel does not raise its alert for it.

**The other order is not reported.** `this.use(QueryClientProvider)` followed by
`this.use(Query, …)` — mount a client, then query on it — is the arrangement `@ramonda/query` and
`@ramonda/router` are built around, and reporting it fired fourteen times across query's own tests.

`@ramonda/check`'s `context-consumed-above-its-provider` reports the same thing before anything runs,
including for a component down a branch nobody has opened. The two reach different cases on purpose:
the rule sees only a pair written directly — `const [P, C] = createContext(…)` with both halves handed
to `this.use` in one class — while a provider wrapped in a hook of its own, the way
`QueryClientProvider` wraps one, is invisible to it and is what this catches.

Deduped per context and owning component.

Deduped per context and owning component, so a component that mounts a thousand times says it once.

**It reports rather than throwing**, unlike a plain-object props bag
([RMD055](#rmd055-a-hooks-props-passed-as-a-plain-object)). There, a shipped bundle would go on serving a value
nobody set; here the page has one deterministic reading, and refusing it would break an app that has
been living with the first Provider being ignored. A later version can refuse.

## RMD058 — The request blob could not be read

```tsx
// The server stamps what the page opted into onto the root element:
//   <main data-ramonda-request='{"review-sid":"s-123"}'>
// and `hydrateRoot` reads it back. If that string does not parse, nothing is restored.
const sid = requestKey<string>("sid", { exposeToClient: true });
requestContext().get(sid); // undefined on the client, for every exposed key
```

The blob is ignored rather than fatal — a page that renders with a value missing beats a page that
does not render, which is the same stance [`RMD036`](#rmd036-the-state-blob-could-not-be-read) takes
for the state blob.

**What makes this worth its own code is what you see instead.** Two other diagnostics fire in its
place and both point away from the cause: [`RMD025`](#rmd025-per-request-data-read-in-the-browser) says a key was not exposed — it was —
and [`RMD007`](#rmd007-server-and-client-rendered-different-output) reports the render mismatch that follows, whose advice is about clocks and
random numbers. The page looks correct throughout, because the server's markup is still on screen.

The blob is JSON on the root element, so something between the server writing it and the browser
parsing it altered it: an HTML transform, a proxy rewriting markup, or a value that did not
serialize cleanly.

## RMD059 — An async lifecycle rejected

```tsx
@state posts: unknown[] = [];

@mounted async load() {
  this.posts = await fetchPosts();   // ✗ if this throws, nothing tells anyone
}
```

**An error boundary does not catch this, and that is deliberate.** The rejection arrives at an
arbitrary later moment — the page is already on screen and interactive, and there is no render left
to fail. Replacing what the reader is using with a fallback at that point is the worse outcome.

What follows is why the report exists. The page renders exactly as though the method had succeeded:
`posts` is still `[]`, the empty state shows, and the only trace is an unhandled rejection in a
console nobody is watching.

Handle it where it happens, and put the failure somewhere the render can see:

```tsx
@state error = "";

@mounted async load() {
  try { this.posts = await fetchPosts(); }
  catch (e) { this.error = String(e); }
}
```

If the failure really should take the page down, re-throw it from `render()` — that **is** a render,
and a boundary can see it.

`ramonda-check` reports the same method before it ships, as
[`unguarded-async-lifecycle`](/reference/check).

## RMD060 — render() is async

```tsx
// @ts-ignore
async render() {                       // ✗ returns a promise, not markup
  const rows = await api.rows();
  return <ul>{String(rows)}</ul>;
}
```

An `async render()` returns a `Promise` the moment it is called, so the diff is handed an object that
is not a node. What you see without this report is a `TypeError` thrown from inside the framework —
a stack of framework frames naming neither your component nor `render()`.

**The type system already refuses this**, so reaching it means a `@ts-ignore`, a cast, or a base
class loosened somewhere above. That is exactly why the check exists in all three places: a type is a
defence only while nobody casts it away.

Load the data outside the render, and let `render()` show whichever state the component is in:

```tsx
@state rows: unknown[] = [];

@mounted async load() {
  this.rows = await api.rows();
}

render() {
  return this.rows.length === 0 ? <p>Loading…</p> : <ul>{this.rows}</ul>;
}
```

Where the promise itself is the subject, [`AsyncLoad`](/composition/lazy) takes it and renders a
fallback while it settles.

`ramonda-check` reports the same method before it ships, as [`async-render`](/reference/check).
