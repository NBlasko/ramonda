---
"@ramonda/core": patch
"create-ramonda": patch
---

A tagline that says what Ramonda is: **Explicit. Predictable. Readable.**

The old one listed implementation choices — class components, signals, TC39 decorators — which is what a
reader compares against their existing habits rather than a reason to look further. Nothing in it said
what you get.

Three words, in the order they cause each other: *explicit* is how you write it, *predictable* is how it
runs, *readable* is what you get back when you return to it a year later. No second sentence: the
`Counter` example directly below is a better argument than an adjective defending an adjective.

`keywords` in `package.json` still carries `signals`, `decorators`, `ssr` and the rest, so nothing was
lost for npm search — those words moved to the field that search actually reads.

Six places now agree: both READMEs, core's npm description, the docs social card, and both scaffolded
apps. The SSR template keeps "Server-rendered, then hydrated", which is a fact about that app rather than
the tagline.
