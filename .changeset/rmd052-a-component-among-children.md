---
"@ramonda/core": minor
---

`RMD052` — a component among JSX children, where an element was meant.

`{Panel}` names the class instead of rendering it. It is not markup, so it is dropped and the page
comes up without it — and until now nothing said so: the check beside it looks for an OBJECT among
children, and a class is a function, so it fell through with the strings and numbers. Measured before
the code was written: the component simply never appears, and no record is emitted.

Only reported, never replaced. A function child already renders nothing, so putting a hole there
instead would change no page — the report is what was missing.

Handing a component to something else is an attribute rather than a child: `<Slot view={Panel} />`
passes it as a prop, which is a different thing entirely.

`ramonda-check` reports the same mistake from the source, before anything renders.
