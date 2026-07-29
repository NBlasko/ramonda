---
title: Diagnostics
description: Every RMD code — what it means, what causes it, and what to do instead.
section: Reference
order: 110
---

# Diagnostics

Ramonda reports the common mistakes below at runtime, in development only. Every one is wrapped in
`if (__DEV__)`, so a production build ships none of the checks and none of the messages.

**They exist because these mistakes are silent.** Almost every bug this framework has had produced
a *wrong result* rather than an error: state landing on the wrong row, a click doing nothing, a
subtree rendering into nodes nobody can see. None of them threw. A diagnostic is the framework
saying the thing a stack trace never would.

Each is deduplicated by cause, so a mistake in a list of a thousand rows is reported once.

---

## RMD001 — State written during `render()`

`render()` must be a function of state, not a place that changes it. A write there schedules
another render from inside the render that caused it.

Move it to [`@create`](/concepts/lifecycle) if it is initialisation, or to an event handler if it
is a response to something. If it is a value derived from other state, that is
[`@compute`](/concepts/compute).

## RMD002 — Duplicate key in a child list

Two siblings claiming the same identity. The diff will match one of them to the wrong node, and
the symptom is state appearing on the wrong row.

The real fix is usually to stop writing keys: [`list()`](/lists) derives identity from the items
themselves and cannot collide.

## RMD003 — Context consumed without a provider above it

The consumer fell back to the default declared in `createContext`. Reported on the **read**, not
on construction — a hook may legitimately hold a consumer it never reads.

Either add the provider, or make the default a real fallback you are happy with. See
[Context](/composition/context).

## RMD004 — Props mutated by the receiving component

Props belong to the parent. The assignment **throws**, in every build — it used to be swallowed,
so reading the value back gave the old one and nothing said the write had been dropped.

Copy it into `@state`, or take a callback prop and ask the parent to change it. See
[Props](/concepts/props).

## RMD005 — Array in state mutated in place

`this.items.push(x)` does not re-render: the signal compares values, and the array you pushed into
is the same array.

Replace it: `this.items = [...this.items, x]`.

## RMD006 — Timer still running after unmount

A `setInterval` or `setTimeout` outlived its component, so it will fire into something that no
longer exists.

Use [`@interval` / `@timeout`](/concepts/timers), which are cleared on unmount and cannot leak.

## RMD007 — Server and client rendered different output

Hydration found the client rendering something other than what the server sent, so nodes were
replaced instead of adopted.

Usually a value that differs by nature (`Date`, `Math.random`), a browser-only API read during a
render, or a branch on the environment inside `render()`. See
[hydration mismatches](/ssr/mismatches) for the two-pass pattern that fixes it.

## RMD008 — State changed after the component was unmounted

A fetch that resolved after the user navigated away, most often. The update is **dropped** — in
production too, not only in development — so it cannot render into a detached tree.

Cancel the work in `@destroy`, or check before writing.

## RMD009 — Update loop

A component kept re-rendering without settling. Two `@updated` methods writing what the other reads
is the usual cause; a write inside `render()` is the other.

The guard **stops** it rather than only reporting it, because a synchronous loop freezes the tab.
Production has a blunter version of the same stop that throws — a frozen tab is a worse outcome
than an error, and leaves nothing to debug.

Note that a *single* effect writing what it reads does **not** loop: the framework detaches a
signal an effect mutated itself. See [Subscriptions](/concepts/subscriptions).

## RMD010 — The default host is not allowed in this parent

`<table>`, `<tbody>`, `<tr>`, `<select>` and `<svg>` reject unknown children — the browser's parser
moves or deletes them, so the component is destroyed or split in two.

Become the element the parent expects: `@Host("tbody")`, `@Host("tr")`, `@Host("td")`,
`@Host("option")`, `@Host("g")`. See [the host element](/concepts/host).

## RMD011 — A function was used as a JSX tag

A tag that is not an element, which breaks the rule the framework is built on. TypeScript rejects
it; this fires when the build has no types.

If you wanted vnodes from a function, call it as an expression — `{rows()}`. If you wanted state
and lifecycle without an element, that is a [Hook](/hooks).

## RMD012 — retired

Superseded by `list()`, which prevents the problem structurally rather than reporting it.

## RMD013 — A list could not identify its items

Either a `key` callback returned the same value twice, or the render callback returned nothing for
an item.

If you passed `key`, consider dropping it — identity minted from the items cannot collide. Keep it
only for objects re-created as fresh instances for the same entity. See [lists](/lists).

## RMD014 — A list was given both `as` and `render`, or neither

Exactly one. The types forbid the mistake; this fires when the build has no types. See
[`as` and `render`](/lists/as-and-render).

