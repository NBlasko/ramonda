---
"@ramonda/router": minor
"@ramonda/check": minor
---

`Link` is now `Anchor` at the package's top level; the kit's `Link` is unchanged.

Two importable names for one behaviour, one of which silently gave up the type checking the other
exists to provide, is one name too many — and the docs proved it: `routing/index.md` taught the kit
while four other pages imported the global.

```ts
import { Anchor } from "@ramonda/router";          // any string; for code that does not know your routes
const { Link } = createRouter(routes);             // href checked against your route table
```

**Breaking.** `Link` and `LinkProps` are no longer exported; use `Anchor` / `AnchorProps`, or take
`Link` from `createRouter`.

`Anchor` and `Link` are two declarations over one implementation — `class Link extends Anchor {}` —
because devtools names a component from its class, and telling the two apart there is most of why
the rename is worth doing. Measured: the empty subclass costs ~7 ns per instance against a base of
~14 ns, which sits under everything a real component does on construction. A factory minting the
classes would have given the names and lost more: `ramonda-check` follows class declarations, so
both would have vanished from this package's graph and every tag from the kit would go back to
being a hole.

`@ramonda/check` splices a package's non-exported components too, reachable only through a factory's
destructured key. A kit's members are deliberately not exported — that is the point of handing them
back through a factory — and the first version of that rule matched exported members only, which was
wrong for the one shape it exists to resolve.
