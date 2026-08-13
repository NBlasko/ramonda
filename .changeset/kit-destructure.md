---
"@ramonda/check": minor
---

`ramonda-check` follows a component kit destructured out of a factory.

```ts
export const { Router, RouteOutlet, Navigator, Link, route } = createRouter(routes);
```

This is the shape `npm create ramonda` scaffolds and the routing docs teach, and every tag written
from it was reported as a component that cannot be followed. That is an ERROR, so **a scaffolded
routed project could not run `npm run build` at all** — and because nothing below an unresolved tag
is judged, most of the app went unexamined with it.

Nothing is guessed. `componentAt` already answers a direct import from an installed package by
taking the symbol's name to that package's fragment; the same two facts are present one step apart
here — the callee is declared in the package, and the destructured key is the name. Only exported
members match, so a key sharing a name with a package's internals resolves to nothing.

It reads the fragment rather than the factory's return type, because the type is where the answer
stops being there: `@ramonda/router` publishes `Router: typeof Router` but `Link:
ComponentClassKind<TypedLinkProps<…>>`, the latter having passed through `as unknown as`. Half the
kit names its class and half does not, so a type-directed version would have resolved two of four
and left the two used most.
