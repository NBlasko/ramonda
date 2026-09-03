---
title: Something is wrong
description: Find the cause by what you can see — a row with the wrong text, a click nobody answers, a page that never settles.
section:
order: 1
---

# Something is wrong

What the framework reports, it reports under an identifier — a code like `RMD023` while the app
runs, a name like `index-as-key` from the checker — and the reference is indexed the same way. That
is a fine way in when you have one. It is no way in at all when what you have is *the text I typed
showed up in a different row*.

This page is the other door. It lists what you can **see**, and sends each one to the page that
explains it. If you do have an identifier, [every diagnostic](/reference/diagnostics) and
[every rule](/rules) have a page of their own.

**Open the browser console first.** Most of what follows already has a message waiting there,
naming the component and the property, and the message is more specific than anything a list can
be. The checks run in development only, so a production build has
nothing in the console to find — reproduce it with your project's `dev` script, or run
[`ramonda-check`](/reference/check), which reads your source and never runs the app.

---

**The screen shows the wrong thing**

- [I typed in one row and the text appeared in another](#i-typed-in-one-row-and-the-text-appeared-in-another)
- [Every row loses its contents when the data reloads](#every-row-loses-its-contents-when-the-data-reloads)
- [I changed my data and the screen did not follow](#i-changed-my-data-and-the-screen-did-not-follow)
- [One value in a list is right at first and wrong afterwards](#one-value-in-a-list-is-right-at-first-and-wrong-afterwards)
- [A `@compute` keeps the value it had at first render](#a-compute-keeps-the-value-it-had-at-first-render)
- [The page changes a moment after it loads](#the-page-changes-a-moment-after-it-loads)
- [A value the server worked out is missing in the browser](#a-value-the-server-worked-out-is-missing-in-the-browser)

**Something does not answer**

- [Enter and Space do nothing on a control I built](#enter-and-space-do-nothing-on-a-control-i-built)
- [My link does not navigate, or cannot be opened in a new tab](#my-link-does-not-navigate-or-cannot-be-opened-in-a-new-tab)
- [An attribute I set has no effect](#an-attribute-i-set-has-no-effect)
- [Something keeps running after I leave the page](#something-keeps-running-after-i-leave-the-page)
- [The component renders, and nothing appears](#the-component-renders-and-nothing-appears)

**It will not settle**

- [Something re-renders forever](#something-re-renders-forever)
- [A child re-renders every time its parent does](#a-child-re-renders-every-time-its-parent-does)
- [A query refetches forever, or two queries show each other's data](#a-query-refetches-forever-or-two-queries-show-each-others-data)

**It only breaks in one place**

- [It works in the browser and fails on the server](#it-works-in-the-browser-and-fails-on-the-server)
- [An environment variable reads `undefined`](#an-environment-variable-reads-undefined)
- [`params` is empty](#params-is-empty)
- [It behaved in development and misbehaves in the build](#it-behaved-in-development-and-misbehaves-in-the-build)

---

## The screen shows the wrong thing

### I typed in one row and the text appeared in another

Or: a row is removed and the wrong one stays ticked; rows re-order and the contents do not follow.

The rows have no `key`, or their key is the position in the array. Position is what the framework
already knows — it tells the rows apart by where they sit, which is exactly what changes when one
is inserted or removed, so state and DOM go to the neighbour.

```tsx
{this.items.map((item) => <Row key={item.id} item={item} />)}
```

The key comes from the data. See [rendering lists](/lists),
[`RMD023`](/reference/diagnostics/rmd023) and [`index-as-key`](/rules/index-as-key).

### Every row loses its contents when the data reloads

An open menu closes, an input clears, a scroll position resets — on a refetch, and on nothing the
user did.

The rows arrive as fresh objects, and nothing in them says which old row each one replaces, so
every row is destroyed and rebuilt instead of updated. A row identified only by nested data, or
only by fields all its siblings share, cannot be matched. See
[`RMD051`](/reference/diagnostics/rmd051) and [list identity](/lists).

### I changed my data and the screen did not follow

A `@state` value changed **in place** does not notify anything. A signal fires when it is
*assigned*, and comparing an array to itself after a `push` finds no change.

```tsx
this.items = [...this.items, "walk"];      // renders
this.user = { ...this.user, name: "ada" }; // renders
```

See [state](/concepts/state), [`RMD005`](/reference/diagnostics/rmd005),
[`RMD048`](/reference/diagnostics/rmd048) and
[`state-mutated-in-place`](/rules/state-mutated-in-place).

### One value in a list is right at first and wrong afterwards

A row shows a value that was correct when the row was created and never changes again.

The row callback reads a field that is not `@state`, so a reused row keeps what it had. See
[the row callback](/lists/row-callback) and
[`row-reads-a-plain-field`](/rules/row-reads-a-plain-field).

### A `@compute` keeps the value it had at first render

A `@compute` recomputes when something it *reads* changes, and an ordinary field is not something
it can watch. Writing that field later leaves the cached answer standing. See
[`@compute`](/concepts/compute), [`RMD027`](/reference/diagnostics/rmd027) and
[`cached-read-of-a-plain-field`](/rules/cached-read-of-a-plain-field).

### The page changes a moment after it loads

A server-rendered page appears, then flickers and rewrites itself.

The server and the browser rendered different markup, so hydration threw the server's away. A
`new Date()` or a `Math.random()` in `render()`, or a branch on `typeof window`, does it. See
[hydration mismatches](/ssr/mismatches) and [`RMD007`](/reference/diagnostics/rmd007).

### A value the server worked out is missing in the browser

`@created` and `@mounted` do not run again on the client — hydration restores state from the
server's blob instead. A value computed in either is server-only unless it travels: `@state` is
serialized, and anything else needs [`@persist`](/reference/decorators/persist). See
[`RMD034`](/reference/diagnostics/rmd034).

---

## Something does not answer

### Enter and Space do nothing on a control I built

The mouse works and the keyboard does not, because it is a `<div>` or a `<span>` with a click
handler on it. A click handler works for a pointer and for nothing else: the element is not in
the tab order, so it cannot be focused, and a screen reader announces it as text rather than as
something to do. A `<button>` is all three of those things with nothing written on it.

See [`click-with-no-keyboard-path`](/rules/click-with-no-keyboard-path), and
[accessibility](/accessibility) for the other thirty-four checks of this kind.

### My link does not navigate, or cannot be opened in a new tab

An `<a>` with no `href` — or with `#`, or `javascript:` — is not a link. It still looks like one.
Give it the destination, or use a `<button>`, which is the element for something that acts on this
page. See [`link-without-a-destination`](/rules/link-without-a-destination) and
[links](/routing/links).

### An attribute I set has no effect

Three faults land here, and every one of them is silent — the line looks right and the page does
not change.

- **A capital that should be there.** A few pieces of element state live only in a DOM *property*
  and have no attribute of that name at all: `playbackRate`, `currentTime`, an `<input>`'s
  `indeterminate`. `playbackrate={2}` is not the lowercase form of one — it is a name the browser
  has never heard of, written into the document where nothing reads it. See
  [`misspelled-element-property`](/rules/misspelled-element-property).
- **A capital that should not.** Six names arrive at the DOM as themselves and are read by no
  browser: `httpEquiv`, `acceptCharset`, `defaultValue`, `defaultChecked`, `innerHTML` and
  `textContent`. Each has a real spelling, and the rule names it. See
  [`attribute-that-does-nothing`](/rules/attribute-that-does-nothing).
- **`false` on a boolean attribute.** `disabled="false"` disables the control. HTML reads the
  attribute's *presence* and never its value, so the string turns it on. `disabled={false}` is what
  was meant. See [`RMD029`](/reference/diagnostics/rmd029).

### Something keeps running after I leave the page

A timer still fires, or state is written to a component that is gone and the update is dropped.

Almost always an `await` that resolves late — a fetch, a subscription callback — and writes on the
way back. See [`RMD008`](/reference/diagnostics/rmd008),
[`RMD006`](/reference/diagnostics/rmd006) and [timers](/concepts/timers).

### The component renders, and nothing appears

Something outside the framework removed the component's element — a `ref` handed to a library that
replaces the node, a hand-written `innerHTML`. The component is still mounted, so its timers fire
and its renders go into nodes nobody can see. See [`RMD016`](/reference/diagnostics/rmd016).

---

## It will not settle

### Something re-renders forever

Two `@updated` methods each writing what the other reads is the usual cause; a write inside
`render()` is the other.

**The two builds show it differently, which is what makes it confusing.** In development the
framework stops the loop and names the component, so the page keeps working and the evidence is in
the console. A production build has no such report: a counter throws instead, at a hundred thousand
rebuilds in one tick, and takes the page down. Both are deliberate — an error leaves something to
debug, and a tab that stops responding does not.

See [`RMD009`](/reference/diagnostics/rmd009) and [`RMD001`](/reference/diagnostics/rmd001).

### A child re-renders every time its parent does

It is handed a value built during the render. Every prop is a signal and a signal compares by
reference, so an array or an object rebuilt each time is a *changed* prop — which recomputes every
`@compute` reading it and fires every `@watchProp` on it. See [performance](/performance),
[props](/concepts/props),
[`RMD022`](/reference/diagnostics/rmd022) and
[`fresh-object-in-props`](/rules/fresh-object-in-props).

### A query refetches forever, or two queries show each other's data

Both are one fault: the key does not survive being hashed. A `Date` in it becomes a timestamp that
differs on the next render, so the cache entry is never found again; a function in it is dropped
entirely, so two different keys hash the same. Keep primitives in the key. See
[`RMQ001`](/reference/diagnostics/rmq001) and [queries](/query/queries).

---

## It only breaks in one place

### It works in the browser and fails on the server

The server has no `window`, no `document` and no `localStorage`. Code that runs on both sides
cannot reach for them, and `process.env` is the same fault in the other direction — the browser has
no `process`. See [server and browser](/ssr/env) and
[`server-env-in-shared-code`](/rules/server-env-in-shared-code).

### An environment variable reads `undefined`

A variable has to be exposed to the browser bundle before it can be read there; unexposed, it is
not an error, it is `undefined`. See [`unexposed-env-read`](/rules/unexposed-env-read) and
[the build](/reference/build).

### `params` is empty

`params` comes from the matched route, and a component that is not *under* the outlet has no
matched route above it. A nav bar beside the outlet is the ordinary case, and `{}` is the right
answer there. See [route parameters](/routing/params) and
[`RMD003`](/reference/diagnostics/rmd003).

### It behaved in development and misbehaves in the build

Nothing changed but the reporting. The diagnostics are development-only and a production build
ships none of them, so a fault that was being reported out loud is still there and is now silent —
which reads as the build having broken something. Reproduce it in development, where the message
comes back, or run [`ramonda-check`](/reference/check), which does not depend on the build at all.

The one fault that genuinely behaves differently is an update loop: development stops it, and
production throws. It is [above](#something-re-renders-forever).

---

## There is a message and I do not know what it means

Every message carries a code. `RMD` is the framework itself, `RMQ` is queries, `RMF` is forms,
`RML` is lens — each is listed apart, and each code has a page.

**[Every diagnostic](/reference/diagnostics)** — what the message means, and what to write instead.

**[Every rule](/rules)** — the same faults found in your source before the app runs.

## Next

If you came here with a symptom and found it, the page it sent you to is the one to read.

If you came to look around: **[Diagnostics](/reference/diagnostics)** is the full list of what the
framework watches for while you develop, and **[`ramonda-check`](/reference/check)** is how to find
the same faults in a file you have not run yet.
