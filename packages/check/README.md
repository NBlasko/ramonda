# @ramonda/check

Three things a running page will not tell you: a context with no provider above it, a class field
holding a function literal, and a single-use decorator declared twice — on one class, or twice on one
member. All found before the app is ever opened.

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fcheck)](https://www.npmjs.com/package/@ramonda/check)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fcheck)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

```bash
npm add -D @ramonda/check
```

```jsonc
// package.json — first, so a broken app never reaches the bundler
"scripts": {
  "build": "ramonda-check && vite build"
}
```

A project scaffolded with `npm create ramonda` already has both lines.

## The fault it exists for

A context with no provider above it does not crash. The consumer falls back to the default, the
page renders, and someone reads a number that was never real.

The framework reports that at runtime (`RMD003`) — but only once the component actually mounts.
So a panel behind a condition nobody clicked, or a page in a chunk nobody opened, ships with the
fault and nothing has said a word. The commonest way to get there is a **reorder**: the provider
moves a level, the consumer stays, and everything still looks fine.

```
$ ramonda-check

[ramonda-check] 1 consumer(s) with no provider above them:

  src/pages/Account.tsx:14:9
    <Account> consumes "Session" — nothing provides it on this path:
    App → Layout → Account
```

The path is the useful part: it says where the provider has to go.

## What it follows

It starts at each `bootstrap(<App />)` / `hydrateRoot(<App />)` and walks down carrying the set of
contexts provided so far:

- **JSX**, including children — `<Shell><Reader /></Shell>` puts `Reader` under `Shell`, because
  `Shell` decides where its children mount, so a provider on `Shell` covers them.
- **`list({ each, as: Row })`** — `Row` renders where the list sits.
- **Route tables** — the views in `createRoutes` hang under the `<RouteOutlet>` that renders them.
- **Contexts a hook carries** — `this.use(Router)` provides the route context because `Router`
  itself does. Hooks built out of hooks resolve too.

## What it stays quiet about, on purpose

**It reports only what it can prove.** A component picked out of a variable or a registry, a hook
chosen at runtime — it goes quiet for that path rather than guess.

That is what makes it safe to fail a build on. A checker that cries wolf gets deleted; this one's
reports are real broken paths, never maybes. The honest cost: a fully dynamic composition is not
checked, and neither is a context that reaches a component only through a third-party hook's
internals.

A context created with `{ optional: true }` — its default is a real answer, not a stand-in for a
missing provider — is not reported here, exactly as it is not reported at runtime.

For the dynamic remainder, the framework reports `RMD003` when the component **mounts**.

## As a library

```ts
import { analyzeProject } from "@ramonda/check";

const { issues, counts } = analyzeProject("tsconfig.json");
```

`typescript` is a peer dependency: the analyzer runs on **your** compiler, so it reads your syntax
and your config rather than guessing at them.

It reads your config with two options overridden — `noLib` and `types` — because it asks the
checker only where a symbol was declared, never what type anything is. Skipping the lib and the
`@types/*` packages is most of its running time, which matters when it goes first in a build. It
does not typecheck and never did; that is `tsc`'s job.

## Docs

**https://ramonda.pages.dev/reference/check**

## Function literals in class fields

Ramonda binds every method to its instance, so an arrow in a field buys nothing over a method — and
costs one closure per instance, which for a list of a thousand rows is a thousand closures.

```
$ ramonda-check

[ramonda-check] 2 class field(s) holding a function literal:

  src/Panel.tsx:12:11
    Panel.onPick — write it as a method. Ramonda binds every method to its instance, so it keeps `this`
    when it is passed to an element, and one function is shared by every instance.

  src/Panel.tsx:15:11
    Panel.format — it does not read `this`, so move it out of the class — a module constant is built once
    rather than once per instance.
```

Whether the body reads `this` decides which of the two answers applies, so the report says which.

**It reads the source because nothing else can.** At runtime the two are the same thing: by the time
anything could look, the framework has written a bound function onto the instance under every
method's name — and a field holding `debounce(this.save, 200)` is a function there too. That one is
legitimate, because a wrapper cannot be written as a method. Only the source tells a function
LITERAL from a call that returns one, so only the source is checked.

A `static` field is not reported either: it exists once per class, so there is no per-instance cost
and nothing for binding to have done.

## Single-use decorators declared twice

Four of Ramonda's decorators answer a question that has one answer, and four more do nothing extra when
applied twice. Both are reported — and with different advice, because what the second declaration DOES
differs, and pointing a reader at the wrong thing is worse than pointing them at nothing:

| declared twice | what happens | what the report says |
|---|---|---|
| `@Host` | **throws** (`RMD045`) — two element names have no union | there is no live line to look for |
| `@catchError` · `@ShouldUpdateOnPropsChange` | one wins, the rest are dead code (`RMD032`, `RMD040`) | **which** one is live |
| `@StableProps` | both apply; the result is the union (`RMD046`) | nothing is lost, write it as one call |
| `@state` · `@compute` · `@persist` · `@memoizedHandler` | nothing at all | delete the extras |

```text
[ramonda-check] 2 class(es) declaring a single-use decorator twice:

  src/Panel.tsx:12:1
    <Panel> declares @catchError 2 times — there is one answer to what it asks, so the LOWEST is
    the one that runs (members initialise top to bottom, so it is applied last)
    and the rest never run. Keep one and combine what they do.

  src/Panel.tsx:19:3
    Panel.count carries @state 2 times — applying it twice changes nothing. The behaviour is
    identical to one, so this is a mistaken belief rather than a broken program. Delete the extras.
```

**Which declaration is live depends on the KIND of decorator, and the two are opposite.** One rule
underneath both: the last one APPLIED stands. A member decorator initialises top to bottom, so the
LOWEST is applied last; a class decorator applies bottom-up, so the HIGHEST is. Both directions are
measured in `@ramonda/core`'s own suite rather than reasoned about here.

**The count is per class for the first three rows and per MEMBER for the last.** A component with five
fields each carrying one `@state` is what every component looks like — counting that per class reported
`declares @state 5 times` against this repository's own documentation app.

A **subclass** declaring its own is never a duplicate. That is an override, which is how a role is
specialised, so only declarations on one class body are counted.

## A form field read by a component that does not watch it

A component handed a field and reading it directly **never re-renders**. Its message never appears,
and a write from anywhere else never reaches its input.

```text
[ramonda-check] 1 component(s) reading a form field they do not watch:

  src/TextField.tsx:9:23
    <TextField> reads `bind` from a field in its props, so it will
    never show a change to it — the component does not re-render at all.
```

Two deliberate things make it so, and neither is going to change. A field node is **one object for
the life of the form** — a fresh one per access means a fresh `bind.onInput` per access, which
`RMD020` reports — so the props diff has nothing to notice and skips the component. And a hook's
state belongs to whoever **used** the hook, so the form's counter wakes the form's owner and nobody
else.

The fix is the `Field` hook, which subscribes the component to that one path — and then a keystroke
wakes it and no other field:

```tsx
class TextField extends Component<{ of: FieldNode<string> }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));

  render() {
    return <input {...this.f.bind} />;
  }
}
```

**Only a READ is reported.** A component that writes through a field it was handed — `set` from a
click handler — is correct as written: writing needs no subscription, and whoever shows the value is
somebody else. A component that passes the field down without reading it is a layout, and is not
reported either. `path` and `name` are not reads: they are fixed for the life of the field.

**This one cannot be a runtime diagnostic at all**, which is why it is here. The form would have to
know who is rendering, and it cannot — nothing in the running page distinguishes "the owner is
reading its own field" from "a child is reading a field it will never hear about again".

## The graph

Every check above is one reading of the same thing: **which components exist, and which one can
mount which.** `--graph` writes it out.

```bash
$ ramonda-check tsconfig.json --graph .ramonda/graph.json
[ramonda-check] graph written to .ramonda/graph.json — 155 nodes, 64 edges, 3 of them unresolved
```

It holds facts, not conclusions — nodes and edges, each edge with the place it was written:

```json
{
  "from": "@ramonda/docs/src/DocPage.tsx#DocPage",
  "to": "@ramonda/core/src/base/AsyncLoad.ts#AsyncLoad",
  "kind": "renders",
  "via": "tag",
  "at": "@ramonda/docs/src/DocPage.tsx:69:7"
}
```

`kind` is what a walk reads — `renders`, `provides`, `consumes`, `uses`. `via` is how it was
written — a JSX tag, children of a wrapper, `list({ as })`, a route table, `AsyncLoad`'s `lazy`,
`bootstrap`. A component
is identified by its **declaration**, `<package>/<file>#<Name>`, because a name is not an identity:
one app in this repository declares `class Page` seventy-five times.

An edge that resolved to nothing is `"kind": "unresolved"`, and carries the reason:

```json
{
  "from": "playground-core/src/pages/FormPage.tsx#FormPage",
  "kind": "unresolved",
  "via": "use",
  "at": "playground-core/src/pages/FormPage.tsx:43:18",
  "why": "`Form` is declared in @ramonda/form/dist/index.d.ts, which this run does not read"
}
```

A blank left off the map is worse than no map, because it is trusted.

**A lazily loaded component is an edge like any other.** `lazy={() => import("./page")}` names a
module with a string literal, `namedExport` names the class, and both are read: the loader may sit
in the JSX, one hop away in a static field — which is where `RMD020` pushes it — or in a literal
registry indexed at runtime, which contributes the union of its values. What cannot be read is a
specifier built at runtime, and a bundler cannot split that either, so it was never going to be a
chunk. In the documentation site 76 of 140 edges arrive this way.

**A component handed over as a prop** is two halves that meet at the walk. A node declares which
prop paths take a component — a PATH, so a slot at depth five is the same mechanism as one at depth
one:

```json
"slots": ["view", "spec.columns[].cell", "spec.toolbar.right.inner"]
```

A call site records what it hands over, on the edge rather than on the node, because a binding
belongs to a call: `<Slot view={Reader} />` in one place and `<Slot view={Writer} />` in another are
two arrangements, and merging them would make each reachable from the other.

```json
{ "from": "app/src/Page.tsx#Page", "to": "@acme/ui/src/Slot.tsx#Slot", "kind": "renders",
  "via": "tag", "at": "app/src/Page.tsx:12:5",
  "binds": [{ "slot": "view", "to": "app/src/Reader.tsx#Reader" }] }
```

And the tag inside the library — `<this.props.view />` — is an edge with `"via": "slot"` naming the
prop it waits on. A walk arriving with a binding for that path fills it; one arriving without leaves
it a hole and says nothing.

Slots are read from the type as **syntax**. A prop typed as a rendered node is not a slot even
though a node carries a component class inside it, a mapped type is not read, and neither is a
function that returns a component: answering those means asking for a TYPE, and this resolver is on
symbols.

## A package's own graph

An installed package is a `.d.ts` and nothing else, and this reads source — so its components, its
hooks and the contexts they need used to vanish at the package boundary, silently. A package closes
that by publishing its own graph, and saying where it is:

```json
{ "name": "@acme/ui", "ramonda": { "graph": "./dist/graph.json" } }
```

Emit it in the package's build, after the declarations are written:

```bash
ramonda-check tsconfig.json --graph dist/graph.json
```

A package has no root, so its graph comes out with `"scope": "library"` — nothing in it can be
judged, because "unreachable" and "no provider above" are questions only whoever mounts it can
answer. What it carries is a **fragment**: its surface, marked `"exported": true`, and its
internals as well. That is the difference from a summary. A summary would say *DataGrid requires
Query* and the app would have to trust it; a fragment is spliced in and walked, so the report names
the real path:

```
  @acme/ui/src/index.tsx:13:7
    <PagedBody> consumes "Query" — nothing provides it on this path:
    App → Bare → DataGrid → PagedBody
```

`PagedBody` is a class the app cannot import and has never heard of.

**A stale fragment is refused, not trusted.** The fragment fingerprints the declaration file a
consumer actually sees — the source hash is no use to somebody who has `dist` and nothing else — so
a package rebuilt without regenerating its graph is reported and left out:

```
[ramonda-check] @acme/ui's graph describes a dist/index.d.ts that is no longer the installed one —
                the package was rebuilt without regenerating its graph
```

Emit it AFTER the declarations are written, or it fingerprints a file from the previous build.

A fragment also carries the package's version, because two versions of one package can be installed
at once: the node ids collide while the graphs differ.

The file is a **format**, versioned by `schema`, and it is written for tools rather than for people
to depend on: read it, do not build against it. `analyzeProject` returns the same structure as
`result.graph`.
