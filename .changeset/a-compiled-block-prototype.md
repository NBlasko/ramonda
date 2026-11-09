---
"@ramonda/core": patch
---

A first step toward compiling JSX at build time: an element tree whose shape never changes can be
handed to the diff as a template and the values of its holes. `__template` builds the static part once,
from a description, with the DOM's own calls — never parsed from HTML, which rearranges what it is
given; `__block` carries one render's values. The diff builds the element by cloning the template and
updates it by comparing each hole with the value it wrote last. A hole is an attribute, written through
the attribute rules as any attribute is, an element's one child — text written straight into its text
node, markup through the children diff — or an element's children. Nothing calls these yet but a
hand-compiled benchmark row: the compiler that writes them comes next. Measured on js-framework-benchmark
with the row hand-compiled, median script time: selecting a row went from 99.1 to 23.8 ms, creating
10,000 rows from 370.2 to 206.0 ms.
