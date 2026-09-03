---
title: Checking your app
description: ramonda-check reads your source and proves what a running page would not tell you; ramonda-check-bundle reads what your build emitted.
section: Reference
order: 112
---

# Checking your app

A context that has no provider above it does not crash. The consumer falls back to the default, the
page renders, and someone reads a number that was never real. The framework reports it
([`RMD003`](/reference/diagnostics/rmd003)) — but only once that component actually mounts.

That is the gap. A panel behind a condition nobody clicked, a page in a chunk nobody opened: the
fault ships, and nothing has said a word. The commonest way to get there is a **reorder** — the
provider moves up or down a level, the consumer stays where it was, and everything still looks
fine.

`@ramonda/check` closes it from the other side: it reads your source and **proves** the provider is
above the consumer, before anything runs.

```bash
npm add -D @ramonda/check
```

```jsonc
// package.json — the source before the bundler, the output after it
"scripts": {
  "build": "ramonda-check && vite build && ramonda-check-bundle dist"
}
```

A scaffolded project (`npm create ramonda`) already has all of this. The package installs two
commands: `ramonda-check`, which reads your **source** and is what most of this page is about, and
[`ramonda-check-bundle`](#the-bundle-that-did-not-parse), which reads what your build **emitted**.

## What it looks like

```
$ ramonda-check

[ramonda-check] 2 consumer(s) with no provider above them:

  src/pages/Account.tsx:14:9
    <Account> consumes "Session" — nothing provides it on this path:
    App → Layout → Account

Mount the matching Provider on a component above it — a context reaches only the providing
component and its descendants.
```

It names the file, the line, and **the path** — which is the part that tells you where the provider
has to go.

When everything is connected it says so and exits zero:

```
[ramonda-check] 68 components, 4 contexts, 1 root(s) — every consumer has a provider above it.
```

## What it can see

It starts from each `bootstrap(<App />)` / `hydrateRoot(<App />)` and walks down, carrying the set
of contexts provided so far. It follows:

- **JSX** in your components — including children: `<Shell><Reader /></Shell>` puts `Reader` under
  `Shell`, because `Shell` is what decides where its children mount. A provider on `Shell` covers
  them.
- **[`list()`](/lists)** — `list(each, (item) => <Row item={item} />)` renders `Row` where the list sits.
- **[Route tables](/routing)** — the views in `createRoutes` hang under the `<RouteOutlet>` that
  renders them, which is also what publishes the matched params.
- **Contexts a hook carries** — `this.use(Router)` provides the route context because `Router`
  itself provides it. A hook built out of hooks resolves too.

## What it stays quiet about — on purpose

**It reports only what it can prove.** If it cannot resolve something — a component picked out of a
variable or a registry, a hook chosen at runtime — it goes quiet for that path rather than guess.

That is what makes it safe to put in a build. A checker that cries wolf gets removed; this one's
reports are real broken paths, never maybes. The cost is honest: a fully dynamic composition is not
checked, and neither is context that reaches a component only through a third-party hook's internals.

It also honours [`optional`](/composition/context#when-the-default-is-a-real-answer): a context whose
author declared its default a real answer is never reported here either. The two checks agree on
purpose — a build that fails on what the app is documented to do is worse than no check at all.

## The two checks, and where each one bites

They are not alternatives — each catches what the other cannot.

| | when it speaks | catches |
|---|---|---|
| `ramonda-check` | before the app runs | every path it can prove, exercised or not |
| [`RMD003`](/reference/diagnostics/rmd003) | when the component **mounts** | dynamic composition the checker cannot resolve |

The static one is the only one that can speak about a branch nobody has opened yet. The runtime one
is the only one that sees a tree assembled at runtime.

## Everything it reports

The provider check is what the tool exists for, but it is not the only thing the walk can see —
once the graph is built, several other questions are free to ask.

### What the graph itself answers

These come from the composition graph rather than from any one file, and every one of them fails
the run.

| | reported when |
|---|---|
| A consumer with no provider above it | the whole reason above |
| A place naming a component that cannot be followed | resolution failed and no reason was written beside it |
| A declaration no root reaches | nothing mounts it, from any entry point |
| A route table whose views can never appear | the table is built but its outlet is unreachable |
| A second provider for a context that allows one | `createContext(…, { single: true })` — only `Router` sets it |
| A ring of mounts that nothing can skip | A mounts B mounts A, with no lazy boundary to break it |
| A component named among children | `{Panel}` where `<Panel />` was meant — also [`RMD052`](/reference/diagnostics/rmd052) |

### The rules

Each of these is one file in the checker, and each answers for itself: its id is the key in
`findings`, and it is the name the command prints. The two tables below are **generated from the
rules**, so a rule cannot be added without appearing here.

[rules:start]: # "generated by scripts/build-rule-tables.mjs — edit the rule, not this"

**Errors.** These fail the run. 9 of them.

| rule | reported when |
|---|---|
| [`props-written-by-the-receiver`](/rules/props-written-by-the-receiver) | a component or hook assigns to its own `props` — the write throws in every build, and the value belonged to whoever rendered the element — also [`RMD004`](/reference/diagnostics/rmd004), [`RMD015`](/reference/diagnostics/rmd015) |
| [`compute-takes-no-arguments`](/rules/compute-takes-no-arguments) | a `@compute` declares a parameter, and its cache is keyed by nothing so the argument is ignored |
| [`async-render`](/rules/async-render) | `render()` is `async`, so it returns a promise where the diff expects markup — also [`RMD060`](/reference/diagnostics/rmd060) |
| [`arrow-fields`](/rules/arrow-fields) | a class field holds a function literal, so every instance builds a fresh one and props comparison can never match |
| [`duplicate-decorators`](/rules/duplicate-decorators) | a single-use decorator is written twice: `@catchError`, `@ShouldUpdateOnPropsChange` or `@StableProps` — also [`RMD032`](/reference/diagnostics/rmd032), [`RMD040`](/reference/diagnostics/rmd040), [`RMD046`](/reference/diagnostics/rmd046), [`RMD050`](/reference/diagnostics/rmd050) |
| [`unwatched-fields`](/rules/unwatched-fields) | a component reads a form field it does not watch, so it never re-renders when that field changes |
| [`one-provider-per-component`](/rules/one-provider-per-component) | one component mounts two Providers of the same context, which core refuses at runtime — also [`RMD056`](/reference/diagnostics/rmd056) |
| [`server-env-in-shared-code`](/rules/server-env-in-shared-code) | `process.env` is read from a member the browser also runs, where `process` does not exist |
| [`fresh-value-from-a-watch-selector`](/rules/fresh-value-from-a-watch-selector) | a `@watchProp` selector builds the value it returns — an object or an array — so `Object.is` can never match it and the watcher fires on every props change with nothing changed |

**Warnings.** These print and the run still passes. 76 of them.

| rule | reported when |
|---|---|
| [`state-written-while-rendering`](/rules/state-written-while-rendering) | a state write is reached from `render()` or a `@compute` — directly, through a helper it calls, or three files away — also [`RMD001`](/reference/diagnostics/rmd001), [`RMD018`](/reference/diagnostics/rmd018) |
| [`state-mutated-in-place`](/rules/state-mutated-in-place) | a `@state` array or object is changed in place — `this.items.push(…)`, `this.user.name = …` — so the signal never fires — also [`RMD005`](/reference/diagnostics/rmd005), [`RMD048`](/reference/diagnostics/rmd048) |
| [`decorator-that-adds-nothing`](/rules/decorator-that-adds-nothing) | two decorators on one member give it the same thing — `@persist` beside `@state`, or one written twice — also [`RMD050`](/reference/diagnostics/rmd050) |
| [`unkeyable-memoized-argument`](/rules/unkeyable-memoized-argument) | a `@memoized` is called with — or declared to take — something a cache key cannot hold: a key holds a string, a number or a boolean — also [`RMD047`](/reference/diagnostics/rmd047) |
| [`clock-read-while-rendering`](/rules/clock-read-while-rendering) | `Date.now()`, `new Date()` or `Math.random()` is reached from a render, by any path — also [`RMD021`](/reference/diagnostics/rmd021) |
| [`cached-read-of-a-plain-field`](/rules/cached-read-of-a-plain-field) | a `@compute` or a hook's props callback reads an ordinary field that is written after the first render, so the cached value goes stale — also [`RMD027`](/reference/diagnostics/rmd027) |
| [`browser-url`](/rules/browser-url) | a component reads `window.location` in a project whose router already holds the answer |
| [`dom-writes`](/rules/dom-writes) | a component writes the document — `document.body.classList.add(…)` and its family — where `render()` could have said it |
| [`watch-of-a-prop-that-is-not-there`](/rules/watch-of-a-prop-that-is-not-there) | a `@watchProp` selector names something the component's props type does not declare, so the method never runs |
| [`persist-of-a-lossy-value`](/rules/persist-of-a-lossy-value) | a `@persist` field holds a `Map`, a `Set`, a `Date`, a function or a class instance, none of which JSON carries — also [`RMD033`](/reference/diagnostics/rmd033) |
| [`unserializable-state`](/rules/unserializable-state) | a `@state` field holds a `Map`, a `Set`, a `Date`, a function or a class instance, and the project renders on a server — also [`RMD019`](/reference/diagnostics/rmd019), [`RMD033`](/reference/diagnostics/rmd033) |
| [`interval-with-no-cleanup`](/rules/interval-with-no-cleanup) | a component starts a raw `setInterval` whose id nothing ever clears, so it keeps firing after unmount — also [`RMD006`](/reference/diagnostics/rmd006) |
| [`listener-added-by-hand`](/rules/listener-added-by-hand) | a component adds a `window` or `document` listener by hand, where `@onWindow` or `@onDocument` would do it — or, inside `if (__DEV__)` where a decorator cannot be used, adds one that nothing ever removes |
| [`late-request-read`](/rules/late-request-read) | `requestContext()` is read below an `await`, after the request it names is gone — also [`RMD053`](/reference/diagnostics/rmd053) |
| [`head-tags-collide`](/rules/head-tags-collide) | two tags in one `Head` resolve to the same identity, so only the second is written |
| [`unguarded-async-lifecycle`](/rules/unguarded-async-lifecycle) | an `async` lifecycle awaits something with no `try` or `.catch` to handle a failure — also [`RMD059`](/reference/diagnostics/rmd059) |
| [`context-consumed-above-its-provider`](/rules/context-consumed-above-its-provider) | a component consumes a context on a line above the Provider that publishes it, so the consumer reads an ancestor's value — also [`RMD057`](/reference/diagnostics/rmd057) |
| [`client-only-request-read`](/rules/client-only-request-read) | a `requestContext()` read is on a path that only runs in the browser, where the value it names is never available — also [`RMD025`](/reference/diagnostics/rmd025) |
| [`fresh-object-in-hook-props`](/rules/fresh-object-in-hook-props) | a hook — a context Provider above all — is handed an object or array built inside its props callback, where the callback also reads something reactive, so the value is rebuilt and every consumer of that key wakes with contents that did not change — also [`RMD022`](/reference/diagnostics/rmd022) |
| [`unsplittable-import`](/rules/unsplittable-import) | a dynamic import's path is neither a literal nor a template a bundler can read, so no chunk is emitted for it |
| [`unexposed-env-read`](/rules/unexposed-env-read) | `import.meta.env` is read for a name `@ramonda/build` does not expose, so the value reads `undefined` |
| [`row-reads-a-plain-field`](/rules/row-reads-a-plain-field) | a `list()` row callback puts a field nothing can track into the markup, so a reused row keeps the old value |
| [`dev-guard-as-an-expression`](/rules/dev-guard-as-an-expression) | a `__DEV__` guard is written as `&&` or `?:` where an `if` would do the same thing |
| [`lens-path-through-a-gap`](/rules/lens-path-through-a-gap) | a `focusOn` write walks through a hop the types say may be `null` or `undefined`, which only the LAST hop creates — also [`RML001`](/reference/diagnostics/rml001) |
| [`duplicate-key-among-siblings`](/rules/duplicate-key-among-siblings) | two children written side by side claim the same literal `key` — also [`RMD002`](/reference/diagnostics/rmd002) |
| [`row-without-a-key`](/rules/row-without-a-key) | a row built by `map` or by `list()` has no `key` — also [`RMD023`](/reference/diagnostics/rmd023), [`RMD051`](/reference/diagnostics/rmd051) |
| [`index-as-key`](/rules/index-as-key) | a row's `key` is built from the `.map` index and nothing else, which is the identity the diff already had — also [`RMD023`](/reference/diagnostics/rmd023) |
| [`class-instead-of-classname`](/rules/class-instead-of-classname) | an element carries `class` where Ramonda reads `className` — also [`RMD039`](/reference/diagnostics/rmd039) |
| [`tag-needs-its-parent`](/rules/tag-needs-its-parent) | a tag is written outside the parent it requires — `<tr>` with no table above it, `<option>` with no select — also [`RMD028`](/reference/diagnostics/rmd028) |
| [`parent-with-a-foreign-child`](/rules/parent-with-a-foreign-child) | a container whose children are fixed by the content model holds a tag that is not one of them — also [`RMD028`](/reference/diagnostics/rmd028) |
| [`interactive-inside-interactive`](/rules/interactive-inside-interactive) | an interactive element is nested inside another of the same kind: a link in a link, a button in a button, a form in a form |
| [`unnamed-image`](/rules/unnamed-image) | an `img`, `area`, image `input` or empty `object` has no `alt`, `aria-label`, `aria-labelledby` or `title` |
| [`unknown-aria-attribute`](/rules/unknown-aria-attribute) | an `aria-*` attribute is not a name the ARIA specification has |
| [`unknown-role`](/rules/unknown-role) | a `role` names nothing, or names an abstract role that markup may not use |
| [`role-missing-required-aria`](/rules/role-missing-required-aria) | an explicit `role` is written without the `aria-*` its specification requires |
| [`role-takes-no-name`](/rules/role-takes-no-name) | an `aria-label` or `aria-labelledby` is written on a role the specification forbids naming |
| [`region-with-no-name`](/rules/region-with-no-name) | `role="region"` is written with no `aria-label`, `aria-labelledby` or `title`, so it is not a landmark at all |
| [`false-on-a-boolean-attribute`](/rules/false-on-a-boolean-attribute) | a boolean attribute is written `"false"`, which turns it ON because the parser reads only that it is there — also [`RMD029`](/reference/diagnostics/rmd029) |
| [`misspelled-element-property`](/rules/misspelled-element-property) | a name is written in the wrong case for element state that lives only in a property, so it is written as an attribute nothing reads |
| [`half-built-keyboard-path`](/rules/half-built-keyboard-path) | an element with an interactive `role` and a pointer handler is missing the `tabIndex` or the key handler that would finish it |
| [`element-html-removed`](/rules/element-html-removed) | a tag HTML has removed is written, so nothing defines what it means |
| [`option-that-cannot-choose`](/rules/option-that-cannot-choose) | `selected` is written on an `<option>` inside a `<Select>`, which sets it from `value` instead |
| [`aria-value`](/rules/aria-value) | an `aria-*` attribute carries a literal value its specification does not permit |
| [`aria-with-no-subject`](/rules/aria-with-no-subject) | a `role` or an `aria-*` sits on an element with no accessibility tree node to describe |
| [`empty-heading-or-link`](/rules/empty-heading-or-link) | a heading or a link has nothing inside it to announce |
| [`unnamed-frame`](/rules/unnamed-frame) | an `iframe` has no `title` |
| [`positive-tabindex`](/rules/positive-tabindex) | a `tabIndex` is above zero, which reorders the whole document rather than one element |
| [`aria-hidden-on-focusable`](/rules/aria-hidden-on-focusable) | `aria-hidden="true"` is written on an element a keyboard can still focus |
| [`aria-hidden-around-something-focusable`](/rules/aria-hidden-around-something-focusable) | `aria-hidden="true"` wraps something a keyboard can still tab to |
| [`presentation-role-on-focusable`](/rules/presentation-role-on-focusable) | `role="presentation"` is written on an element a keyboard can still focus, where the role is ignored |
| [`aria-state-with-no-role`](/rules/aria-state-with-no-role) | an `aria-*` belonging to a role is written on an element that has no role |
| [`aria-state-the-role-does-not-have`](/rules/aria-state-the-role-does-not-have) | an `aria-*` sits beside a `role` that does not support it, so nothing exposes it |
| [`aria-that-contradicts-the-tag`](/rules/aria-that-contradicts-the-tag) | an `aria-*` is written `false` beside the HTML attribute that says the opposite |
| [`role-that-fights-the-tag`](/rules/role-that-fights-the-tag) | a `role` says the element behaves in a way the tag does not — a link as a button, or a button as a link |
| [`live-region-that-contradicts-its-role`](/rules/live-region-that-contradicts-its-role) | an `aria-live` replaces the politeness the element's role already carries |
| [`autocomplete-that-fills-nothing`](/rules/autocomplete-that-fills-nothing) | an `autocomplete` value names no autofill field, so the browser ignores it entirely |
| [`label-that-names-nothing`](/rules/label-that-names-nothing) | a `<label>` has no `htmlFor` and no control inside it, so it labels nothing |
| [`table-with-no-headers`](/rules/table-with-no-headers) | a `<table>` written out with data rows has no `<th>` anywhere in it |
| [`link-without-a-destination`](/rules/link-without-a-destination) | an `<a>` has no `href`, or one that goes nowhere — empty, `#`, or `javascript:` |
| [`fresh-object-in-props`](/rules/fresh-object-in-props) | a component is handed an object or array built during the render, so it is a new value every time and comparison can never match — lift it to a field or a `@compute`, or declare it on the child with `@StableProps` |
| [`function-built-in-the-markup`](/rules/function-built-in-the-markup) | a function literal is written into a JSX attribute — in the attribute, on one side of a ternary or a `??`, or in a local one line up — so its identity is fresh every render, and the listener is removed and re-added or the child can never compare its prop equal — also [`RMD020`](/reference/diagnostics/rmd020) |
| [`object-among-the-children`](/rules/object-among-the-children) | a plain object is written among an element's children, where the runtime drops it and the page renders without it — also [`RMD037`](/reference/diagnostics/rmd037) |
| [`function-used-as-a-tag`](/rules/function-used-as-a-tag) | a plain function is written in tag position, where it names nothing the framework can construct — and the compiler only refuses the shapes that do not return exactly one element — also [`RMD011`](/reference/diagnostics/rmd011) |
| [`click-with-no-keyboard-path`](/rules/click-with-no-keyboard-path) | a click handler sits on a non-interactive element with no key handler, no `tabIndex`, no `role` and nothing interactive inside it |
| [`access-key`](/rules/access-key) | an `accessKey` is written, which overrides a shortcut the reader's own software may be using |
| [`attribute-that-does-nothing`](/rules/attribute-that-does-nothing) | one of six camelCase names — `httpEquiv`, `acceptCharset`, `defaultValue`, `defaultChecked`, `innerHTML`, `textContent` — reaches the DOM as itself, where no browser reads it |
| [`media-with-no-captions`](/rules/media-with-no-captions) | a `video` or `audio` element carries no `<track>`, so nothing on the page says what is in it |
| [`duplicate-id`](/rules/duplicate-id) | two elements in one render carry the same literal `id`, and both are always present |
| [`heading-skips-a-level`](/rules/heading-skips-a-level) | a heading is more than one level below the heading before it, both written in the same render |
| [`more-than-one-main`](/rules/more-than-one-main) | one render has more than one `main` landmark, where HTML allows one |
| [`landmarks-that-cannot-be-told-apart`](/rules/landmarks-that-cannot-be-told-apart) | one render has two or more landmarks of the same kind and none of them is named |
| [`lazy-imports-that-collide`](/rules/lazy-imports-that-collide) | two `lazy` functions are written identically but name different modules — the module cache is keyed by the function's source, so one entry has to serve both — also [`RMD049`](/reference/diagnostics/rmd049) |
| [`fragment-link-to-nowhere`](/rules/fragment-link-to-nowhere) | an `href="#name"` points at an id no element in the project carries |
| [`reference-to-an-id-that-is-not-there`](/rules/reference-to-an-id-that-is-not-there) | an `aria-labelledby`, `htmlFor` or other id reference names an id no element in the project carries |
| [`control-with-no-label`](/rules/control-with-no-label) | a form control has no label, no `aria-label`, no `aria-labelledby` and no `title`, so nothing says what it is for |
| [`named-only-by-a-placeholder`](/rules/named-only-by-a-placeholder) | a form control's only name is its `placeholder`, which disappears as soon as anybody types |

[rules:end]: #

The declarative answer to the document writes is on its own page:
[reaching the document](/composition/document). A *command* — `scrollIntoView()`, `focus()`,
`getBoundingClientRect()` — has no declarative form and is never reported.

### Why a rule arrives as a warning first

A new rule prints for one version and refuses in the next. A rule that is wrong about your code is
a rule you switch off, and switching one off is how a whole tool stops being run — so a rule gets a
version in the open, against real projects, before it is allowed to fail a build.

Every rule above was measured against every app and package in the Ramonda repository when it was
written. **All but one report zero.** That is the bar, and it is deliberately hard to
clear: a rule that already has something to say about correct code is not ready.

The exception is worth naming, because a bar with an unexplained exception is not a bar. **A row
built by `list()` with no `key` is reported, and there are seventeen of them here.** They are not
mistakes — `list()` infers an identity from what makes a row different from its siblings, and every
one of these relies on that inference and gets a correct answer. The rule reports them anyway,
because an inferred identity is one that can fail and a written one cannot: a row whose every field
is nested or shared with its siblings has nothing to be told apart by, which is what
[`RMD051`](/reference/diagnostics/rmd051) exists to say. It stays a warning for as long as that is the
only argument for it.

### Reading the request after the render yielded

The one worth spelling out here, because its runtime half cannot always be heard.

`requestContext()` is live only while the render is running. On the server that is the
**synchronous** section — the scope is installed, the tree is mounted, and it is cleared before the
render's first `await`. That clearing is a safety property, not an oversight: it is one value
shared by every request the server is handling at once, and the synchronous section being atomic is
what stops one visitor's render from reading another's user. A read below a yield finds nothing.

```tsx
@mounted async load() {
  this.posts = await fetchPosts();
  const user = requestContext().get(currentUser); // ✗ reported
}
```

Taking the object early does not help — every member of it is a getter over the current request, so
`const ctx = requestContext()` above an `await` and `ctx.get(key)` below it is the same late read,
and is reported too. What carries a value across a yield is `@state`. The full shape is in
[reading the request](/ssr/request#read-it-synchronously).

Two things the rule deliberately leaves alone. A read **above** the first `await` is correct and
common — an async `@created` that reads the user and then goes fetching — and so is a read inside
an await's own operand, since `await requestContext().get(key)` evaluates before it suspends. And a
nested callback starts a clean timeline: whether it runs before or after the enclosing yield is not
something the source can say.

### Two elements that were never meant to meet

Some faults are not about one element but about two of them in the same markup: an `id` claimed
twice, a heading level that jumps. Those rules read a whole **render** — every element in one
top-level piece of JSX, in the order it is written.

```tsx expect-report
<article>
  <h1>Title</h1>
  <h3>A subsection of nothing</h3>   {/* ✗ the outline claims an h2 that is not there */}
</article>
```

The thing that makes such a rule safe is knowing whether both elements are really on the page.
`{editing ? <input id="x"/> : <span id="x"/>}` is two ids in the source and one in the document, so
**anything under a condition, a guard or a callback is never compared** — including a heading, which
breaks the chain rather than being skipped over. That is a report given up rather than a report
that sends you to delete the line making the page correct.

It reads one render at a time, not the composed tree. What `<Panel />` renders depends on its props,
its state and what its slots were filled with, and this page's opening promise is that nothing here
is guessed.

### Two head tags that are one tag

`Head` matches the tags it has already written so an update replaces them rather than appending — a
`<meta>` by `name`, `property` or `http-equiv`, a `<link>` by `rel` and `href`. Two entries with the
same identity are therefore **one tag**, and the later one silently wins.

```tsx
head = this.use(Head, () => ({
  description: "What the page is about.",       // ✗ never reaches the page
  meta: [{ name: "description", content: "…" }] // this replaces it
}));
```

`description` is a shorthand for the meta tag of that name, and it is collected **first** — so
writing both loses the shorthand, which is usually the line that was meant. The report points at
the entry that is lost and names the line that replaces it.

Nothing else can tell you. The type permits it, `tsc` says nothing, and there is no runtime
diagnostic: by the time the tags are collected the losing one has left no trace, and the page
served looks exactly like a page whose author never wrote it.

Two byte-identical entries are not reported — they collapse to the tag they both describe and
nothing is lost.

## Using it directly

The analyzer is a normal export, if you want it in a script of your own:

```ts
import { analyzeProject } from "@ramonda/check";

const { issues, counts, findings } = analyzeProject("tsconfig.json");
```

`issues` is the context check — the one this page opened with. `findings` is every other rule's,
keyed by the rule's name and typed as that rule's own issue:

```ts
const { findings } = analyzeProject("tsconfig.json");

for (const field of findings["arrow-fields"]) {
  console.log(`${field.file}:${field.line} — ${field.component}.${field.field}`);
}
```

`typescript` is a peer dependency: the analyzer uses **your** compiler, so it reads your syntax and
your config rather than guessing at them.

### It does not typecheck

It asks the compiler only where a symbol was declared — never what type anything is. So it reads
your config with `noLib` and `types` overridden, and skips the whole TypeScript lib and every
`@types/*` package you have installed. That is most of what a run would otherwise cost, which
matters for something that goes first in a build.

A project that does not compile is still `tsc`'s news to break. Run both.

## What loads when, and what a change moved

## Seeing the graph

The checker builds a composition graph to answer its questions — which components exist and which
one can mount which. `--graph` writes it as JSON, for a diff to read; `--graph-html` writes it as a
picture, for you to read.

```
$ ramonda-check tsconfig.json --graph-html app.html

[ramonda-check] graph drawn to app.html — 168 nodes, 259 edges, 14 that nothing points at
```

One self-contained file — open it, no server and no network. Rows are distance from the roots, so
what mounts something is read by going up. A **root** is a call rather than a declaration, so it is
labelled by the call: `hydrateRoot`, `renderToString`. A dashed edge is a render that may never
happen, which is a distinction the graph makes and nothing else shows you. And whatever no root
reaches gets a band of its own rather than being drawn beside the roots, because "nothing mounts
this" and "this is an entry point" are the opposite of each other.

Two checkboxes: hide the helpers, or show only what nothing reaches.

## What loads when

The same reading of the same graph answers a question no check does: what the browser downloads
before it does anything.

A bundler splits at a dynamic import and nowhere else, so this splits at a `lazy` prop and nowhere
else.

```
$ ramonda-check tsconfig.json --split

[ramonda-check] what loads when — @ramonda/docs

  before anything      16 declaration(s) in 8 file(s)
  loaded on demand     76 split point(s)
  shared between them  55 declaration(s)
```

What a chunk reaches is split three ways, and each is a different claim: **already** in the first
payload and free, **shared** with another split point and downloaded once for both, and **its own**,
which only that one pays for.

It counts declarations, never bytes. Nothing here has weighed a bundle; for kilobytes, ask the
bundler.

`--diff` compares the run against a graph written earlier, and the number it exists for is the one
below:

```
$ ramonda-check tsconfig.json --diff .ramonda/main.json

  nodes  +0  -0        edges  +1  -0
  before anything: 16 → 72 declaration(s) (+56)

  56 in the first payload now, and not before:
    ErrorBoundary — @ramonda/core/src/base/ErrorBoundary.ts:16:1
    …
```

That is one added import line. A diff of the source shows the line; nothing in it shows the
fifty-six components that now arrive with the first page.

Both flags describe. Neither fails a build.

## Markup nothing can announce

Four of the rules above read your JSX one element at a time and are all about the same thing: an
element assistive technology cannot name. `unnamed-image` and `unnamed-frame` are the two with
nothing to announce them by; `empty-heading-or-link` is a row in the screen reader's list of
headings, or of links, with no label; `positive-tabindex` does not move one element, it reorders
the whole document.

Four more read the ARIA vocabulary itself, and they fail in a way worth naming: **the browser keeps
whatever you write.** An attribute is a string, so a misspelled name, an invented role and a value
outside the specification all survive to the inspector looking perfectly healthy — and none of them
does anything. `unknown-aria-attribute` catches the name, `unknown-role` catches the role, and
`aria-value` catches the value: `aria-hidden="yes"` is not `true`, so the element stays in the
accessibility tree.

A difference of **case alone** is reported only inside SVG, and the reason is worth knowing.
Attributes on an HTML element are written with `setAttribute`, which lowercases — so
`aria-labelledBy` arrives as `aria-labelledby` and works. Attributes on an SVG element go through
`setAttributeNS`, which writes the name exactly as given, so there the same spelling is an
attribute nothing reads.

`false` is never reported. `aria-hidden="false"` says the element is exposed, which is not what
leaving the attribute off says.

`role-takes-no-name` is the one most likely to surprise you. An `aria-label` is the accessible
**name** of a thing in the accessibility tree, and the specification says which roles may have one —
a `<div>` is `generic`, the role for an element carrying no meaning, so there is nothing for a name
to name and the attribute does nothing at all. `role="presentation"` is stronger still: it removes
the element from the tree. A written `role` always wins, so `<div role="region" aria-label="Filters">`
is correct, and so is `<section aria-label="Filters">` — a `section` becomes a `region` precisely
*because* it has a name.

A fifth reads the other direction — `role-missing-required-aria`, for the roles that mean nothing
on their own. A `div` has no checked-ness, no level and no value, so `role="checkbox"` without
`aria-checked` announces a checkbox in a state nothing can report. The likeliest fix is not to add
the attribute: a native element usually already **is** the thing the role is claiming, and brings
the state, the keyboard behaviour and the focus handling with it. Only an explicit `role` is judged
— `<h2>` and `<input type="checkbox">` supply what they need themselves.

```
[ramonda-check] 1 image(s) with nothing to announce them by:

  src/Brand.tsx:12:7
    <img> has no `alt`, and no `aria-label`, `aria-labelledby` or `title` either.
```

**`alt=""` is an answer and is never reported.** It is the documented way to say "this image is
decoration, skip it", and a rule that demanded text there would push you into describing spacers.

**An element that spreads props is left alone entirely.** `<img {...rest} />` may carry the very
attribute the rule is about, and nothing static can say whether it does — so none of these four is
even asked about it. The same goes for content a rule cannot read: `<h2>{title}</h2>` may well have
text, and being unable to prove otherwise is not evidence.

## A split point that was meant, and is not there

The same fact from the other side. A bundler splits at a dynamic import and **only when it can read
the path at build time** — so `import(specifier)` is not a split point at all:

```
[ramonda-check] 1 dynamic import(s) the bundler cannot split:

  src/Search.tsx:103:30
    import(specifier) — the path is not a literal.
```

There is no chunk. The module is pulled into the caller's chunk, or left out of the build entirely
and looked for at run time — which works on a dev server, where the source is served as it sits, and
404s in production, where nothing emitted it. The build says nothing either way.

If it is deliberate, say so and the report stops. Either the bundler's own marker, which you
probably already need for the build to be quiet:

```ts
const load = () => import(/* @vite-ignore */ specifier);
```

or this package's annotation, which also keeps the reason where the next reader will find it:

```ts
// ramonda-check-ignore the panel's specifier is built, so the build cannot follow it
const load = () => import(specifier);
```

Measured across this repository when the rule was written: 88 dynamic imports with a literal path
and 3 without, every one of the three already marked. A rule that reported those would have opened
by crying wolf at three deliberate decisions.

## The bundle that did not parse

`@state`, `@compute` and the rest are TC39 decorators, which no engine can parse. Your bundler has
to transform them away, and whether it does comes down to one setting — `target`. Below `esnext`,
esbuild rewrites them into helpers. At `esnext` it leaves them exactly as written.

Nothing tells you when that goes wrong. The build succeeds, prints no warning, and emits a file that
dies with `SyntaxError: Invalid or unexpected token` the moment a browser reads it. It happened
here: the transform was being applied as a side effect of an unrelated option, and removing that
option broke the output in silence.

`ramonda-check-bundle` reads the build's output and answers the one question that matters about it:

```
$ ramonda-check-bundle dist

[check-bundle] 1 of 42 emitted file(s) do not parse:

  dist/assets/index-Bq7xk.js
    SyntaxError: Invalid or unexpected token
```

Point it at directories or files, as many as you like; it walks directories and reads every `.js`,
`.mjs` and `.cjs`. Finding no JavaScript at all is a failure rather than a pass — a build that
silently emitted nothing is the same shape of bug.

### Why it parses instead of searching for `@`

Searching for decorator syntax is both weaker and wrong. Weaker, because a surviving decorator is
only one way to emit something an engine cannot read. Wrong, because a bundle may legitimately
**contain** decorator text inside a string: a diagnostic's advice can put `@state` into a
suggestion message, so it appears in any bundle that ships them, as data. A parser does not care
what is inside a string — and that is exactly the distinction being asked for.

The parser is `node --check`, on purpose. The failure being guarded against is "no engine can read
this", and that is the engine.

### If it fires

Look at your bundler's `target`. Every value below `esnext` compiles the decorators away; `esnext`
itself, which is also esbuild's default, is the one that does not.

A scaffolded project does not set it by hand at all — [`@ramonda/build`](/reference/build) carries
it, along with `jsx` and `jsxImportSource`, into both the Vite config and the esbuild build. If you
configure the transform yourself, that package is the shorter way to get it right, and it refuses a
`target` that would bring you back to this error instead of letting the build proceed.

## Next

- [Context](/composition/context) — providers, consumers, and declaring what a component needs.
- [Diagnostics](/reference/diagnostics) — what the framework reports while it runs.
