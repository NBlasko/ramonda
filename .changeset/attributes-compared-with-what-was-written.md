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
the server sent is still taken away. A `ref` is applied on every render, as before. A checkbox's
`checked` and `indeterminate` and a media element's `muted` are compared with the element itself, as
before, so the next render restores what a click changed. Other state an element keeps only in a property, such as a media element's `volume` or
`currentTime`, is compared with what Ramonda wrote: a volume the reader moved stays, and a playing video
keeps its place on an unrelated render. `__h` copies an element's attributes object, so one
an app hands it on every render, changed in place, is written as it is now.
