---
"@ramonda/check": minor
---

The graph carries which element each component IS — on the node, and per call site on the edge.

A fact, not a conclusion, which is what the graph holds. Nothing but `host-tag-is-not-an-element`
reads it yet, and that is the point: a rule that wants to know what element a component becomes has
somewhere to ask instead of re-deriving it from the decorator each time.

**On the NODE, what the class settles.** `@Host("a")` and `@Host(TAG)` where `const TAG = "a"` are
both `{ tag: "a" }` — the name is followed, including across files. Case is kept, because SVG names
are case-sensitive and `clipPath` is the element while `clippath` is not.

**On the node when the class cannot settle it**, which prop decides and what it falls back to:
`@Host((self) => self.props.as ?? "div")` is `{ fromProp: "as", fallback: "div" }`. The class really
cannot say more — it is a `<section>` at one call site and a `<div>` at the next.

**On the EDGE, what THIS site mounts.** `<Card as="section" />` carries `hostTag: "section"`, the
next `<Card as="dvi" />` carries `"dvi"`, and `<Card />` carries the fallback. On the edge and not
the node for the reason `binds` is already there: a value handed over belongs to a call, and a node
carrying one of two answers would be wrong about the other half the time.

**Absent when nothing settles it.** A callback reading two props, computing a value, or reaching
through a member is not approximated — a missing `host` is "not knowable here" and never "no host",
since every component has one.

Measured on `packages/router`: `Link → { tag: "a" }`, which is the anchor it makes through `@Host`
and which no element rule has ever been able to see.
