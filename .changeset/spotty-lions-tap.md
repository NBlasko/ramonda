---
"@ramonda/core": patch
---

A hydrated page's `Head` owns the tags the server wrote

The server puts the title and the meta tags in the HTML, and on the client the hook has to ADOPT
them: `claim()` is what puts a tag into `owned`, and `@destroy` removes exactly what is owned.
Adopting happens inside `apply()` — and on a hydrated page `apply()` never ran.

`applyOnCreate` is `@create({ env: "shared" })`, hydration runs only the `env === "client"` creates
(create and mount already ran on the server, and their state was restored), and `@watchProp`
deliberately does not fire on mount. So nothing claimed them: the tags belonged to nobody, and a page
that unmounted with nothing replacing it left them in the document. In an app that navigates the next
page's `Head` claims them on its way past, which is why this stayed invisible.

A client-only `@create` now applies as well. On the hydration path it is the only one that runs; on a
client-built page it runs a second time and costs nothing, because `claim` adopts a tag it already
owns only once, `upsert` writes the same values back, and the previous title is captured only while
it is unset. The hook has no way to tell "hydrated" from "built", so one extra call is the cheapest
correct answer.
