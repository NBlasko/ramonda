---
"@ramonda/css": patch
---

Every config-driven rule is now measured inside a nested rule.

No behaviour changed — the recursion was already right — but not one of the six rules a project's
config turns on had ever been exercised inside `&:hover { … }`, which is exactly where a hover
colour and a focus ring are written. A `variablesOnly` that stopped at the top level would have
exempted the declarations most likely to hold a hardcoded one, and nothing would have said so.
