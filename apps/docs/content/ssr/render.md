---
title: renderToString and hydrateRoot
description: The pair — how the server's markup is produced, and how the client adopts it.
section: Server rendering
order: 91
---

# `renderToString` and `hydrateRoot`

```ts
// server
const html = await renderToString(<App />);

// client
hydrateRoot(<App />, document.getElementById("app")!);
```

## What the server produces

The same components, rendered under a DOM, serialized to HTML. Two things go in that a plain
render would not have:

**A state blob per component.** Every host element carries `data-ramonda-state` with that
component's `@state` and `@persist` fields. That is what lets the client resume rather than start
over — a value the server computed is *restored*, not recomputed.

**No whitespace between nodes.** The markup is built with `createElement`, so there is nothing
between elements to confuse the position matching hydration does.

## What hydration does

`hydrateRoot` **adopts**. It walks the vnode tree against the DOM already there and, where they
agree, keeps the node: attaches listeners, wires refs, restores state, runs client lifecycle.

Nothing is rebuilt when the two agree. On this page, measured: **every element adopted, none
replaced.**

Where they disagree, the client wins — the DOM is patched — and development reports it as
[`RMD007`](/ssr/mismatches).

## Hydrating IS the comparison

There is no second render to detect divergence. The client renders once, and walking that output
against the server's DOM is a comparison the adopt path had to make anyway.

## The one place the DOM is not shaped like the vnodes

Text. HTML cannot record where one text node ends and the next begins, so
`<span>Hello {name}!</span>` — three text children — comes back as **one** node.

Hydration splits it again with `splitText`, taking each child's share off the front. One way to
do this is to write `<!---->` separator comments into the markup; Ramonda spends zero bytes on
them and does the work on the client instead.

It also makes divergence detection more precise: the server's node must *start with* what the
client rendered, and anything else is real disagreement.

## Async work

A component that fetches in `@mount` — which is what `@mount` is for — has that awaited before
serializing. See [async on the server](/ssr/async).

## Next

- [Head and metadata](/ssr/head) — per-page title and description.
