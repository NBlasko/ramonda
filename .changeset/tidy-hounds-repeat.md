---
"@ramonda/core": minor
---

Two diagnostics from reading React's warning list: RMD028 and RMD029

**RMD028 — markup the HTML parser is not allowed to keep where you put it.** A `<div>` inside a
`<p>`, an `<li>` outside a list, a `<tr>` outside a table, a `<form>` inside a `<form>`. All of them
work perfectly on the client, because the DOM is built with `appendChild`, which puts a node exactly
where it is told. A parser does not:

```
your markup:    <p>intro<div>a block</div></p>
what a browser
builds from it: <p>intro</p><div>a block</div>
```

So the mistake is invisible through any amount of SPA development and appears the first time the
page is server-rendered — and what it reported then was a hydration mismatch (RMD007) whose advice
is about `new Date()` in `render()`. The server sent the right markup; the parser moved it. This
says so at the moment the element is created, and names what the parser will do with it.

**RMD029 — a boolean attribute given the string `"false"`.** `disabled="false"` disables the
control; `hidden="false"` hides the element. A boolean attribute is true whenever it is present, so
the string turns it on and the element does the opposite of what the line says. Pass the boolean —
`disabled={false}` removes the attribute, which is what makes it off.

Not fixed for you on purpose: `<input disabled="false">` is disabled in every browser by the HTML
spec, and quietly deciding otherwise would make our JSX mean something different from the markup it
emits. Only the exact string `"false"`, and only on the spec's boolean attributes — `aria-hidden="false"`
is valid and is left alone.

Both are development-only and read tag names and one value; production builds strip them.