## RMD015 — Hook options assigned by the hook that received them

Options belong to whoever called `this.use(...)`. The assignment **throws**, exactly like a write
to props (RMD004) — one rule for read-only inputs, not two.

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

```tsx
@state onPick = () => {};   // ✗ a function — not serializable
@state total = 42n;         // ✗ a bigint
```

Keep behaviour off state: a function is a **method** on the class, or a **prop** passed in (props
are not serialized — the parent re-supplies them on the client). A symbol or bigint should be a
string or number in state. And if the field is genuinely client-only and never meant to travel, it
should be a plain field, not `@state`. Deeper cases — a `Map`, a `Date`, a circular object — are
caught by the server renderer when it serializes, rather than at the write.

---

## Reading them

Every message names the component and says what to do instead. They go through the same reporter,
so a devtools panel or a test can capture them:

```ts
window.addEventListener("ramonda:diagnostic", (event) => { … });
```


## RMD020 — `render()` produced a different value the second time

A development build renders **every component twice** and compares the two outputs. Two calls in the
same tick, with no state change between them, must produce the same values — so anything that
differs was built by the render itself, or does not come from state at all.

That is what makes this precise: comparing against the *previous* render cannot tell a value that
was created in place from one that genuinely changed. Two calls in one tick can.

Three things get reported, each with its own fix.

**A function built in place.** The source is identical between the two calls, only the identity is
fresh. That is not just an allocation: an event handler whose identity changed is removed and re-added
on the element on every render, and a function passed to a child re-renders that child.

```tsx
<button onClick={() => this.save()}>   // ✗ a new function every render
<button onClick={this.save}>           // ✓ a bound method
```

For a handler that must be built per item, [`@memoizedHandler`](/concepts/events) caches it by its
arguments, per instance — so the second render hands back the same function and nothing is reported.

