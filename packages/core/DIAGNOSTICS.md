# DEV Diagnostics

Ramonda ships checks that catch code fighting the framework's design. Each one has
a stable code you can search for, names the exact component and property, and says
what to do instead.

All checks live behind `if (__DEV__)` at the call site, so production builds strip
both the checks and the modules behind them (`src/debug/diagnostics.ts`,
`renderPhase.ts`, `lintChildren.ts`, `mutationGuard.ts`, `timerGuard.ts`,
`stateLabels.ts`). Verified by bundling `State.ts` with `--define:__DEV__=false`:
no reference to any debug symbol survives.

**Debug data must never cost a field.** `State` is the hottest object in the
framework and an app holds thousands of them. A declared class field costs a slot
on every instance even when nothing assigns it — `private metaData: string |
undefined` emits `metaData;`, which defines the property as undefined at
construction. So signal names live in a DEV-only WeakMap (`stateLabels.ts`), not
on the instance. Anything else debug-shaped should follow the same rule.

Diagnostics that run on a hot path take the **object**, not its name
(`reportWriteDuringRender(signal)`, `guardArray(value, signal)`), so the name
lookup only happens when something is actually reported.

Reports go to the normal log channel: the browser console, plus the devtools Logs
tab (`ramonda:dev-log`).

## Deduplication

A diagnostic is reported **once per source**, not once per occurrence — most fire
from the render path, and a warning that repeats every render is a warning people
learn to scroll past. The dedup key identifies the origin (component + property),
so a component that misuses the same property on every render reports once.

`resetDiagnostics()` clears the dedup set; it exists for tests.

## Codes

| Code | Severity | Problem |
| --- | --- | --- |
| `RMD001` | error | State written during `render()` |
| `RMD002` | error | Duplicate `key` among siblings |
| `RMD003` | warning | Context consumed with no Provider above it |
| `RMD004` | error | Component wrote to its own props |
| `RMD005` | error | Array in state mutated in place |
| `RMD006` | error | Timer still running after unmount |
| `RMD007` | error | Server and client rendered different output |
| `RMD008` | warning | State changed after the component was unmounted |
| `RMD009` | error | Update loop — a component never stopped re-rendering |
| `RMD010` | warning | The default host is not allowed in this parent |
| `RMD011` | error | A function was used as a JSX tag |
| `RMD013` | error | A `For` hook could not identify its items |
| `RMD014` | error | A `For` hook was given both `as` and `render`, or neither |
| `RMD015` | error | A hook wrote to its own options |
| `RMD016` | warning | A component updated while its element is not in the document |
| `RMD020` | warning | `render()` produced a different value the second time |
| `RMD021` | warning | Randomness during a render, a `@compute`, a memoised handler or a hook's props |
| `RMD022` | warning | A hook's props callback built a new value for the same contents |
| `RMD023` | warning | Components built from an array, with no keys |

### RMD001 — State written during render()

`render()` reads state, it does not write it. A write there schedules another
render from inside a render: a double render at best, an infinite loop at worst
(when the written value changes every time).

Detected by marking the rendering component in `renderPhase` and checking that
slot from `State.set`. The check runs *after* `shouldUpdate`, so a write that
changes nothing — and therefore schedules nothing — is not reported.

Fix: `@compute` for derived values, `@watchProp` to sync from props, or write from
`@create` / an event handler.

### RMD002 — Duplicate key among siblings

Two children with the same key means only one can be matched; the other is treated
as new, so state and DOM go to the wrong node. Use a stable id from the data, not
the array index.

Mixing keyed and non-keyed children is **not** reported — `<ul><li>Header</li>{items.map(...)}</ul>`
is legitimate, and reconciliation handles it.

### RMD003 — Context consumed without a provider

The consumer silently falls back to the context's default value, which usually
looks like "my data never arrives". Deduped per context id, not per label, so
unlabeled contexts don't collapse into one report.

### RMD004 — Props mutated

Props are owned by the parent, so the write has nothing to write to. The proxy's
`set` trap **throws**, in every build.

