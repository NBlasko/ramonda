---
"@ramonda/check": minor
"@ramonda/core": minor
---

`async render()` is now reported statically as `async-render` and at runtime as **RMD060**.

**Why, when the type system already refuses it.** Because a type is a defence only while nobody
casts it away, and this one is defeated by a single comment. Measured:

| written as | `tsc` |
|---|---|
| `async render()` | TS2416 — refused |
| `render = async () => …` | TS2416 — refused |
| `async render()` under a `@ts-ignore` | **compiles** |
| `async render()` on a base class loosened by one cast | **compiles** |

Two of the four ship, and what ships is not a graceful failure. Measured by running it: the diff is
handed a promise where a node belongs and throws `TypeError: component is not a constructor` from
inside `DiffAndMerge` — a stack of framework frames naming neither the component nor `render()`.

The rule is an **error** rather than a warning, which departs from "a new rule is a warning first".
No `async render()` is correct, so nothing correct can be reported, and the alternative to failing
the build is that same `TypeError` in somebody's browser.

RMD060 is raised in development from where `render()`'s own return value is still in hand, before it
is wrapped in a host element — asked one level up, the question cannot be asked at all, because the
wrapper is a node whatever is inside it. Production is unchanged.
