---
"@ramonda/check": minor
---

A component writing the document instead of rendering it.

`document.documentElement.classList.toggle("drawer-open", this.open)` is rendering, done
imperatively. The class it writes is a second copy of a field the component already holds: kept in
step by hand, cleaned up on unmount by hand, and remembered by whoever adds the next handler that
touches the same state. Said in `render()` it cannot drift, because there is only one of it — and
`html:has(.drawer-open)` reaches the document from a class a descendant renders, so even the page
itself can be styled from state a component owns.

Reported: an assignment — with ANY assignment operator, because `className += " open"` is how this
is usually spelled — to `className`, `textContent`, `innerHTML`, `innerText`, `id` or anything under
`style`, whether reached by name or by a computed key; and a call to `setAttribute`,
`removeAttribute`, `toggleAttribute`, `insertAdjacentHTML`, a `classList` method or
`style.setProperty`, which is how a component usually pushes theme state onto the document. On
`document`, `document.body`, `document.documentElement`, or whatever a global query hands back.

**A COMMAND is not this, and the difference is the whole rule.** `scrollIntoView()`, `focus()`,
`select()` and `getBoundingClientRect()` have no declarative form — they tell the browser to do
something rather than describing what it looks like — and a rule that caught them would be one
people switch off. An element you created yourself is not reported either: it is reached through a
local, and reading what a local holds is dataflow, which this resolver refuses by decision, so that
falls out of the design rather than needing a case of its own.

**A warning, not a failure**, per the rule here for adding a rule. Measured across every project in
this repository: zero reports. What looked like violations were a custom element (`@ramonda/devtools`
is an `HTMLElement`, not a component), a READ of `textContent`, and a `<style>` built at module
scope — none of them a component writing what it could have rendered.
