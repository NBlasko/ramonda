---
"@ramonda/core": minor
---

Compiled blocks: the runtime half of the JSX compiler in `@ramonda/build`, which turns every tree of host
elements into a template and the values of its holes. `__template` builds a tree's static part once, from a
description, with the DOM's own calls, in an inert document — never parsed from HTML, which rearranges what
it is given, and constructing no custom element and loading no image for it; `__block` carries one render's
values. A block is imported from the template and updated by comparing each hole with the value it wrote
last. A hole is an attribute, written through the attribute rules as any attribute is, an element's one
child — text written straight into its text node, markup through the children diff — or an element's
children. A block a server rendered is hydrated in place once its markup matches the template — tags, the
template's own attributes and text; markup from another template, another route's page, is built instead,
and an attribute only the server wrote goes. A template's static parts are not compared again after that:
what someone else changes or takes out there stays, as an attribute someone else sets does. Measured on
js-framework-benchmark, the idiomatic row compiled beside main, median script time: selecting a row
105.7 → 22.8 ms, creating 10,000 rows 389.1 → 194.4 ms.