**An object or array built in place**, with the same contents. A child receiving it re-renders every
time, a [`@compute`](/concepts/compute) reading it recomputes every time, and if it is a
[list's](/lists) items then every row loses its identity and the whole list is rebuilt — per-item
state lost, `@destroy` and `@create` run again.

```tsx
<Chart config={{ smooth: true }} />    // ✗ rebuilt every render
@compute get config() { … }            // ✓ recomputed only when its inputs change
```

**A value that does not come from state** — `Math.random()`, `performance.now()`, `new Date()`. Decide
the value once in `@create` and keep it in `@state`.

Only the part of that class which varies **within a tick**, though: the two renders are microseconds
apart, so a millisecond clock reads the same both times. Measured over 200,000 tries, two consecutive
`Date.now()` calls differ in 0.006% of them. `Date.now()` is caught by
[RMD007](#rmd007-server-and-client-rendered-different-output) instead — a server render and its
hydration are milliseconds to seconds apart. The two checks cover the class between them; neither
covers it alone.

**What is deliberately not checked.** A hook's props callback exists in order to re-run on every
render of its owner — that is its contract — so the bag it returns is a fresh object by design, and so
are the values in it: a fetcher that closes over a prop cannot be a stable function. That churn is
real, and a [`@compute`](/concepts/compute) bag is the cure when a subscription's `connect` or a `@compute` reads
one, but reporting it would be a warning per hook with nothing to do about it. A **vnode** passed as a
prop — `onLoading={<p>…</p>}` — is not reported either, for the same reason at a smaller scale: JSX is
a fresh object every render. The check walks into it, so an inline handler inside still counts.

**One thing to expect:** a `render()` with a side effect performs it twice in development. `RMD001`
already makes a state write there an error, so "render is pure" is the rule either way — but a
`console.log` in a render really will appear twice. That is the check working.

**Turning it off.** When that is in the way — you are logging from `render()` to watch render order,
or a render is heavy enough that doubling it makes development uncomfortable — switch it off at your
entry point:

```ts
import { bootstrap, configureDev } from "@ramonda/core";

configureDev({ strictRender: false });   // keeps devtools and every other check
bootstrap(<App />, document.querySelector("#app")!);
```

It is a no-op in a production build, where the check is not compiled in at all.

## RMD021 — randomness during a render, a `@compute`, a memoised handler or a hook's props

`Math.random()`, `crypto.randomUUID()` and `crypto.getRandomValues()` are reported when
they are called while one of the four pure phases is running. The same call fails
differently in each, so the message differs with it:

- **In a `render()`** the output depends on when it ran, so a server render and its
  hydration disagree and the markup is thrown away
  ([RMD007](#rmd007-server-and-client-rendered-different-output)).
- **In a [`@compute`](/concepts/compute)** it is quieter and worse: the answer is
  cached, so the value is frozen at the moment it was first asked for, and only a
  dependency the compute actually READ can refresh it — which may be never.
- **In a [`@memoizedHandler`](/concepts/events) builder** it is cached *with the
  handler*, keyed by the arguments, so every call to that handler uses the one value.
  The builder runs during a render, so without its own report the fix would look like a
  render problem.
- **In a [hook's props callback](/hooks/writing)** it is the sharpest of the four: the
  callback runs on every render, so the prop holds a different value every time. As a
  [query key](/query/queries) that is a new cache entry per render and a fetch that
  never settles.

Read it once in `@create` and keep it in `@state` (or `@persist`, so it survives
hydration), take it as a prop, or read it in the event handler that needs it.

## RMD022 — a hook's props callback built a new value for the same contents

The props callback is called **twice in the same tick** and the two bags compared — the
same check [RMD020](#rmd020-render-produced-a-different-value-the-second-time) runs on
`render()`, on the other place the framework asks the app for a value on every render. It
is part of the strict render, so `configureDev({ strictRender: false })` turns both off.

Why it matters more here than it looks: **every prop is a signal**, and a signal compares
by reference. A rebuilt array is a *changed* prop, so a `@compute` reading it recomputes, a
`@watchProp` on it fires, and a subscription whose `connect` reads it reconnects — on
every render of the owner. Measured across three renders: a compute reading a rebuilt
array runs three times where one reading a scalar prop runs once, and a child component
handed a rebuilt function re-renders 3/3.

Three findings, three fixes:

- **an array or object** — wrap it in [`stable()`](/reference/api), which keeps one
  identity while the contents are equal (nested objects included). It is the counterpart
  of [`list()`](/lists) for a props bag.
- **a function** — a bound method (`fetch: self.load`) reads `this` when it is called, so
  there is nothing to capture and the identity never changes;
  [`@memoizedHandler`](/concepts/events) when it has to be built per argument. Functions
  cannot go through `stable()`: two closures with the same body are not equal by any
  comparison that is safe to make.
- **different contents from two calls in one tick** — the callback is not a function of
  state. Read the value once in `@create` and keep it in `@state`, or read it where it is
  needed. `stable()` cannot hide this one; what is compared is the contents, not the
  wrapper.

A `@compute` holding the whole bag fixes every value in it at once, and is the shortest
answer when several are unstable together.

## RMD023 — components built from an array, with no keys

```tsx
{this.items.map((item) => <Row item={item} />)}   // reported
```

A mapped array is a **supported** shape — it becomes its own region with its own key
space, so it cannot reach past itself and claim a sibling. What is not handled is
identity: a region's rows are matched by POSITION unless they carry keys. Insert or
remove anywhere but the end and every row after it takes the previous row's place. For
plain markup that is invisible, because the diff patches the text and the result is
correct. For a **component** it is state landing on the wrong item — the `@state` that
was row 2's is now row 3's, and the DOM goes with it: focus, scroll position, an open
menu, a half-typed input.

So the report is narrow, and deliberately so. It needs all of: built by an expression,
more than one child, no `key` on any of them, and at least one component among them.
`{items.map((i) => <li>{i}</li>)}` is not reported. `{this.props.children}` is not
reported — that array is the framework's own.

Two fixes:

```tsx
list({ each: this.items, as: Row })              // identity from the items themselves
{this.items.map((i) => <Row key={i.id} item={i} />)}   // or take it over yourself
```

[`list()`](/lists) is the better one for a second reason: it is lazy. The descriptor is
built in `render()` and the items by the diff, so a 500-row table's render is 0.04% of
its commit — and `each` accepts `null` and `undefined`, so there is no `?? []` to rebuild
every render.

**Why this is a structural check and not part of the double render.** [RMD020](#rmd020-render-produced-a-different-value-the-second-time)
compares two renders, and it cannot see this at all: the mapper is handed to
`Array.prototype.map` and never stored anywhere the comparison can reach, and its output
is a run of freshly built vnodes — which is what all JSX looks like. The shape is the
only evidence, and it is conclusive: JSX passes children as separate arguments, so a
nested array among them was built by an expression.

## What is non-deterministic in JavaScript, and what catches it

The inventory, because "collect how many of these exist" is the right instinct — and
the answer is that they fall into groups with different checks:

| read | RMD020 (render twice) | RMD021 (watch the call) |
|---|---|---|
| `Math.random()` | every time | yes |
| `crypto.randomUUID()` | every time | yes |
| `crypto.getRandomValues()` | every time | yes |
| `new Date()` (kept as an object) | every time | — |
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
