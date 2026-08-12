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
| `RMD003` | error | Context consumed with no Provider above it |
| `RMD004` | error | Component wrote to its own props |
| `RMD005` | error | Array in state mutated in place |
| `RMD006` | error | Timer still running after unmount |
| `RMD007` | error | Server and client rendered different output |
| `RMD008` | warning | State changed after the component was unmounted |
| `RMD009` | error | Update loop — a component never stopped re-rendering |
| `RMD010` | error | The default host is not allowed in this parent |
| `RMD011` | error | A function was used as a JSX tag |
| `RMD013` | error | A list item produced nothing |
| `RMD015` | error | A hook wrote to its own options |
| `RMD016` | error | A component updated while its element is not in the document |
| `RMD017` | error | A deferred hydration never resumed |
| `RMD018` | error | State written during a `@compute` |
| `RMD019` | error | State set to a value that cannot be serialized |
| `RMD020` | warning | `render()` produced a different value the second time |
| `RMD021` | error | Randomness during a render, a `@compute`, a memoised handler or a hook's props |
| `RMD022` | warning | A hook's props callback built a new value for the same contents |
| `RMD023` | warning | Children built from an array need a key |
| `RMD024` | warning | A `@compute` recomputes without its answer changing |
| `RMD025` | error | Per-request data read in the browser |
| `RMD027` | error | A props callback reads a value that is not reactive |
| `RMD028` | error | An element the HTML parser is not allowed to keep here |
| `RMD029` | error | A boolean attribute given the string "false" |
| `RMD030` | error | State written during `[INSPECT]()` |
| `RMD031` | error | A list item that is not an element |
| `RMD032` | error | More than one `@catchError` on a component |
| `RMD033` | warning | State that cannot cross to the client |
| `RMD034` | warning | State written during create or mount is not carried to the client |
| `RMD035` | warning | The client's hook tree does not match the server's |
| `RMD036` | error | The state blob could not be read |
| `RMD037` | error | An object among JSX children that is not markup |
| `RMD038` | error | A `@watchProp` selector threw |
| `RMD039` | warning | `class` where `className` was meant |
| `RMD040` | error | More than one `@ShouldUpdateOnPropsChange` on one class |
| `RMD041` | warning | A listener with no target |
| `RMD042` | warning | The default host cannot be the direct target of this event |
| `RMD043` | warning | A `<meta>` with nothing to identify it |
| `RMD044` | error | An unknown element type in JSX |
| `RMD045` | error | More than one `@Host` on a component |
| `RMD046` | warning | More than one `@StableProps` on one class |
| `RMD047` | error | A memoized handler was given an argument it cannot key on |
| `RMD048` | error | Object in state changed in place |
| `RMD049` | error | Two lazy functions with the same source |
| `RMD050` | warning | A decorator whose effect this member already has |
| `RMD051` | warning | A list row cannot be told apart from its siblings |

### RMD033–RMD042 — the ten that were messages before they were codes

Each of these was a `ramondaLog` call with its advice written inline: a real fault, reported, but with
no stable name to search for, no `fix` a panel could render apart from the message, and no way for a
collector to group two occurrences of one cause. They live in `hydration/serialize.ts`,
`hydration/lint.ts`, `hydration/restore.ts`, `hydration/hydrate.ts`, `vdom/h.ts`,
`helpers/watchProps.ts`, `vdom/CreateRamonda.ts` and `base/decorators.ts`.

Two things came with the port. Each is now **deduplicated by source** like every other code, where
before it reported per occurrence — a hydration warning over a component with six unserializable
fields was six lines and is now one per field. And the severities are the ones the messages already
carried: the port gave them identity, it did not re-judge them.

