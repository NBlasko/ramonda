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
// package.json — the source before the bundler, the output after it
"scripts": {
  "build": "ramonda-check && vite build && ramonda-check-bundle dist"
}
```

A project scaffolded with `npm create ramonda` already has all of this.

## Two commands

`ramonda-check` reads your **source** and is what the rest of this page is about.

`ramonda-check-bundle` reads what your build **emitted**, and answers one question: can an engine
parse it? See [The bundle that did not parse](#the-bundle-that-did-not-parse).

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
- **`list(each, (item) => <Row item={item} />)`** — `Row` renders where the list sits.
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

## Adding a rule

A rule is a CLAIM, and the claim has to survive more shapes than the one it was written against.

`.claude/skills/writing-a-static-rule/SKILL.md` is the list, and every entry on it is there because
it found a real gap. The first time the whole ladder was run against one rule — a value one line up,
a helper in another file, a helper calling a helper, an arrow helper, a cast, a ternary arm, a `??`
fallback, a spread, a per-row callback — it found **nine**, in a rule that already had tests, a
fixture and a documented boundary.

The method is one sentence: **plant the shape, then measure**. Never read the code and reason about
it. A rule that reports nothing looks exactly like a clean codebase, so a gap costs nothing to ship
and is invisible afterwards.

`src/rules/follow-value.ts` is the walk that answers most of the list — it goes to the DECLARATION
behind a name, never to its type, which is what keeps this package's promise while still reaching a
value written somewhere else. `src/__tests__/one-hop-away.test.ts` is the standing inventory of the
rules that do not use it yet.

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

## The bundle that did not parse

`@state`, `@compute` and the rest are TC39 decorators. No engine can parse them, so a bundler that
does not transform them away emits a file that dies with `SyntaxError: Invalid or unexpected token`
the moment a browser reads it — not at build time, not in a test, but on the first page load.

That shipped here once. It had been working by accident: an unrelated esbuild option was forcing
every module through the transform that strips them, and removing that option broke the output in
silence. The setting that actually decides it is `target`, and `esnext` — which reads like a
modernisation — is the one value that leaves the decorators in.

```bash
$ ramonda-check-bundle dist

[check-bundle] 1 of 42 emitted file(s) do not parse:

  dist/assets/index-Bq7xk.js
    SyntaxError: Invalid or unexpected token
```

It **parses** rather than grepping for `@`, and that distinction is the whole design. A grep is
weaker, because a decorator is only one way to emit unparseable output. And it is wrong, because a
bundle may legitimately contain decorator text inside a string — Ramonda's own diagnostics put
`@Host("div")` in a suggestion message, so it appears in any bundle that ships them. A parser does
not care what is inside a string.

`node --check` does the parsing, on purpose: the failure being guarded against is "no engine can
read this", and that is the engine.

Point it at directories or files, as many as you like; it walks directories and looks at every
`.js`, `.mjs` and `.cjs`. Finding no JavaScript at all is a failure rather than a pass, because a
build that silently emitted nothing is the same shape of bug.

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

## A declaration no root reaches

The first check computed from the graph rather than from the source — and it needed no new pass over
your code, which is the argument for having a graph at all. The walk already visits everything a root
mounts, so what it never arrived at is what nothing mounts:

```
[ramonda-check] 1 declaration(s) no root reaches:

  src/Orphan.tsx:4:1
    Orphan — nothing mounts this component, on any path from any root.
```

**Only what it can prove.** An EXPORTED one is never reported: an app is entered through what it
publishes, and an SSR entry is called by the server rather than by your program. What is reported is
a declaration nothing outside its own file can even name, that no root reaches — dead with no room
for argument. A hook a reached component uses is not dead, though a hook mounts nothing; and another
package's internals are its own business, not your app's.

A library is not judged at all. With no root, everything in it is unreachable by definition.

## A component named among children

```
[ramonda-check] 1 component(s) named among children, where an element was meant:

  src/Panel.tsx:12:10
    {Reader} renders nothing. Write <Reader />.
```

Measured in core: `{Named}` renders **nothing** and no diagnostic is emitted — a class is a function,
so the check for an object among children that is not markup never sees it, and the page comes up
without the component. Nothing legitimate has this shape; handing a component over is an attribute,
and `<Slot view={Named} />` is a binding rather than a child.

## A ring of mounts nothing can skip

```
[ramonda-check] 1 ring(s) of mounts that nothing can skip:

  src/Loop.tsx:4:1
    Loop → Half → Loop
