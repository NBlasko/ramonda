---
"@ramonda/core": minor
---

`@Host`, `@onElement` and `@shouldUpdateOnPropsChange` are now refused on a hook by **TypeScript**,
not only at runtime — and the two that failed badly now fail clearly.

Before: `@Host` on a hook was **silently ignored** (the metadata went to a class no render path
consults), and `@onElement` died with `Cannot read properties of undefined (reading 'enhancedNode')`
— an error naming nothing the author wrote. Only `@shouldUpdateOnPropsChange` explained itself, and
none of the three was a type error.

Now each is refused twice: the type rejects it at the decorator, and a build with no types throws at
construction with a message that says where the decorator belongs instead.

```
[Ramonda] @onElement is for components, not hooks. It binds a listener to the component's
host element, and a hook has no element of its own. Move the listener to the component that
uses <Listening />, or use @onWindow / @onDocument, which work on both.
```

Everything else in the decorator set works on a hook — measured, not assumed: `@state`, `@persist`,
`@compute`, `@memoizedHandler`, `@create`, `@mount`, `@destroy`, `@updated`, `@watchProp`,
`@deferHydration`, `@onWindow`, `@onDocument`, `@interval`, `@timeout`, and your own subscription
decorators. A new [decorator table](https://ramonda.pages.dev/reference/decorators) answers all
three questions at once: where each runs, what it goes on, and whether it may repeat.
