---
"create-ramonda": minor
---

A scaffolded SSR project sets a title and a description on every page.

The template used none, which made a poor starting point for the one kind of project where it
matters most: server rendering earns its cost with readers who never run your JavaScript — a
crawler, a link preview, a reader mode — and what they see is what is in the file. A generated
project shipped every route under the shell's one `<title>`.

Each page now has its own `Head`, including the dynamic route, which builds its title from the
param. It is also what makes the head reachable by a check: the template exercising none is why a
render that silently dropped it went unnoticed until it was measured by hand.
