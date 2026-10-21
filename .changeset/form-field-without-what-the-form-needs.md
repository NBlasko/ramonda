---
"@ramonda/check": minor
---

`form-field-without-what-the-form-needs`: a field inside a `@ramonda/form` form carries every attribute the form needs

A `@ramonda/form` form is recognised by one shape — `<form onsubmit={this.X.submit}>`, where `X` is a
field of the same class initialised `this.use(Form, …)` and `Form` is imported from `@ramonda/form` —
and every controlled field inside it is written with `name`, `value` (`checked` on a box), `oninput`,
`onblur` and `aria-invalid`, each by name. "Inside" is the render that holds the form, every component
rendered there in turn, and the children of a component that places its children in its own form. A
component that takes those attributes as props is checked where it is used inside a form: each use
hands every one of them. A spread of a prop on a field — defaults, then `{...this.props.attrs}` for a
caller to overwrite them — is checked at every use, inside a form or not: an object written there,
setting none of them to nothing — a shorthand `{ oninput }` followed to the `const` it names — and
handing no `value` (`checked`) without an `oninput` or `onchange` beside it, unless the field writes its
own.

Reported too: a component that holds a `Form` and renders no `<form onsubmit={this.X.submit}>` for it,
a hook that holds one, and a component used inside a form whose render cannot be read — a `declare
class`, or one from a package's declarations.
