---
"@ramonda/check": minor
---

`reset-the-model-does-not-hear`: a reset reaches no field with a `value`

The browser's reset puts every field of a form back on screen and tells no handler, so a field with a
`value` shows one thing while its model holds another. A `<button type="reset">` (or `<input
type="reset">`) is allowed inside a `<form>` of the same render, naming no other form, whose content is
all written there and holds no field with a `value` (`checked`); a component, `children` or a value
placed in that form is reported, since it may hold one — a spread on a field included — and so is a
form with an `id`, which a
field anywhere joins with `form="id"`. `reset` is allowed when it is taken from a
hook — `this.form.reset()`, or a field of the form through a `const` — or from a value whose type a form
does not fit, such as a `CanvasRenderingContext2D`. It is read off types, never names: the browser's reset
is reported under any name — a type alias, another variable, `const clear = form.reset`, `form["reset"]`,
`const { reset } = form` — and so is `reset` on a type a form fits (`const r: Resettable = form`), on a
value whose type cannot be read, and a form cast to a type that is not one (`form as unknown as Canvas`).
It trusts the type the author writes, as TypeScript does: a form put through `unknown` and given another
type is that type from there on.
A `<button>` whose `type` cannot be read, or is left to a spread, may reset its form, and is reported
only when that form holds something a reset would undo.
