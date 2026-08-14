---
"@ramonda/core": minor
---

`render` takes no decorator, and says so where the class is defined.

`render` is the one member Ramonda reserves, and it was reserved only by TypeScript's `abstract` —
a build with no types refused nothing. The two worst outcomes said nothing either. Measured, one
class per decorator:

- **`@compute get render()`** turns the method into a cached property, so the framework's
  `component.render()` dies with `TypeError: component.render is not a function` — before a page
  appears, out of the framework, with no diagnostic at all.
- **`@memoizedHandler render()`** is worse, because it does not throw. The render is memoised on
  arguments it does not have, and the component **never updates again**: measured `"0" -> "0"`
  after a state write that should have shown `1`. A frozen page, in silence.
- `@created`, `@mounted`, `@updated` and `@destroyed` register the render as a lifecycle callback,
  so it runs outside the render pass as well as inside it.
- `@catchError` makes the render the handler for errors thrown by its own subtree.
- `@state` and `@persist` mean "serialise me", which a render is not.

**TypeScript catches exactly one of these, and it is the wrong one.** A getter cannot override a
method, so `@compute get render()` is refused by the type system — and that is the case that throws
loudly anyway. `@memoizedHandler render()`, which freezes the page in silence, type-checks
perfectly.

None of those is a shade of wrong, so the rule is total rather than a list: no decorator goes on
`render`. The check sits in the three shared asserts every member decorator already calls, so it
covers all eleven of them and any that arrive later — and it is DEV-only, like the rest of that
file, because a decorator is fixed at the source and the cheapest moment to refuse it is the moment
the class is defined.

Put the behaviour on a member of its own and call it from `render`.
