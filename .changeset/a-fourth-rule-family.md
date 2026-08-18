---
"@ramonda/check": minor
---

A fourth rule family: rules that read one RENDER, and the first two of them.

**What the other three could not answer.** A class rule sees a class, a module rule a file, an
element rule one element and its ancestors — enough for "is this `<tr>` inside a table", and nothing
at all about two elements that never meet. An `id` claimed twice and a heading level that jumps are
both questions about a whole markup tree, and no subject that size existed.

**`TreeRule`** takes one render — one top-level piece of JSX, with every element in it in document
order. Deliberately not the composed tree: what `<Panel />` renders depends on its props, its state
and what its slots were filled with, and this package does not guess.

**The family exists for one guard, not for the walk.** A per-class rule could have walked the JSX
itself. What cannot be left to each rule is deciding whether two elements are ever really both
there: `{editing ? <input id="x"/> : <span id="x"/>}` is two ids in the source and one in the
document. So every node carries `alwaysPresent`, computed once — anything under a condition, a
guard, a `switch` or a callback is `false`. Proved load-bearing: forcing it to `true` fails four
tests, every one of them a piece of correct markup being reported.

The two rules on it, both warnings and both silent across every app and package here:

- **`duplicate-id`** — two always-present elements in one render with the same literal `id`. Nothing
  fails loudly when this happens, which is why it is worth reporting: `getElementById` and `#x`
  answer with the first and never mention the second, `<label for>` labels the first — so the other
  control is nameless in the accessibility tree, not merely visually — and `aria-labelledby`,
  `aria-describedby` and a fragment link resolve the same way.
- **`heading-skips-a-level`** — a heading more than one level below the one before it. Headings are
  the document's outline, exposed to a screen reader as a navigable list, so `h1` then `h3`
  announces a section nested inside one that does not exist. Going back UP is not reported: `h3`
  then `h2` is one section ending and another beginning.

A heading that may not be there **breaks the chain** rather than being skipped over — found by
running it, not by reading it: `<h1>`, `{detailed && <h2>}`, `<h3>` was reported as a skip, and that
markup is correct whenever `detailed` is true.

Both were proved not to be silently dead by planting them into `DocPage`, the docs' own page
component, and watching the CLI name each one.
