---
"@ramonda/form": minor
---

A field has `issues` beside `errors`: each failure as the schema handed it over, with the `message` and whatever else the validator put on it — a key such as bguard's `code`, what it expected. An app translates by the key and renders its own sentence; `FieldIssue` is the type. An error set with `setError` is an issue with a message and nothing else.
