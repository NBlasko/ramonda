---
"@ramonda/check": minor
---

A class counts as a component when its heritage chain reaches `Component` or `Hook`.

The membership test read one heritage clause and said yes to a class extending anything at all, on
the reasoning that a subclass of a subclass still is one. It is — and so was `class MyError extends
Error`. Measured on a fixture of five classes, all five counted; measured on this repository's four
apps, the number the CLI prints was inflated by every error type and every custom element in scope:
75 → 72 components in the docs app, 12 → 9, 57 → 53, 33 → 29 in the others, and every class the
walk now drops extends `Error` or `HTMLElement`.

The chain is walked by symbols — the base's symbol, through an import alias, to its class
declaration, and up — so `Deep extends Base extends Component` is still a component. A tighter name
check would have dropped it. A mixin's heritage clause is a call (`extends withTheme(Component)`)
and has no symbol to follow, so it reads as "not a component": answering it needs a type, and types
are outside what this analyzer loads.
