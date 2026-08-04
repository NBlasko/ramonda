---
"@ramonda/devtools": minor
"@ramonda/query": minor
"@ramonda/form": minor
"create-ramonda": patch
---

Devtools takes plugins, and Query and Forms are the first two

**A package can register a tab.** `@ramonda/devtools` exports `panelRegistry()`, and anything that
registers a description gets a tab built for it. The description is DATA, never markup: a row has a
title, a status, typed fields, an optional value and its actions, and the panel decides what all of
that looks like. That keeps the tool the app is diagnosed with out of the app's hands, keeps its
look coherent, and keeps the contract small enough to version honestly. See
[Adding a tab](https://ramonda.pages.dev/devtools/panels).

```ts
const off = panelRegistry().register({
  version: 1,
  id: "sockets",
  label: "SOCKETS",
  snapshot: () => ({
    groups: [{ rows: [{
      id: "ws-1",
      title: "wss://api.example.com",
      status: "ok",
      fields: [{ kind: "live", id: "age", text: "last message 4s ago" }],
      value: { data: lastFrame, revision: frameCount },
      actions: [{ id: "close", label: "close" }],
    }] }],
  }),
  run: (rowId, actionId) => undefined,
});
```

Register from an instance's lifecycle rather than at module import, so the list is exactly the live
sources. A field marked `live` — a clock, a countdown — keeps its own text node while the rest of
the list holds still, which is what stops a tab rewriting itself twice a second.

**`@ramonda/form` has a Forms tab.** Every mounted form, whether it is valid, how many fields are
blurred and edited, and a row per field that is actually wrong — with whether that field has been
interacted with at all, which is the answer to "it says this is required and I have not touched it".
`reset` and `submit` go through the form, so submit is the real one, validation and `onSubmit`
included. The values are read-only: a form holds the schema's input side, and a `Date` does not
survive being typed back as JSON.

**`@ramonda/query` describes its own tab now.** The panel used to know what a query row looks like:
which badge means fetching, that `observers: 0` is worth calling out, that a bounded copy must not
be editable. That is knowledge about a cache, and it lives with the cache. `__RAMONDA_QUERY__` is
gone — the registry replaced it — and with it the `QueryBridge` / `QueryRow` / `QuerySnapshot`
types, which existed only to carry a cache to something that knew how to draw it.

Nothing changes for an app: the Query tab looks and behaves as it did.

**A removed panel kept calling into the app.** `disconnectedCallback` stopped neither poll timer, so
a panel taken out of the document went on asking the cache for a snapshot and the profiler for its
commits — measured at thirteen further calls over five seconds, and still going. Every tab is
stopped on teardown now.

`panelRegistry` and the contract's types are the package's first public exports — everything else
in it is the panel's own implementation, imported for its side effect.

**Internal: the panel splits into modules.** `index.ts` goes 2777 → 765 lines; what is left is the
frame — docking, dragging, tabs, logs. The component tree, the value viewer, the profiler and the
plugin renderer are their own files.
