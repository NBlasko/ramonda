---
"@ramonda/check": minor
"create-ramonda": patch
---

`field-read-before-it-is-declared`, an error: a hook's props callback reads a field declared below the `use`. `this.use` calls the callback while the fields are still being set from the top down, so a hook there is a bare `TypeError` at mount and a plain field reads `undefined` for good — and TypeScript sees neither, because the read is inside a function. A new project's `AGENTS.md` names the rule.