```

A cycle by itself is not a fault: a tree renders itself for each child and stops when the data runs
out, which is how a recursive structure is drawn. What cannot be right is a ring where **every step
runs on every render** — no branch, no callback, no loop anywhere on it. Nothing can stop, so the
first render recurses until the stack gives out, before a page appears.

Every edge carries `always` when the site was proven to run on every render, and the flag is absent
otherwise — so a site this could not read can never invent a fault.

## A second provider where the author allows one

```
[ramonda-check] 1 second provider(s) for a context that allows one:

  src/Panel.tsx:12:1
    <Panel> mounts a second "Route", and one is already above it:
    App → Shell → Panel
```

Nesting is ordinary — a second Provider shadows the first and the nearer one wins, which is what a
theme override inside a panel is. `createContext(…, { single: true })` is how an author says this one
is different: two Routers both listen to `popstate` and both write history, so the second is a
conflict rather than a narrower scope. The runtime throws when it happens; this says the same thing
before anything renders, on every path your source can produce.

## A route table whose views can never appear

```
[ramonda-check] 1 route table(s) whose views can never appear:

  src/routes.ts:29:1
    2 view(s), and no <RouteOutlet> in this build is handed this table.
```

Two ways to get there, and they are fixed differently: nothing hands the table to a `<RouteOutlet>`
at all, or an outlet does and no root reaches that outlet. Either way every page in it renders
nothing — and each page on its own looks perfectly well formed, which is why nothing else says a
word. A whole section of a site can be gone without one error anywhere.

The pages themselves are not reported as dead code: a page is exported, and an exported declaration
is a way in.

## The browser's URL, where the router knows it

A component that reads `window.location` in a project with a router is asking the browser a
question its own router already answers:

```
[ramonda-check] 1 component(s) reading the browser's URL, not the router's:

  src/Article.tsx:31:20
    <Article> reads `window.location.hash` — the router answers this with `hashTags`.
```

The two are the same fact from two sources, and only one is reactive: read from the router, a
component re-renders when the route moves; read from `window`, it is a snapshot taken once and
never corrected, so the page quietly goes out of date. The router also keeps a distinction the URL
hands over as one string — `#tab=film` is route state and `#a-section` names an element, so a hash
tag with a `value` is the first and one without is the second.

**Only where there is a router.** Without one, `location` is the only place the answer lives, and a
rule that reports the only thing you could have written is a rule people switch off. A local
variable called `location` is not the global either, and telling them apart costs no type: this
runs with no lib, so the browser's name resolves to nothing while yours resolves where you wrote it.

This is a **warning** today and an error in a later version, which is the rule for adding a rule
here.

## Rendering, done imperatively

A component that writes a class, an attribute or a piece of text onto the document is keeping a
**second copy** of state it already holds:

```
[ramonda-check] 1 component(s) writing the document instead of rendering it — 2 writes:

  src/App.tsx:96:5
    <App> writes `document.documentElement.classList.toggle`.
  src/App.tsx:101:5
    <App> writes `document.body.style.overflow`.
```

That copy has to be kept in step by hand, cleaned up when the component goes away, and remembered
by whoever adds the next handler that touches the same state. Say it in `render()` instead and let
the stylesheet read it — `html:has(.drawer-open)` reaches the document from a class a descendant
renders, so even the page itself can be styled from state the component owns.

**A COMMAND is not this, and the difference is the whole rule.** `scrollIntoView()`, `focus()`,
`select()` and `getBoundingClientRect()` have no declarative form: they tell the browser to do
something rather than describing what it should look like. They are never reported.

Nor is an element you made yourself — `document.createElement("style")` and then filling it in is
your own element — or one held in a `ref`. What is reported is the document, its `body`, its
`documentElement`, and whatever a global query hands back: elements the component did not render.

This is a **warning** today and an error in a later version.

## A component it cannot follow is an error

The walk goes quiet below a name it cannot resolve, so everything under that name is unjudged and a
build passes over a page that may be broken. A map with unmarked blanks is worse than no map,
because it is trusted:

```
[ramonda-check] 1 place(s) naming a component that cannot be followed:

  src/App.tsx:26:9
    through `tag` — `Alias` resolves to VariableDeclaration, not to a component class

      import { TheComponent } from "./the-module";
      <TheComponent />
      // ramonda-check-ignore <why this cannot be resolved>
```