It used to report and continue, on the reasoning that a diagnostic must never
change behaviour. That reasoning still holds — and is why the throw sits OUTSIDE
`if (__DEV__)`, as enforcement, while the diagnostic inside only explains it.
What changed is the judgement about the write itself: dropping it left the
component running on a value nobody had set, and the mistake stayed invisible
until something downstream looked wrong for an unrelated-seeming reason.

It throws explicitly rather than returning `false`, because a `false` return
throws only in strict mode — so "always" would not have been true for a caller
outside a module.

Hook options are the same mistake and now behave identically; see RMD015.

### RMD005 — Array in state mutated in place

`this.items.push(x)` mutates the array the signal already holds. The setter never
runs, nothing re-renders, and the framework looks broken.

`State.get` hands arrays out behind a proxy (`src/debug/mutationGuard.ts`) that
reports the mutating call. Only mutators are trapped — `push`, `pop`, `shift`,
`unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`, plus index and
`length` writes. Reads (`map`, `filter`, `slice`, iteration) pass straight through,
and `slice()`/spread return plain arrays, so copy-then-reassign is untouched.

Two invariants this must not break:

- **Identity is stable.** One proxy per array instance, cached in a WeakMap. A
  fresh proxy per read would break every `===` the diff and `shouldUpdateProps`
  rely on.
- **`_value` is always the plain array.** `State.set` unwraps the proxy first, so
  DEV and production hold the same thing and `shouldUpdate` reaches the same
  verdict in both — including for `arr.push(x); this.items = arr`, which re-renders
  in neither (it was already reported).

### RMD006 — Timer still running after unmount

A raw `setInterval` started in `@create`/`@mount` or a subscription keeps running after the
component is gone: it holds the component alive and keeps firing against state
nobody is showing.

`src/debug/timerGuard.ts` patches `window.setInterval`/`setTimeout`/`clearInterval`
/`clearTimeout` once, and attributes every timer to the component whose lifecycle
was running when it was created (`timerOwner`). The check runs from
`lifecycleCleanupManagement` **after** effect cleanups and `@destroy`, so
`@interval`/`@timeout` — which clear themselves — never report.

