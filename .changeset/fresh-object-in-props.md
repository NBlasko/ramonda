---
"@ramonda/check": minor
---

A new rule: `fresh-object-in-props`.

An object or array literal written straight into a component's props is **built during the render**,
so the child is handed a different object every time — never equal to the one before it, however
identical its contents. Props comparison cannot match, and the child renders again whenever its
parent does, whether or not anything about it changed.

Measured by counting a child's renders, with a parent whose state changes for an unrelated reason:

| the prop | after mount | after the parent re-renders |
|---|---|---|
| `conf={{ a: 1 }}` — a fresh literal | 1 | **2** |
| `conf={stable}` — the same object each time | 1 | **1** |

So it is the literal and nothing else. This is the props side of `arrow-fields`: a value rebuilt per
render that comparison can never match.

A **warning**, because the page is right either way — the child renders again and produces the same
output. What it costs is work, and it multiplies: a list of a thousand rows is a thousand children
that cannot be skipped.

`<div style={{ color: "red" }}>` is **not** reported. A host element hands nothing to a component, so
there is no comparison to defeat, and only components are asked. `key` and `ref` are skipped too —
the framework reads them itself rather than passing them on.