The constraint is not this tool's to impose. **A bundler can only split what it can see
statically** — whatever this cannot resolve, a bundler could not have code-split either, so the
shape was already trouble for another reason.

When the source is right and this is the one that cannot see it, write the reason on the line:

```tsx
class Row extends Component {
  render() {
    return <li>row</li>;
  }
}

const rows = { "/": Row };

// ramonda-check-ignore the table is keyed at run time, and every value is a component
const Chosen = rows["/"];
```

**Line-scoped, never file-scoped**, and the reason is mandatory — a directive with nothing after it
is refused, because a suppression without a reason is a silence. Every annotated site is listed on
every run, whether or not anything failed, so the number cannot creep up unread.

A tag naming a PROP — `<this.props.view />` — is not one of these. It is unresolvable from the class
alone by design: the caller decides, and the walk fills it from what the caller binds.

**Nor is a PARAMETER, which is the same promise through a different door.** A function handed a
component and asked to mount it knows no more than a component handed one in a prop:

```ts
function __h(type: unknown, props: unknown): unknown {
  return { type, props };
}

// The shape a JSX runtime is: whatever the compiler wrote is what gets mounted.
function jsx(type: unknown, props: unknown): unknown {
  return __h(type, props); // waits on `type`
}
```

That is an edge naming what it waits on — `"via": "parameter", "slot": "type"` — rather than a blank
that says nothing. A path works the same way at any depth (`options.wrapper`), a cast is seen
through, and `this.use(hook)` makes the same promise about a hook.

**Its own `via`, and not a flag on the slot one.** A prop edge is FILLED from what a JSX call site
binds; a parameter must never be, because the two live in different namespaces. A package whose
`Frame.show(view)` mounts its own argument, spliced into an app that writes `<Frame view={Foo} />`,
would otherwise have `Foo` judged under `Frame` — a verdict on a mount nobody wrote.

Two shapes near it are **not** this, because reading either means running something: what a **call**
returns (`bootstrap(wrap(ui), container)`), and whatever a **local binding** was last assigned
(`const tag = …; __h(tag, …)`). Those stay holes and want a written reason.

The site goes silent; it does not become transparent. A component whose hook came from a parameter
may be providing anything, so nothing beneath it is judged — but it is still walked, because what it
mounts is written in its body.

## Where a tree starts

`bootstrap` and `hydrateRoot` in the browser, `renderToString`, `renderPage` and `renderStatic` on
the server. All five are handed a component and render it, so all five are roots.

**An app entered only from a server is judged like any other**, and leaving the server's three out
made it pass in silence. The same file, one line different:

```
bootstrap(<App />, null)     <Reader> consumes "Theme" — nothing provides it on this path
renderToString(<App />)      0 root(s) — every consumer has a provider above it
```

The second sentence was never checked. With no root the walk has nowhere to start, the project is
taken for a library, and a library is judged not at all.

An entry is called **by its own name**. A component method that happens to share one —
`this.renderPage(row)`, which builds the markup for one row of data — is not an entry, and reading
it as one would make a root out of a row.

## The graph

Every check above is one reading of the same thing: **which components exist, and which one can
mount which.** `--graph` writes it out.

```bash
$ ramonda-check tsconfig.json --graph .ramonda/graph.json
[ramonda-check] graph written to .ramonda/graph.json — 161 nodes, 255 edges, 7 of them unresolved
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

`kind` is what a walk reads — `renders`, `provides`, `consumes`, `uses`, `calls`. `via` is how it was
written — a JSX tag, children of a wrapper, a route table, `AsyncLoad`'s `lazy`, `bootstrap`. A
list's rows need nothing of their own: the row's tag is written in the component the list sits in,
which is where it mounts. A component
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

**JSX written outside a component class** is an edge too. `function row() { return <Cell /> }` mounts
`Cell` wherever it is called, so the function is a node of its own — `"kind": "helper"` — owning the
tags it writes, with a `calls` edge from every component that reaches it. Nothing has to be followed
to work that out: the tag is written in the helper, so the edge is read where it is. A route table
and a `bootstrap` argument are not helpers; they are read where they are written, and counting them
twice would give one mount two owners.

**A lazily loaded component is an edge like any other.** `lazy={() => import("./page")}` names a
module with a string literal, `namedExport` names the class, and both are read: the loader may sit
in the JSX, one hop away in a static field — which is where `RMD020` pushes it — or in a literal
registry indexed at runtime, which contributes the union of its values. What cannot be read is a
specifier built at runtime, and a bundler cannot split that either, so it was never going to be a
chunk. In the documentation site 76 of 255 edges arrive this way.

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

## What loads when

A bundler splits at a dynamic import and nowhere else, so the graph splits at a `lazy` edge and
nowhere else. `--split` reads it that way:

```bash
$ ramonda-check tsconfig.json --split

