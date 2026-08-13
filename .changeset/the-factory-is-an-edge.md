---
"@ramonda/check": minor
---

The factory JSX compiles to is an edge, and a route table built by a loop names its views.

A tag is not the only way to mount a component, and this repository's documentation site uses the
other one throughout: `__h(Markdown, { tree })` with the component named outright, and
`__h(component, null)` with it taken from a registry. Neither is a JSX element, so the walk saw
nothing — and neither was a hole, because nothing looked like an unresolvable tag.

**Measured, and the number is the point: the walk reached 10 of that app's 153 nodes, and the run
still said every consumer had a provider above it.** It had judged almost nothing. It reaches 90 now,
over 242 edges rather than 141.

Three shapes are read where one was:

- the factory called with a component named outright;
- the factory called with a value from a registry written as a literal — the key is decided at run
  time and the map is not, so what MAY mount is the union of its values. A shorthand entry took two
  hops to resolve, and each of them silently emptied the union: the symbol at `{ Counter }` is the
  PROPERTY, and the symbol behind that is the IMPORT;
- a route table built by a LOOP. `collectRouteTable` read only the JSX written inside
  `createRoutes(...)`, and the documentation site builds its table with
  `table[page.path] = __h(DocPage, { meta: page })` over a hundred paths.

A tag chosen between two ELEMENTS — `const tag = inline ? "span" : "div"` — is not a component, and
is not reported. A tag whose value cannot be read as either is a hole like any other; the one in
this repository carries its reason.
