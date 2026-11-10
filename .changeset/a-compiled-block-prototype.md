---
"@ramonda/core": patch
---

A first step toward compiling JSX at build time: an element tree whose shape never changes can be
handed to the diff as a template and the values of its holes. `__template` builds the static part once,
from a description, with the DOM's own calls — never parsed from HTML, which rearranges what it is
given; `__block` carries one render's values. The diff builds the element by cloning the template and
updates it by comparing each hole with the value it wrote last. A hole is an attribute, written through
the attribute rules as any attribute is, an element's one child — text written straight into its text
node, markup through the children diff — or an element's children. A block a server rendered is
hydrated in place, once its markup is checked against the template — tags, the template's own
attributes and text; markup from another template, another route's page, is built instead. An
attribute only the server wrote goes, as it does from any element hydration adopts. A
template's static parts are never compared again after that: what someone else changes or takes out
there stays, as an attribute someone else sets does. `@ramonda/build` writes
these calls. Measured on js-framework-benchmark
with the row hand-compiled, median script time: selecting a row went from 99.1 to 23.8 ms, creating
10,000 rows from 370.2 to 206.0 ms.