[ramonda-check] what loads when — @ramonda/docs

  before anything      16 declaration(s) in 8 file(s)
  loaded on demand     76 split point(s)
  shared between them  55 declaration(s)

  split point                                          reach  already  shared  its own
  Page  src/generated/pages/composition-children.ts       62        6      55        1
  Page  src/generated/pages/composition-context.ts        62        6      55        1
  …
```

The three counts partition what a chunk reaches, and each is a different claim. **already** is in
the first payload, so arriving here costs nothing. **shared** is reached by another split point too,
so a bundler puts it in a chunk they both pull in and it is downloaded once. **its own** is what
this one alone pays for. Collapsing any two of them reports a page as expensive when it is free.

A file is named beside every component, because a name is not an identity: the site above declares
`class Page` seventy-six times.

**It counts declarations, never bytes.** Nothing here has weighed a bundle — a declaration is not a
size and a file holds more than the declarations in this graph. For kilobytes, ask the bundler.

**Routes are deliberately not the unit.** Measured on this repository: one app imports all eleven of
its pages statically, so every one is in the first payload and opening a route downloads nothing;
another builds its route table in a loop, so no route in it has a URL this could name. The unit is
where the code actually splits.

## What a change moved

`--diff` compares this run against a graph written earlier:

```bash
$ ramonda-check tsconfig.json --diff .ramonda/main.json

[ramonda-check] against .ramonda/main.json — @ramonda/docs

  nodes  +0  -0        edges  +1  -0
  before anything: 16 → 72 declaration(s) (+56)

  56 in the first payload now, and not before:
    ErrorBoundary — @ramonda/core/src/base/ErrorBoundary.ts:16:1
    CodeBlock — @ramonda/docs/src/CodeBlock.tsx:29:1
    …
```

That run is one added import line. Nothing in a diff of the source says what it costs: the line is
in one file and the download is paid somewhere else entirely.

Identity leaves the **line** out on both sides — a node id already does, and an edge is compared on
`from → to (kind/via)`. Insert a line near the top of a file and nothing below it has moved. A graph
of a different package, scope or schema is refused rather than subtracted.

Both flags describe. Neither fails a build.

## A package's own graph

An installed package is a `.d.ts` and nothing else, and this reads source — so its components, its
hooks and the contexts they need used to vanish at the package boundary, silently. A package closes
that by publishing its own graph, and saying where it is:

```json
{ "name": "@acme/ui", "ramonda": { "graph": "./dist/ramonda-graph.json" } }
```

Emit it in the package's build, after the declarations are written:

```bash
ramonda-check tsconfig.json --graph dist/ramonda-graph.json
```

**The path is declared, never guessed**, so any name works and a package already built to another
one keeps working. The name above is the convention for a reason worth stating: this file is
published. It sits in a stranger's `node_modules/@acme/ui/dist/` beside whatever their bundler
wrote, where `graph.json` says neither whose it is nor what it is for. An app writing its own graph
has no such problem — it picks the path, and nobody else ever reads the file.

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

**A graph describes what a project ships**, so test files are left out: `__tests__/`, `test/`,
`tests/`, `*.test.*` and `*.spec.*`, judged relative to the directory holding the tsconfig. A test's
`bootstrap` is not the app's root, and a class written to be checked is not one the package
publishes. A library's fragment is also pruned to its own package — an app splices one fragment per
package, and an edge pointing into another one still resolves, because the id is the same on both
sides.

A fragment also carries the package's version, because two versions of one package can be installed
at once: the node ids collide while the graphs differ.

The file is a **format**, versioned by `schema`, and it is written for tools rather than for people
to depend on: read it, do not build against it. `analyzeProject` returns the same structure as
`result.graph`.