`timerOwner` is saved and restored, not just set: `createComponent` nests (a child
is built from inside the parent's diff), and the parent still has mounts and
effects to run after that returns.

Timers created outside a lifecycle — from a click handler, say — have no owner to
attribute them to, and are ignored rather than guessed at. A `setTimeout` that
fires is finished, not leaked, so it untracks itself when it runs.

### RMD007 — Server and client rendered different output

Hydration adopts the server DOM, so `render()` must produce the same result on
both sides. Where it does not, the client silently overwrites the server markup:
the page flickers, and the server's work was wasted.

The check detects the **consequence**, not the causes — which is why one code
covers `typeof window`, `new Date()`, `Math.random()`, a localStorage read, and
anything else that differs across the boundary. Enumerating causes would mean
chasing each one forever and still missing the next.

**There is no extra render.** `hydrateComponent` already calls
`generateRenderOutput` — that IS the client render — and the server's output for
the same component is sitting in the node it is adopting. Every mismatch is
caught at a comparison the adopt path had to make anyway; `src/debug/
hydrationMismatch.ts` only reports before the patch lands. Text, attributes,
element type and child count are each compared at their own adopt site.

Attributes are only reported when **both** sides rendered one and they differ. A
server-only attribute is usually ours (the state blob, the dev marker) and a
client-only one is often an attribute that legitimately does not round-trip
through markup (`style=""`), so reporting those would fire on healthy pages.

**Prerequisite: text-node boundaries.** HTML cannot record where one text node
ends and the next begins, so `<span>Hello {name}!</span>` — three text children —
comes back from the parser as one fused node. Before this check existed,
hydration treated that as a mismatch, warned twice, and rebuilt the run
node-by-node (landing on the right text by luck). Any naive RMD007 would have
fired on nearly every real component — the exact "warning developers learn to
ignore" this file is written against. `hydrateText` now slices its own share off
the front with `splitText`, restoring the boundary the vnode expects and leaving
the remainder for the next child. That costs zero SSR bytes (React spends
`<!---->` separators here) and makes the check *more* precise: the server node
must **start with** the text we rendered, and anything else is real divergence.

On a real text mismatch the fused remainder is split off at the rendered length
before the node is replaced, so the children after it keep their text and are not
reported as missing too — one fault, one diagnostic.

**The fix RMD007 prescribes is tested.** `new Date()`/`Math.random()` move to
`@create` + `@persist` (the client restores the server's value instead of rolling
a new one). For client-only UI, do NOT branch on the side — that is the bug. Use
two passes:

```tsx
@state isClient = false;
@mount({ env: "client" }) markClient() { this.isClient = true; }
```

The hydrating render still sees `false`, so it matches the server; the switch
happens on the re-render a tick later.

**Deliberately NOT shipped: an `isServer()` helper.** It reads like the obvious
sanctioned replacement for `typeof window`, but calling it in `render()` *is* the
thing RMD007 reports — it would hand people a blessed way to cause the mismatch.
Branching by side belongs in lifecycle `env`, which the framework already has.

### RMD008 — State changed after the component was unmounted

`@state` signals hold the component's `reBuild` as their listener, and nothing
detaches it on teardown — only `@compute` and context register a
`clearReactives` entry. So a late write (the fetch that resolves after the user
navigated away) used to queue a render for a component whose DOM had already been
removed: wasted work, a diff against detached nodes, and the whole subtree kept
alive by the queue.

`lifecycleCleanupManagement` now sets `isDestroyed` on the runtime and
`addTaskToQueue` refuses. **The drop is not a dev check — it ships in
production**; only the report is stripped. `isDestroyed` is deliberately a
separate flag from `isInitialized`: that one means "not built yet", which
hydration and `@create` depend on, and conflating "before" with "after" would
break them.

Measured before fixing: the dead component rendered again (1 → 2 renders).
Effects and intervals do **not** come back to life — `runComponentEffects` only
runs effects whose `shouldRebuild` is set, and teardown detaches their deps — so
the damage was wasted renders and retention, not resurrected listeners.

`@destroy` runs *before* the flag is set, so tearing down your own state there
stays silent.

### RMD009 — Update loop

Rendering wrote state that scheduled another render of the same component, with
no end. Two ways in: two `@updated`s that write what the other reads, and a write
in `render()` itself (RMD001 names that one, but naming it does not help if the
tab freezes before the message can be read).

**This one must stop the loop, not just describe it.** The queue drains
synchronously inside one `processTask` call, so a runaway spins the event loop
and freezes the page — measured: the reproduction ran until the OS killed it at
25s. `isRunawayUpdate` counts rebuilds per component **per drain** and, past 50,
reports once and makes `processTask` skip the build. Skipping is what breaks the
cycle: rendering is what writes the state that re-queues the component.

**Per drain is the load-bearing part.** A runaway re-queues itself from inside
its own rebuild, so it spins within a single synchronous drain — that is exactly
the case that freezes. Counting across the component's lifetime instead would be
counting ordinary work, and would report the 51st click on a counter as an
infinite loop. (This was a real bug in the first draft: the counter lived in a
WeakMap that was never reset.) A test drives 60 updates across 60 drains and
expects silence.

50 is React's number and leaves room for a real cascade to settle.

**Self-writing effects were already safe.** `runComponentEffects` detaches deps
that the effect mutated itself, so an `@effect` writing the signal it reads runs
once and stops — which is why reproducing a loop needs *two* effects. Pinned by a
test, since it is the reason the obvious one-effect repro does nothing.

The guard is DEV-only. In production an update loop still freezes the tab, on the
bet that a loop this violent shows up the first time the code runs. Adding a cheap
counter to the production drain (React throws there) is a live question — see the
roadmap.

### RMD010 — The default host is not allowed in this parent

A component is always exactly one element. Without `@Host` that element is
`<ramonda-host style="display: contents">`, which is layout-neutral — but it is
still an element, and a few parents accept only specific children.

Developers cannot be expected to know which, and working it out from the JSX is
genuinely hard. At mount, though, it is not a guess at all: `mountNode` is
holding the real parent node and the freshly built host. That is the whole idea
behind this check — it names the exact tag to use because it can see where the
component actually landed.

**The list is measured, not reasoned about.** Every restricted parent was
round-tripped through the parser:

| parent | what the parser does |
|---|---|
| `<table>` `<tbody>` `<tr>` | foster-parents the host out in front of the table, **empty**, and re-parses its children into the table separately |
| `<select>` `<optgroup>` | discards the host outright — it simply vanishes |
| `<ul>` `<ol>` `<dl>` `<p>` | nothing; survives untouched |

So the table family splits a component in two: the host (carrying the state
blob) ends up outside the table while the rows it rendered end up inside.
`<select>` is worse — the host is deleted and the options are kept.

**`<ul>` is the trap, and it is why this list is short.** Its content model says
"only `<li>`", so it looks like it belongs above. But foster-parenting is a
*table* rule; the parser leaves `<ul>` alone and the markup round-trips fine.
Warning there would fire on `<ul>{items.map(...)}</ul>` — the most common list in
any app — for no defect at all. Being invalid per the spec is the developer's
business; being silently destroyed is ours. A first draft did include `UL`, and
the existing "a well-behaved app produces no diagnostics at all" test caught it.

**SVG is a different failure.** The host is created with `createElement`, i.e. in
the HTML namespace, and SVG renders only SVG-namespace content — so the subtree
is dropped. Re-parsing puts the same tag in the SVG namespace instead
(`namespaceURI: http://www.w3.org/2000/svg`, and `nodeName` lowercase rather than
uppercase), so server and client disagree about what the node even is. Use
`@Host("g")`.

Only the **default** host is checked. Once a developer has chosen a tag, the
choice is theirs.

#### What to use inside a table (and why the rule is simple)

The guidance falls straight out of the 1-1 rule: **a component IS one element, so
become the element the parent expects.**

| the component sits in | give it | render inside it |
|---|---|---|
| `<table>` | `@Host("tbody")` (or `thead`, `tfoot`, `caption`, `colgroup`) | the `<tr>`s |
| `<tbody>` `<thead>` `<tfoot>` | `@Host("tr")` | the `<td>` / `<th>` cells |
| `<tr>` | `@Host("td")` (or `th`) | the cell content |
| `<select>` `<optgroup>` | `@Host("option")` (or `optgroup`) | the label |
| inside `<svg>` | `@Host("g")` | the shapes |

Two facts remove most of the awkwardness people expect here:

**`render()` may return an array.** Those become children of the host, so one
`@Host("tr")` component holds as many `<td>`s as it likes. You do not need a
component per cell — you need one only when you want one.

**A `<table>` may contain several `<tbody>` elements.** So the "I need to emit
many rows" case, which looks like it needs a fragment, does not: make the
component the `<tbody>` and put it directly under `<table>`. Two such components
give two tbodys, which is valid HTML and renders as one continuous table.

Verified end to end — this exact shape is a test, round-tripped through the
parser byte-for-byte, because a prescribed fix that is not tested is only an
opinion:

```tsx
@Host("tr")    class Cells   { render() { return cells.map(c => <td>{c}</td>); } }
@Host("tbody") class Section { render() { return [<Cells .../>, <Cells .../>]; } }
@Host("div")   class App     { render() { return <table><Section/><Section/></table>; } }
```

#### State and lifecycle with no markup of your own

The table above is the view from the parent. The other half is the view from the
component: *how do I keep a piece with its own state and lifecycle — React's
`useEffect`-only component, the stateful fragment — when every Ramonda component
is an element?*

**Most of the time the question dissolves: just write the component.** Let
`render()` return `null`. It keeps `@state`, `@create`, `@watchProp`, `@onWindow`,
and its own re-render boundary, and leaves behind
`<ramonda-host style="display: contents">` — an element that takes part in **no
layout at all**.

```tsx
class Analytics extends Component<{ page: string }> {
  @watchProp((props) => props.page) track(page: string) { send(page); }
  render() { return null; }
}
```

That is the natural use, and the wrapper is not a cost: `display: contents`
means the box does not exist. This covers everywhere except the three parents
that reject even an inert element — `<table>`, `<select>`, `<svg>`.

**There, the answer is a Hook.** A Hook is precisely "state and lifecycle with no
element": it has `@state`, `@create`/`@destroy`, `@watchProp`, `@onWindow`, it can
provide context, and it adds no node for the parser to destroy.

```tsx
class RowsHook extends Hook<{ prefix: string }> {
  @state rows: string[] = [];
  @create load() { this.rows = fetchRows(); }
}

@Host("div")
class TableApp extends Component {
  rowsHook = this.use(RowsHook, { prefix: "x" });
  render() {
    return <table><tbody>
      {this.rowsHook.rows.map(r => <Row key={r} label={r} />)}
    </tbody></table>;
  }
}
```

**The Hook's one real cost:** it shares its owner's runtime, so its state writes
re-render the **owner**, not itself. It has no re-render boundary of its own.
That is the single thing React's stateful component has and a Hook does not.

| you need | use | you get |
|---|---|---|
| state + lifecycle, own re-render boundary | a component (may `render()` null) | one element — inert by default, free in layout |
| state + lifecycle where no element is legal | a Hook | no node at all; re-renders its owner |
| just vnodes, no state | a method or hook returning an array, called as `{rows()}` | plain values, spliced into the parent's children |

**Functions are not a third kind of component** — see RMD011.

### RMD011 — A function was used as a JSX tag

Every Ramonda tag is exactly one element. That is what lets you read the DOM
structure straight off the JSX, and it is worth protecting: a function in the tag
position would be a tag that is not an element, and the invariant would be gone
on sight.

`h` does call the function (rejecting it outright would only break the page in a
build that already has no types), but it reports first, and the message points at
whichever of the two real patterns above was wanted. `JSX.ElementType` is
deliberately left undeclared so TypeScript's default rule — "a component used as
a tag must return `JSX.Element`" — rejects it at the call site (TS2786); this
check is the runtime half of the same rule.

If a function returning vnodes is genuinely what you want, call it as an
expression: `{rows()}`. It reads as the value it is, and needs no JSX support at
all.

#### Composition: extend the component, don't wrap it

The reuse question, concretely: *ten `<td>`s in a row, and the first three want
special behaviour as one reusable piece — what wrapper do I use?*

**None.** React needs a fragment here because its unit of reuse is a function,
and functions cannot extend one another: reuse means nesting, nesting costs an
element, and the fragment hides it. Ramonda's units are the **class** and the
**Hook**. Neither nests, so the wrapper never appears — there is nothing for a
fragment to hide.

**"Someone styled a `<td>` and I want to add to it, but it must stay a `<td>`"**
— extend it. `@Host` is a static, so it comes down the chain, and a subclass may
override it:

```tsx
@Host("td") class BaseCell extends Component<{ label?: string }> {
  decorate(v: string) { return v.toUpperCase(); }
  render() { return <span>{this.decorate(this.props.label ?? "")}</span>; }
}

class FancyCell extends BaseCell {
  override decorate(v: string) { return `«${super.decorate(v)}»`; }
}
```

Both are still exactly one `<td>`; the subclass adds no element. **No constructor
is needed** — and none should be written. Everything survives `extends`:
`@Host` (override it by re-declaring), `render()`, plain methods (`super.` works),
`@state` (inherited and new), hooks (inherited and new), and lifecycle — `@create`
runs base-first, then the subclass's.

**A group of cells sharing state** is the one case that is genuinely not a
component: it would have to be an element, and only `<td>` is legal there. That
is a **Hook** — state and lifecycle, no node — spliced in as `{group.cells()}`.
See "State and lifecycle with no markup of your own" above.

Auto-binding covers inherited methods, so `onClick={this.handleClick}` works in a
subclass that never mentions `handleClick`. That took a fix — see BUGS.md; it used
to fail silently, which is exactly the kind of thing that makes people write
constructors again.

### RMD012 — retired 2026-07-18

It warned that an unkeyed list had other children after it, because flattening merged the two
into one key space and the list could claim its siblings. Arrays are no longer flattened —
each is its own group with its own key space — so the hazard cannot happen and the warning
would be advice about a non-problem. See BUGS.md, "A component's own elements could be claimed
by content passed into it".

### RMD013 — A For hook could not identify its items

`For` exists to delete the key. Identity is the item itself — an object reference,
or the value for a primitive — held in a `Map<item, id[]>`, so there is nothing to
write and nothing to get wrong. This code fires only where a mistake is still
possible.

**A colliding `key` callback.** The `key:` option survives for one real case:
items re-created as fresh objects that mean the same entity (a refetch). A
callback can still return the same value twice, which is exactly the failure
`For` was built to remove — so it is checked. Identity minted from the item cannot
collide, so that path is not checked at all.

**A render callback that returned nothing.** There is no vnode to key or place.

**Why the same item twice is not an error.** `[tag, tag]` is legitimate. Reference
identity cannot tell two occurrences apart — and neither could a hand-written key
— so each occurrence gets its own id (`Map<item, id[]>`, one id per occurrence)
and both rows stay stable across a reorder. Verified by test.

**Why `For` also fixes the slot problem.** The vnodes come out keyed, so the diff
claims them by identity instead of by position, and nothing after the list can be
mistaken for a list item. That is what corrupts a component's own chrome when a
caller passes an unkeyed list into `{this.props.children}`. The keys are
synthetic strings rather than the items themselves because the diff's key index is
a plain object — an object key would stringify to `"[object Object]"` and every
item would collide into one.

**What `For` does not fix.** A `Card` still cannot force its caller to use `For`.
`For` makes the correct call the shorter one; RMD012 is the net for whoever maps
anyway. The distinction that settled this: **a wrong key is an accident, using
`.map()` is a decision** — you can teach a decision, you cannot defend against an
accident.

#### RMD009's production counterpart

The RMD009 guard above is DEV-only, so it is stripped from a production build —
and a loop that only appears with real data (an effect that writes when
`items.length > 100`) would never have been seen in development. `core/Task.ts`
therefore carries a second, blunt stop that **does** ship:
`MAX_BUILDS_PER_DRAIN = 100_000` total rebuilds in one drain, then throw.

One integer for the whole drain — no attribution, no allocation, an increment
next to a render and a diff. It names no component (that stays RMD009's job in
DEV); its only purpose is to not freeze the machine. It clears the queue and
every `inBuildQueue` flag before throwing, so no component is left silently
unable to render again.

Measured: the two-effect ping-pong is stopped after **1.4s**, against hanging
until the OS killed it at 25s. The number is deliberately huge — a legitimate
drain is bounded by how many components have pending state, which for a big app
under a global change can be tens of thousands, and a wrong throw in production
is worse than 1.4s of jank.

It counts rebuilds rather than watching effects, so it catches any path that
re-queues a component from its own build — a write in `render()` included.

**The default test run does not cover it.** `__DEV__` compiles to
`process.env.NODE_ENV !== "production"` and vite bakes NODE_ENV in at transform,
so flipping it inside a test silently keeps testing the DEV path. Verify with a
whole process: `NODE_ENV=production npx vitest run <file>`.

### RMD014 — A For hook was given both `as` and `render`, or neither

A list needs exactly one way to turn an item into markup:

- `as: RowView` when an item maps to a component. `For` builds
  `<RowView item={item} />` itself, so there is no per-item function to write.
- `render: (item) => <li>{item.name}</li>` when an item maps to plain markup.

TypeScript already rejects both together (`ForAs` sets `render?: never`,
`ForRender` sets `as?: never`) and rejects neither. This code is for JavaScript,
where there are no types — and where both mistakes fail **quietly**: with both
given, `as` wins and the render callback is never called, so the list renders
something other than what was written and nothing says why. With neither, the
list has nothing to build an item from.

### RMD015 — Hook options assigned by the hook that received them

Options belong to whoever called `this.use(...)`. The options proxy serves each
key from the owner's signal on every read, so an assignment inside the hook has
nothing to write to.

Before this code existed the write landed on the proxy's empty target and was
**never seen again** — no error, and because the get trap kept serving the
signal, reading the key back returned the old value. Measured on a proxy with a
get trap only:

```
read before: red
write:       (no error)
read after:  red
```

**It throws, in every build** — the same as a write to a component's props
(RMD004). The two are one rule: a read-only input assigned by the code that
received it. They diverged briefly, and the divergence was the mistake: nothing a
user could see distinguished the two cases, so the difference read as an
inconsistency rather than as a design.

The throw is what stops the write; the DEV diagnostic only explains it. That
split matters — a diagnostic must not change behaviour between builds, so the
enforcement lives outside `if (__DEV__)` and the explanation lives inside it.

**Fix:** copy the value into `@state` if the hook owns it from that point on, or
take a callback option and ask the owner to change it.

### RMD016 — A component updated while its element is not in the document

The component is still mounted, but the DOM it lives in is gone from the document.
Nothing told the framework, so nothing was torn down: its timers still fire, its
listeners are still attached, its signals still hold it, `@destroy` never ran, and
every render it does goes into nodes nobody can see.

**Ramonda's own removals cannot cause this.** Every path that removes something
goes through the diff, which unmounts. Measured on a component with an
`@interval`: after a conditional render dropped it, **zero** further ticks. After
a third-party library cleared the node via a `ref`, **five** ticks and five
renders, with no diagnostic at all before this code existed.

So it comes from the boundary:

- a `ref` handed to a chart / modal / drag-and-drop library that clears or
  replaces the node
- an app embedded in a page whose host removes the mount point
- a hand-written `innerHTML` over a subtree containing components

**Fix:** call `unmount(container)` before the DOM goes away. Removing the element
is not a substitute — that is what produced this warning.

**It reports and lets the update through.** Building a tree in a detached
container and inserting it later is legitimate, and refusing the update would
break it. A diagnostic must not change behaviour.

**Checked at drain time, not when the update is queued.** `isInitialized` is set
before the host element is built, and the caller inserts it after that, so at
queue time a perfectly healthy component can be momentarily disconnected — more
so since children are now built detached and inserted by `reorderChildren`. A
drain runs in a microtask, after the synchronous commit, by which point anything
still disconnected really is orphaned.

### RMD020 — render() produced a different value the second time

A development build calls each component's `render()` **twice** and compares the two
outputs. With no state change between the two calls, anything that differs was built
by the render itself — an inline function, a rebuilt object or array — or does not
come from state at all (`Math.random()`, `performance.now()`, `new Date()`).

**It does not catch a millisecond clock**, and that is worth stating rather than
discovering: the two renders are microseconds apart, so `Date.now()` reads the same
both times — measured, two consecutive calls differ in 0.006% of 200,000 tries.
RMD007 catches those, because a server render and its hydration are milliseconds to
seconds apart. Neither check covers the class alone.

**Why twice rather than comparing against the previous render.** That comparison
conflates "created in place" with "genuinely changed", and cannot tell them apart at
all. Two calls in one tick can, with no false positives. It also catches
non-determinism, which the previous-render comparison never could — RMD007 sees the
same class of mistake, but only after a hydration mismatch has already happened.

**Why it can run on every render.** Measured here: `render()` is 3-4% of a commit
(1.56 µs of 48.69 for one element, 9.27 of 211.63 for twenty) and 0.04% for a table
of 500 rows — `list()` is lazy, so a second render rebuilds the descriptor and not
the items. And checking only the first render would miss every branch not taken then,
which is exactly where handlers live.

Building the second output is safe: `buildRenderOutput` produces vnodes and nothing
else — components are constructed by the diff, `hostTag` is already cached, a render
registers no signal dependencies, and `@memoizedHandler` returns the same function
for the same arguments, so it reads as stable rather than as a fault.

**Not** a hook's props callback. That was implemented and then removed after auditing
what it said about real code: the callback exists in order to re-run per owner render,
so the bag and the closures in it are fresh by design, and the reports had no action
behind them. A vnode passed as a prop is likewise walked rather than called a rebuilt
object — JSX is a fresh object every render.

**The hazard, and the switch.** A render with a side effect runs it twice. RMD001
already makes a state write there an error, so "render is pure" is the position — but
a `fetch()` or a `console.log` in a render really does happen twice in development.
The framework's own test suites turn the check off in their setup files
(`strictRender.enabled = false`), because they observe render ORDER by logging from
`render()` — precisely the impurity this reports.

### RMD021 — randomness during a render, a @compute, a memoised handler or a hook's props

`Math.random`, `crypto.randomUUID` and `crypto.getRandomValues` are patched in a
development build (the trick `timerGuard` already uses) and report when they are called
while `renderPhase`, `computePhase`, `memoPhase` or `propsPhase` is set. Four messages,
because the consequence differs: a render disagrees with its own hydration, a `@compute`
freezes the value until a dependency it READ changes, a memoised handler caches the
value with the handler so every call uses the same one, and a hook's props callback runs
on EVERY render, so the prop holds a different value each time — as a query key, a new
cache entry per render.

`propsPhase` is also the answer to "should the props callback run twice in a strict
render, like `render()` does". It should not: watching the call catches the same mistake,
and a callback may do more than build an object — running it twice would do that twice.

**Why the clock is not patched**, which was the first version: a patched global catches
the PLATFORM's calls too. An `Event` constructor stamps `timeStamp`, and under jsdom
that is a JS-visible `Date.now()` — so raising any diagnostic during a render tripped
it, because `ramondaLog` dispatches a `CustomEvent` for the devtools stream. Three of
core's own diagnostic tests failed with RMD021 instead of the code they asserted. Under
jsdom is where every app runs its tests, so that is disqualifying rather than fixable.
Randomness has no such problem: the platform never generates it behind your back.

`logger.ts` captures `crypto.randomUUID` before the patch is installed, for the same
reason — otherwise the framework reports itself.

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

### RMD022 — a hook's props callback built a new value for the same contents

The callback is called twice in one tick and the bags compared, key by key, with the same
`classify` RMD020 uses — so the three findings and their names are the same: `handler`,
`object`, `nondeterministic`. Gated on `isStrictRender()`, so one switch turns off both
double calls.

**Why a bag deserves its own check even though it is documented as re-running.** Every
prop is a signal, and a signal compares by reference (`common.ts`: `newVal !==
prevProps[key]`), so a rebuilt array is a change with real consequences downstream.
Measured, three renders of the owner: a hook `@compute` reading a rebuilt array runs 3
times vs 1 for a scalar prop; `@watchProp` on a rebuilt array fires on every update
render; a child handed a rebuilt function re-renders 3/3.

**Why the fix had to come with the check.** An earlier version of this comparison existed
inside `renderStability.ts` and was deleted, because the only thing it could say was
"your query key is an array literal" — true, and with nothing to do about it. The two
answers are `@StableProps` on the hook (the author states that a prop is a value, once,
for every caller) and `stable()` at the call site (the same thing from outside, for a hook
that declared nothing). That is the same reason `list()` exists next to RMD020's report
about a rebuilt `each`.

**Why a declared prop is skipped outright.** `@StableProps` means the framework already
holds one identity for equal contents, so reporting it would ask the app to fix what the
hook took care of. **Functions are the exception**: a declaration cannot make a closure
comparable, so `resolveStable` leaves it exactly as it came and this still reports it —
unstable AND silent would be the worst of both.

**Why `stable()` markers are unwrapped before comparing.** Two calls produce two marker
objects, so comparing them by identity would report the fix as the fault. Contents that
DIFFER between the two calls are still reported: a wrapper cannot launder
non-determinism.

### RMD023 — components built from an array, with no keys

Structural, and it has to be: RMD020's comparison cannot see a `.map()` at all — the
mapper goes to `Array.prototype.map` and is never stored, and the output is a run of fresh
vnodes, which is what all JSX is. The evidence is the SHAPE: JSX passes children as
separate arguments, so a nested array among them was built by an expression.

`normalizeChildren` brands every array it builds with `OWN_CHILDREN` (DEV only), which is
what makes `{this.props.children}` — the framework's own array, one level down —
distinguishable from a mapped one. Without that brand it fired on every component that
forwards children.

**Narrowed twice, and the history is the point.** The first version reported every raw
array and broke 10 of core's own tests, all of them exercising child groups on purpose —
a mapped array is supported here, and `SlotKeys.test.tsx` even carries the note that an
earlier, broader check was rejected for firing on the safe shape. What shipped reports only
what is genuinely unhandled: unkeyed COMPONENT rows, of which there are at least two. Plain
markup is patched in place and correct; a component's row moving takes its state and its
DOM with it. One keyed child anywhere means the app is managing identity and the framework
does not second-guess it.
