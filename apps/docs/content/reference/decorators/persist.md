---
title: persist
description: Sends a non-reactive field to the browser in the hydration blob, so the client resumes with the value the server had.
section: Reference
order: 131
---

# `@persist`

Marks a field as **serializable state for hydration**. It creates no signal and nothing re-renders
when it changes — it records that this value must travel from the server render into the browser and
be restored there.

## The situation it is for

A page rendered on the server that stamps when it was built. The server works the value out; the
browser must not work it out **again**, because it would get a different one:

```tsx
class Report extends Component<{ rows: number }> {
  @persist generatedAt = "";

  @created({ env: "server" })
  stamp() {
    this.generatedAt = new Date().toISOString();
  }

  render() {
    return (
      <article>
        <p>{this.props.rows} rows</p>
        <small>Generated {this.generatedAt}</small>
      </article>
    );
  }
}
```

Hydration works by rendering the same tree in the browser and matching it against the server's HTML.
Take `@persist` away and the browser's `generatedAt` is `""` — the two disagree, the server's markup
is replaced, and the reader watches a timestamp blink out. That mismatch is reported as
[`RMD007`](/reference/diagnostics/rmd007).

With it, the value travels in the hydration blob and the browser resumes holding exactly what the
server held.

## When you need it, and when you do not

**[`@state`](/reference/decorators/state) is already persisted.** A reactive field goes into the
hydration blob on its own, so `@persist` beside it adds nothing and is reported as
[`RMD046`](/reference/diagnostics/rmd046) — the decorator that adds nothing.

`@persist` is for the other kind: **set once, render-relevant, and not a signal.** A timestamp, a
seed, a request id — values the render depends on that nothing is going to change afterwards.

## What it refuses

**Anything but a field.**

**A value JSON cannot carry.** A function, a `Map`, a class instance, `undefined` — the blob is JSON,
so what cannot be written cannot come back. `ramonda-check` reports it as
[`unserializable-state`](/rules/unserializable-state), which **fails the build** rather than warning:
the value survives the server render, disappears in the browser, and the two look identical from
the outside.

## What it costs

**Markup bytes on every page the server sends.** The blob is part of the HTML, so a persisted field
is paid for by every reader.

That is why a field still holding what its own initializer produced is **left out** of the blob —
the client's initializer produces the same value. Only a primitive is treated that way, and the
reason is correctness rather than thrift: an in-place mutation keeps the very object the initializer
made, so an identity test on an object would call a filled array untouched and hand the browser an
empty one. A primitive has no in-place to mutate.

## Next

- [Hydration mismatches](/ssr/mismatches) — what the two sides disagreeing looks like.
- [`@state`](/reference/decorators/state) — reactive, and persisted already.
- [Rendering on the server](/ssr/render) — where the blob is written.
