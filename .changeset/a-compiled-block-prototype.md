---
"@ramonda/core": patch
---

A first step toward compiling JSX at build time: an element tree whose shape never changes can be
handed to the diff as a template and the values of its holes. `__template` defines the static part once,
and `__block` carries one render's values; the diff builds the element by cloning the template and
updates it by comparing each hole with the value it wrote last. Nothing calls these yet but a
hand-compiled benchmark row: the compiler that writes them comes next. Measured on js-framework-benchmark
with the row hand-compiled, median script time: selecting a row went from 99.1 to 27.7 ms, creating
10,000 rows from 370.2 to 191.1 ms.
