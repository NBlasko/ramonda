---
"@ramonda/form": minor
---

A field's own `setError` — `form.fields.email.$.setError("already registered")` — beside `form.setError(path, message)`. A field that is not in the schema is a type error there, where a string path is checked by nobody; `Field` has it too. `form.setError(path, message)` stays, for an API that names the field itself.
