---
"@ramonda/core": minor
---

An element's attributes are compared with what Ramonda wrote, not read back from the page

Each update read every attribute of an element back from the page and compared the render with that —
the largest single cost in every profile of js-framework-benchmark. The page was then the record of what
Ramonda meant, so an attribute anyone else changed was written back on the next render that touched the
element for any reason: a `<details>` the reader closed opened again, a class a library set was replaced.

An element now remembers what the diff wrote on it, and the next render is compared with that. A change
made by the browser or by another script stays until Ramonda itself changes that value — as in React.
An element no render wrote, one a hydration adopted, is read from the page once, so an attribute only
the server sent is still taken away. A `ref` is applied on every render, as before. State an element
keeps only in a property, such as a checkbox's `indeterminate` or a media element's `volume`, is compared
with the element itself, so the next render restores what a click cleared, as before.