What each one means and what to do about it is on the public reference rather than here, because that
is the page a reader lands on from a message: [ramonda.pages.dev/reference/diagnostics](https://ramonda.pages.dev/reference/diagnostics).

**Four messages in this package deliberately have no code**, and each says so where it is:
`bootstrap`'s "App crashed" (`index.ts`), a lazily loaded component that failed to arrive
(`base/AsyncLoad.ts`), a cleanup that threw during destroy (`helpers/lifecycleMenagement.ts`), and the
crash that follows RMD011 once it has already named the mistake (`vdom/h.ts`).

Every one is somebody else's fault surfaced with context, not a mistake this framework can offer a fix
for. `bootstrap`'s is the clearest case: the app's own error on its way up, rethrown on the next line,
so the framework knows nothing about it beyond having been in the call stack. A code promising advice
that cannot exist is worse than a sentence.

Three more sit outside this package for the same reason — a devtools plugin's own `snapshot()` error
and the panel's warning that its sink was replaced (`@ramonda/devtools`), and an ISR rebake failure
(`@ramonda/router`).

### RMD001 — State written during render()

`render()` reads state, it does not write it. A write there schedules another
render from inside a render: a double render at best, an infinite loop at worst
(when the written value changes every time).

Detected by marking the rendering component in `renderPhase` and checking that
slot from `State.set`. The check runs *after* `shouldUpdate`, so a write that
changes nothing — and therefore schedules nothing — is not reported.

Fix: `@compute` for derived values, `@watchProp` to sync from props, or write from
`@created` / an event handler.

### RMD002 — Duplicate key among siblings

Two children with the same key means only one can be matched; the other is treated
as new, so state and DOM go to the wrong node. Use a stable id from the data, not
the array index.

Mixing keyed and non-keyed children is **not** reported — `<ul><li>Header</li>{items.map(...)}</ul>`
is legitimate, and reconciliation handles it.

### RMD003 — Context consumed without a provider

The consumer silently falls back to the context's default value, which usually
looks like "my data never arrives".

Reported where the consumer is CONSTRUCTED — which is when its owning component
mounts — not on the first read. Nothing is declared to make that work: the
consumer resolves its channel once, at construction, so the answer already
exists there. Waiting for a read gave the same answer later, and for a value
read only down a branch nobody clicks, never at all.

A context can opt out with `createContext(default, { optional: true })`, which
says the default is a real answer rather than a stand-in. The router's `params`
is the one that does: a nav bar beside the outlet has no matched route above it.

Deduped per context id + owning component, so each call site says it once
however many instances mount, and two components missing the same context are
two reports.

### RMD004 — Props mutated

Props are owned by the parent, so the write has nothing to write to. The proxy's
`set` trap **throws**, in every build.

A diagnostic must never change behaviour, which is why the throw sits OUTSIDE
`if (__DEV__)`, as enforcement, while the diagnostic inside only explains it.
The write itself is refused rather than dropped: dropping it leaves the
component running on a value nobody set, and the mistake stays invisible
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

A raw `setInterval` started in `@created`/`@mounted` or a subscription keeps running after the
component is gone: it holds the component alive and keeps firing against state
nobody is showing.

`src/debug/timerGuard.ts` patches `window.setInterval`/`setTimeout`/`clearInterval`
/`clearTimeout` once, and attributes every timer to the component whose lifecycle
was running when it was created (`timerOwner`). The check runs from
`lifecycleCleanupManagement` **after** effect cleanups and `@destroyed`, so
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
`@created` + `@persist` (the client restores the server's value instead of rolling
a new one). For client-only UI, do NOT branch on the side — that is the bug. Use
two passes:

```tsx
@state isClient = false;
@mounted({ env: "client" }) markClient() { this.isClient = true; }
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
`clearReactives` entry. So without a flag, a late write — the fetch that resolves after the reader
navigated away — would queue a render for a component whose DOM is already gone:
wasted work, a diff against detached nodes, and the whole subtree held alive by
the queue.

`lifecycleCleanupManagement` sets `isDestroyed` on the runtime and
`addTaskToQueue` refuses. **The drop is not a dev check — it ships in
production**; only the report is stripped. `isDestroyed` is deliberately a
separate flag from `isInitialized`: that one means "not built yet", which
hydration and `@created` depend on, and conflating "before" with "after" would
break them.

Measured before fixing: the dead component rendered again (1 → 2 renders).
Effects and intervals do **not** come back to life — `runComponentEffects` only
runs effects whose `shouldRebuild` is set, and teardown detaches their deps — so
the damage was wasted renders and retention, not resurrected listeners.

`@destroyed` runs *before* the flag is set, so tearing down your own state there
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
that the effect mutated itself, so an effect writing the signal it reads runs
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
`render()` return `null`. It keeps `@state`, `@created`, `@watchProp`, `@onWindow`,
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
element": it has `@state`, `@created`/`@destroyed`, `@watchProp`, `@onWindow`, it can
provide context, and it adds no node for the parser to destroy.

```tsx
class RowsHook extends Hook<{ prefix: string }> {
  @state rows: string[] = [];
  @created load() { this.rows = fetchRows(); }
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
`@state` (inherited and new), hooks (inherited and new), and lifecycle — `@created`
runs base-first, then the subclass's.

**A group of cells sharing state** is the one case that is genuinely not a
component: it would have to be an element, and only `<td>` is legal there. That
is a **Hook** — state and lifecycle, no node — spliced in as `{group.cells()}`.
See "State and lifecycle with no markup of your own" above.

Auto-binding covers inherited methods, so `onClick={this.handleClick}` works in a
subclass that never mentions `handleClick`. That took a fix; it used
to fail silently, which is exactly the kind of thing that makes people write
constructors again.

### RMD013 — a list item produced nothing

`helpers/listEngine.ts`, on the result of the row callback. The item is skipped rather than
rendered, so the list on screen is a row shorter than the array — which is the kind of fault
that reads as missing DATA rather than as a bug in the row.

It used to report a colliding `key` callback as well. That option is gone: a key is written
on the vnode now, and two rows carrying the same one is `RMD002`.
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
listeners are still attached, its signals still hold it, `@destroyed` never ran, and
every render it does goes into nodes nobody can see.

**Ramonda's own removals cannot cause this.** Every path that removes something
goes through the diff, which unmounts. Measured on a component with an
`@interval`: after a conditional render drops it, **zero** further ticks. After a
third-party library clears the node via a `ref`, **five** ticks and five renders —
which is the case this code is for, and the only one that reaches it.

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

**Not** a hook's props callback. That was implemented and then removed after auditing what it
said about real code: a bag and the closures in it are fresh whenever the callback runs, and the
reports had no action behind them. RMD022 owns that ground now, with a run counter in front of
it. A vnode passed as a prop is likewise walked rather than called a rebuilt object — JSX is a
fresh object every render.

**The hazard, and the switch.** A render with a side effect runs it twice. RMD001
already makes a state write there an error, so "render is pure" is the position — but
a `fetch()` or a `console.log` in a render really does happen twice in development.
The framework's own test suites turn the check off in their setup files
(`configureDev({ strictRender: false })`), because they observe render ORDER by logging from
`render()` — precisely the impurity this reports.

### RMD021 — randomness during a render, a @compute, a memoised handler or a hook's props

`Math.random`, `crypto.randomUUID` and `crypto.getRandomValues` are patched in a
development build (the trick `timerGuard` already uses) and report when they are called
while `renderPhase`, `computePhase`, `memoPhase` or `propsPhase` is set. Four messages,
because the consequence differs: a render disagrees with its own hydration, a `@compute`
freezes the value until a dependency it READ changes, a memoised handler caches the
value with the handler so every call uses the same one, and a hook's props callback is cached
on the signals it reads — a random value is not one of them, so it is frozen into the bag until
something unrelated invalidates the callback, and then it jumps.

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

**Two conditions, and the second is what makes it worth reading.** The same-tick pair proves
only that a value was built in place. On its own that reported `key: ["user", self.props.id]`,
where the array genuinely differs each time and `@StableProps("key")` would hand back nothing —
advice with no effect, on every render. A per-key counter (`RUNS = 3`, the same number and the
same reasoning as RMD024) adds the second condition: rebuilt on four consecutive runs of the
callback, and equal to last run's value every time. `nondeterministic` skips the counter and
reports the first time — that is a fault rather than churn.

For a `handler` the counter is frequency alone: two closures with the same body are not equal by
any comparison that is safe to make, so what is counted is that the key was a fresh function on
each of the last few runs. That is the honest measure for a closure, whose cost is exactly
proportional to how often the bag is rebuilt.

**Keyed by the call site's props cache**, in a `WeakMap`, not by owner and hook name: two
`this.use(Query, …)` calls on one component share both of those, and one of them resetting the
count would silence the other forever.

**A callback that is never invalidated cannot be reported.** It runs once, its bag is cached, and
a value built once is not churn.

**Why a bag deserves its own check even though it is documented as re-running.** Every
prop is a signal, and a signal compares by reference (`common.ts`: `newVal !==
prevProps[key]`), so a rebuilt array is a change with real consequences downstream.
Measured, three renders of the owner: a hook `@compute` reading a rebuilt array runs 3
times vs 1 for a scalar prop; `@watchProp` on a rebuilt array fires on every update
render; a child handed a rebuilt function re-renders 3/3.

**A check like this only earns its place alongside a fix.** On its own it can say no more than
"your query key is an array literal" — true, and with nothing to do about it. The answer it points
at is `@StableProps` on the hook: the author states that a prop is a value, once, for every caller.
That is the same reason `list()` exists next to RMD020's report
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

### RMD023 — children built from an array need a key

Structural, and it has to be: RMD020's comparison cannot see a `.map()` at all — the mapper
goes to `Array.prototype.map` and is never stored, and the output is a run of fresh vnodes,
which is what all JSX is. The evidence is the SHAPE: JSX passes children as separate
arguments, so a nested array among them was built by an expression.

`normalizeChildren` brands every array it builds with `OWN_CHILDREN` (DEV only), which is
what makes `{this.props.children}` — the framework's own array, one level down —
distinguishable from a mapped one. Without that brand it fired on every component that
forwards children.

**It asks for a key rather than forbidding the shape.** It used to say "use `list()`
instead", and only for COMPONENTS, on the reasoning that plain markup survives being matched
by position because the diff patches the text. That is true of the text and false of
everything else on the element: an `<input>` inside a plain `<li>` holds a caret, a
selection and whatever the user typed, and those follow the NODE. So any element counts now.

**What is at stake is only the inside of the array.** Rows built this way cannot be confused
with the siblings around them — every array in JSX becomes its own group with its own key
space, so a sibling toggling in or out never reaches inside and the array never reaches out.
Measured with components of the same type on both sides of a `.map()`, no keys anywhere: the
siblings are never created or destroyed by anything happening in the array. What a missing
key costs is which row INSIDE the array is which.

**The bounds.** At least two children, because a single one has no sibling to be reordered
against. One keyed child anywhere means the app is managing identity and this does not
second-guess it. Nested arrays and `list()` descriptors are skipped: each is matched as one
child, so a key on it answers a question nobody asked.

### RMD024 — a @compute recomputes without its answer changing

Recorded in `debug/computeChurn.ts`, from the recompute site in the `compute` decorator: one
bounded `valueEqual` against the previous value, per recompute, DEV only. Reported after three
consecutive equal answers.

**Why three.** One recompute that returns an equal value is ordinary — a dependency moved and
the answer happened not to. Below three, correct code gets warned at for coincidences.

**Why neither neighbour covers it.** RMD020 renders twice and the compute is CACHED between the
two calls, so both see the same value. RMD022 compares props bags and skips anything declared
with `@StableProps` or wrapped in `stable()`, and a compute reading a component prop is outside
it entirely.

**Keyed by instance and member**, in a `WeakMap` of instances to a map of member names: two
instances of one component are two questions, and one churning says nothing about the other. A
test asserts the report COUNT for that reason rather than its presence.

**The honest limit**, stated in the docs too: a compute that reads only something non-reactive
is never invalidated, so it never recomputes and is never observed. The counter case is caught
only when the compute is invalidated by something else.

### RMD030 — state written during [INSPECT]()

The third of the phase family, and built the same way as the other two: a slot is marked around the
call, and the `@state` setter reads it. `inspectPhase` in `debug/renderPhase.ts`, set by `readDetail`
in `debug/inspector.ts`.

**Reported BEFORE `shouldUpdate`**, beside the `@compute` check rather than the render one. Describing
is meant to be a pure read, so a write that happens to change nothing is still the mistake. RMD001
waits until after, because a no-op write during a render schedules nothing and is therefore not the
bug it is looking for.

**Restored in a `finally`.** A `[INSPECT]()` that throws — reading a field that is undefined
mid-construction, which is exactly when someone has the panel open — must not leave the phase set,
or the next unrelated write anywhere in the app is reported as though it came from the describe. A
test covers that.

**Why an error rather than a warning.** The wasted renders are the smaller half. The panel ends up
showing values the app did not have, to the one reader least able to doubt them — a wrong result,
which is what the severity rule is about.

**The hole this filled, measured 2026-08-03 and again before the fix:** five scans over an
`[INSPECT]()` that increments a `@state` field moved it five times and reported nothing. RMD009 does
not fire, because it watches for a component that will not stop rendering and this one only turns
while somebody is looking.

### RMD029 — a boolean attribute given the string "false"

`debug/booleanAttribute.ts`, called from `setNextOnenhancedNode` — the point where the value is
FINAL, after anything that was going to normalise it has. Two comparisons, and only for a string: a
real boolean, a number and everything else return on the first test.

**Measured, which is what the message says:**

```
disabled={false}     attribute absent,  element enabled
disabled={"false"}   attribute present, element DISABLED
```

**Why it is not fixed instead.** `<input disabled="false">` is disabled by the HTML spec, in every
browser. Reading the string and deciding otherwise would make our JSX mean something different from
the markup it emits, and the difference would surface as a hydration mismatch or as markup that
behaves one way through us and another way pasted into a page. The attribute is set exactly as
asked; this says what the result will be.

**The bar for what is listed.** Only the exact string "false", and only on the spec's boolean
attributes. `aria-*` is excluded because ARIA attributes are enumerated strings — `aria-hidden="false"`
is correct and meaningful. "no", "off" and "0" are excluded because a `data-*` flag legitimately
carries them, and a diagnostic that fires on correct code teaches people to skip the category.

**Nothing in the types catches it:** `RamondaArgs` is `[val: Lowercase<string>]: any`, so every
attribute value compiles.

### RMD028 — an element the HTML parser is not allowed to keep here

`debug/domNesting.ts`, called from the same point as `checkHostPlacement` — which already has the
parent node and the freshly built child in hand. Reads `nodeName` on both, nothing else: no layout,
no attributes, no walk. A set lookup per element in a development build.

**Why it exists when hydration already notices.** It does notice, and it says the wrong thing.
Measured:

```
server emits:   <p>intro<div>a block</div></p>
browser parses: <p>intro</p><div>a block</div>

RMD007 then says: "<Card /> rendered <div> but the server sent nothing."
and advises:      "new Date() / Math.random() in render(): move the value into @created"
```

The server sent it. The parser moved it. A reader following that advice is looking for
non-determinism that is not there. This reports at creation time and names both tags and what the
parser will do.

**Why the client never shows it.** `appendChild` puts a node where it is told; a parser follows the
HTML spec's insertion rules. So the mistake survives any amount of SPA development and appears the
first time the page is server-rendered — which is the worst time to meet it.

**What is listed.** The `<p>`-closing set is the spec's flow-content list rather than a judgement
about what looks reasonable; `ONLY_INSIDE` covers the list, table, select and details families; and
`<form>` and `<a>` are the two tags the parser actively repairs rather than tolerates. Anything the
parser merely allows is absent, per the standard below.

**A default host in between is left to RMD010**, which can name the `@Host` to reach for. A component
that IS the misplaced element is checked like any other, because by then the pair is the real one.

### RMD027 — a props callback reads a value that is not reactive

The safety net under the props-callback cache, in `debug/propsStability.ts` next to RMD022.

`useCommon` caches a hook's props callback on the signals it read, so on a render where none of
them moved the callback is not called. That is right exactly as far as the tracking reaches: a
value that gets into the bag WITHOUT passing through a signal is invisible to it, and the cache
keeps serving the bag it last built.

Under a strict render, a callback the cache SKIPPED is called anyway and the two bags compared.
A difference means something it reads is not reactive.

**Compared by value, not by reference.** A callback that returns `{ filter: { q } }` builds a new
object every call by construction — the churn the cache exists to absorb, not a fault. Comparing
references would report every well-written callback in the app. Function props are skipped for
the same reason `resolveStable` skips them, and because a fresh closure on an untracked call
proves nothing about staleness.

**An error, not a warning**, unlike RMD022 next to it: the hook is running on a value the app has
already moved past, so what renders is not what the state says. Nothing here is merely slower.

**What it catches.** A plain field standing in for `@state`: assigning it writes no signal, so
nothing marks the callback's cache stale and the hook keeps a value the app has moved past. Two
faults in one line, and the second is the one that shows — the page renders what the form no longer
holds.

The probe deliberately does NOT go through `buildProps`. That one runs the RMD022 strict-render
check, which then fired from inside a check of its own — reporting churn on a render where the
callback was not going to be called, and, having no `declared` list to hand down, naming every
`@StableProps` key as unstable. See `probeProps` in `helpers/common.ts`.

### RMD031 — a list item that is not an element

`helpers/listEngine.ts`, one line above the assignment it guards. A row's key lives on the vnode
and the diff matches rows on it, so an item that is not one element has nowhere to carry its
identity — whether the key is one you wrote or one the list filled in.

**What it replaces, measured:** returning a nested `list()` from a `render:` callback threw
`Cannot set properties of undefined (setting 'key')`. A message about the assignment, from inside
the framework, naming neither the list nor what to write instead.

**The case it is really about.** A list of pages, each page a list of rows. The inner `list()` is a
descriptor, not an element, and nesting goes through a **component** — `(page) => <PageView item={page} />` — whose host
element wraps the inner rows and takes the key. `content/lists/nested.md` teaches that; a docs
example that did the other thing was a live crash until this check was written.

**Skipped, not thrown, in production too** — same reason as RMD013's empty item. The page loses one
row and keeps rendering, which is recoverable; a throw takes the whole tree down.

`describe()` names the value in the writer's words: "a nested `list()`" rather than "an object",
because the object literal somebody would then go looking for is not what happened.

### RMD051 — A list row cannot be told apart from its siblings

A list identifies a row by what sets it apart from the others. That is what lets a row
replaced by fresh objects — a refetch, a `JSON.parse`, anything round-tripped through the
network — be recognised as the row it replaces and updated, rather than destroyed and built
again with whatever its component was holding.

This row carries nothing that could do that. Every field it has is either nested (compared,
but never counted as evidence) or a value its siblings share:

```ts
// nothing but nested data — no field to tell one from another
[{ tags: ["a"] }, { tags: ["b"] }]

// every field is a flag they all carry
[{ done: false, kind: "task" }, { done: false, kind: "task" }]
```

So the row is rebuilt whenever the array is replaced, and a half-typed input, an open menu
or a scroll position on it goes with it.

Give the row a field that is its own — an id is the usual answer. Or, when only your app
knows which row is which, say so where the data arrives rather than on every list that
renders it:

```ts
this.rows = merge(this.rows, incoming, (row) => row.id);
```

**This does not fire for a row that is simply new.** A new row in a paginated table is
unpaired too, and reporting that would put a warning on correct code. The question asked is
about the ROW — could anything ever have identified it — not about whether it was matched.

## Retired codes

Numbers that were used and are now dead. They sit here rather than among the live ones because
nobody reading about a diagnostic needs them — and they cannot be deleted either: a reused number
makes an old bug report point at the wrong thing.

**A retired number is never reassigned.** A search for it should land here and find what it warned
about and why the hazard is gone, which is what somebody who met it in an old changeset is asking.

### RMD012 — retired 2026-07-18

It warned that an unkeyed list had other children after it, because flattening merged the two
into one key space and the list could claim its siblings. Arrays are no longer flattened —
each is its own group with its own key space — so the hazard cannot happen and the warning
would be advice about a non-problem — the fault it was written for being that a component's own
elements could be claimed by content passed into it.

### RMD014 — retired 2026-08-12

It reported a list given both `as` and `render`, or neither. Both were fields of an
options bag, and the bag is gone: `list(each, builder)` takes the component or the
function as its second argument, so "both" and "neither" are not shapes that can be
written. TypeScript rejected them already; this code existed for JavaScript, where
they failed quietly — with both given, `as` won and the render callback was never
called.

### RMD026 — retired 2026-08-03

It warned that an unkeyed child had been handed the DOM node a different same-tag sibling was
using, which happens when a conditional child appears or disappears and the siblings are matched
by position. It was written alongside a partial fix and reported only where it could be certain:
two or more unkeyed children sharing a tag, one of them matched to a node from another slot.

The hazard is gone. Every node now records the JSX child slot it was built for (`SLOT_SYM`,
holes counted) and an unkeyed child claims the node carrying its own slot rather than whatever
sits at its position, so a child appearing in the middle of same-shape siblings mounts a fresh
node instead of taking a neighbour's. There is nothing left to report, and nothing for the
reader to do about it — which is the better outcome, because the warning's only advice was to
add keys the framework should not have needed.

See the changeset for the measurements, and `__tests__/HoleAlignment.test.tsx` for the
arrangements it covers — conditionals at the start, middle and end, in both directions, with
elements and with components.
