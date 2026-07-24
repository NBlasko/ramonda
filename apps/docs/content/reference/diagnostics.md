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

A component kept re-rendering without settling. Two `@effect` methods writing what the other reads
is the usual cause; a write inside `render()` is the other.

The guard **stops** it rather than only reporting it, because a synchronous loop freezes the tab.
Production has a blunter version of the same stop that throws — a frozen tab is a worse outcome
than an error, and leaves nothing to debug.

Note that a *single* effect writing what it reads does **not** loop: the framework detaches a
signal an effect mutated itself. See [Effects](/concepts/effects).

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
[`@effect`](/concepts/effects). To **count runs** or otherwise instrument the compute, use a plain
(non-`@state`) field — render re-runs on the same changes and reads its latest value.

---

## Reading them

Every message names the component and says what to do instead. They go through the same reporter,
so a devtools panel or a test can capture them:

```ts
window.addEventListener("ramonda:diagnostic", (event) => { … });
```

The full reasoning behind each one — what was measured, what was rejected — is in
`packages/core/DIAGNOSTICS.md`.
