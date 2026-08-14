---
"@ramonda/core": patch
---

`Head` stops republishing on renders that changed nothing it owns.

`meta` and `link` arrive as fresh array literals every time a call site's callback is evaluated,
and every prop is a signal comparing by reference. So the head re-applied on every render of
whatever mounted it — correct output, rebuilt for no reason.

The watcher had been hiding this behind a serialized selector:

```ts
@watchProp((props) => JSON.stringify([props.title, props.description, props.meta, props.link]))
```

That worked, and it put the comparison in the wrong place. `Head` now declares the two arrays
values, which is what `@StableProps` is for, and the watcher takes one selector per option:

```ts
@StableProps("meta", "link")
export class Head extends Hook<HeadOptions> { … }

@watchProp((p) => p.title, (p) => p.description, (p) => p.meta, (p) => p.link)
```

Measured over five re-renders with identical contents: the serialized selector fired 0 times, plain
selectors fired 5, and plain selectors with `@StableProps` fire 0. The declaration reaches every
consumer of those props rather than this one watcher — a `@compute` reading `props.meta` stops
recomputing too — and `previous[i] === next[i]` now says WHICH option moved, which a single
serialized value could not.

A test pins the behaviour by counting mutations to `document.head`, because the alternative is
silent: remove the declaration and every other test still passes.
