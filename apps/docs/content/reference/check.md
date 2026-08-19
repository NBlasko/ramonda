---
title: Checking your app
description: ramonda-check reads your source and proves what a running page would not tell you; ramonda-check-bundle reads what your build emitted.
section: Reference
order: 112
---

# Checking your app

A context that has no provider above it does not crash. The consumer falls back to the default, the
page renders, and someone reads a number that was never real. The framework reports it
([`RMD003`](/reference/diagnostics)) — but only once that component actually mounts.

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
| [`RMD003`](/reference/diagnostics) | when the component **mounts** | dynamic composition the checker cannot resolve |

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
| A component named among children | `{Panel}` where `<Panel />` was meant — also [`RMD052`](/reference/diagnostics) |

### The rules

Each of these is one file in the checker, and each answers for itself: its id is the key in
`findings`, and it is the name the command prints. The two tables below are **generated from the
rules**, so a rule cannot be added without appearing here.

[rules:start]: #

*Generated by `scripts/build-rule-tables.mjs` from the rules themselves — edit the rule, not this.*

**Errors.** These fail the run. 4 of them.

| rule | reported when |
|---|---|
| `arrow-fields` | a class field holds a function literal, so every instance builds a fresh one and props comparison can never match |
| `duplicate-decorators` | a single-use decorator is written twice: `@Host`, `@catchError`, `@ShouldUpdateOnPropsChange` or `@StableProps` |
| `unwatched-fields` | a component reads a form field it does not watch, so it never re-renders when that field changes |
| `one-provider-per-component` | one component mounts two Providers of the same context, which core refuses at runtime — also [`RMD056`](/reference/diagnostics) |

**Warnings.** These print and the run still passes. 27 of them.

| rule | reported when |
|---|---|
| `state-written-while-rendering` | a state write is reached from `render()` or a `@compute` — directly, through a helper it calls, or three files away — also [`RMD001`](/reference/diagnostics) |
| `clock-read-while-rendering` | `Date.now()`, `new Date()` or `Math.random()` is reached from a render, by any path — also [`RMD021`](/reference/diagnostics) |
| `browser-url` | a component reads `window.location` in a project whose router already holds the answer |
| `dom-writes` | a component writes the document — `document.body.classList.add(…)` and its family — where `render()` could have said it |
| `late-request-read` | `requestContext()` is read below an `await`, after the request it names is gone — also [`RMD053`](/reference/diagnostics) |
| `head-tags-collide` | two tags in one `Head` resolve to the same identity, so only the second is written |
| `unguarded-async-lifecycle` | an `async` lifecycle awaits something with no `try` or `.catch` to handle a failure — also [`RMD059`](/reference/diagnostics) |
| `context-consumed-above-its-provider` | a component consumes a context on a line above the Provider that publishes it, so the consumer reads an ancestor's value — also [`RMD057`](/reference/diagnostics) |
| `client-only-request-read` | a `requestContext()` read is on a path that only runs in the browser, where the value it names is never available — also [`RMD025`](/reference/diagnostics) |
| `unsplittable-import` | a dynamic import's path is not a literal, so no bundler can emit a chunk for it |
| `duplicate-key-among-siblings` | two children written side by side claim the same literal `key` — also [`RMD002`](/reference/diagnostics) |
| `row-without-a-key` | a row built by `map` or by `list()` has no `key` — also [`RMD023`](/reference/diagnostics) |
| `class-instead-of-classname` | an element carries `class` where `className` was meant, so it styles nothing — also [`RMD039`](/reference/diagnostics) |
| `tag-needs-its-parent` | a tag is written outside the parent it requires — `<tr>` with no table above it, `<option>` with no select |
| `interactive-inside-interactive` | an interactive element is nested inside another of the same kind: a link in a link, a button in a button, a form in a form |
| `unnamed-image` | an `img`, `area`, image `input` or empty `object` has no `alt`, `aria-label`, `aria-labelledby` or `title` |
| `unknown-aria-attribute` | an `aria-*` attribute is not a name the ARIA specification has |
| `unknown-role` | a `role` names nothing, or names an abstract role that markup may not use |
| `role-missing-required-aria` | an explicit `role` is written without the `aria-*` its specification requires |
| `role-takes-no-name` | an `aria-label` or `aria-labelledby` is written on a role the specification forbids naming |
| `aria-value` | an `aria-*` attribute carries a literal value its specification does not permit |
| `aria-with-no-subject` | a `role` or an `aria-*` sits on an element with no accessibility tree node to describe |
| `empty-heading-or-link` | a heading or a link has nothing inside it to announce |
| `unnamed-frame` | an `iframe` has no `title` |
| `positive-tabindex` | a `tabIndex` is above zero, which reorders the whole document rather than one element |
| `duplicate-id` | two elements in one render carry the same literal `id`, and both are always present |
| `heading-skips-a-level` | a heading is more than one level below the heading before it, both written in the same render |

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
[`RMD051`](/reference/diagnostics) exists to say. It stays a warning for as long as that is the
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

```tsx
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
**contain** decorator text inside a string: Ramonda's own diagnostics put `@Host("div")` into a
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
