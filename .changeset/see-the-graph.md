---
"@ramonda/check": minor
---

`--graph-html` — the composition graph as a picture, in one file

`--graph` already wrote everything: measured on this repository's documentation app, **168 nodes and
259 edges**. A hundred kilobytes of JSON answers a diff's question and not a person's, which is what
the shape of the app actually is.

```
$ ramonda-check tsconfig.json --graph-html app.html
[ramonda-check] graph drawn to app.html — 168 nodes, 259 edges, 14 that nothing points at
```

One self-contained page — no server, no network, nothing to install. It is a READER for the graph,
not a second analysis: it adds no data and decides nothing the checker had not already decided.

Three things it shows that the JSON does not:

- **Distance from a root**, as the row a node sits in, so "what mounts this?" is read by going up.
- **What nothing reaches**, in a band of its own rather than drawn beside the roots. "Nothing mounts
  this" and "this is an entry point" are opposites, and putting them in one row would erase the
  distinction the `unreachable` report exists for.
- **A render that may never happen** — `always: false` — dashed. The analyzer already makes that
  distinction and nothing else surfaced it.

No layout library, and that is a judgement rather than a purity rule: a force-directed cloud of 168
nodes hides the one thing worth seeing here, which is depth. `--graph` is untouched — the JSON is
what `--diff` compares, and a diff does not want markup.
