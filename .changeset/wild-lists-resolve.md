---
"@ramonda/check": minor
---

`row-reads-a-plain-field` finds core's `list` under an alias and through a re-export.

It used to scan a file's imports for a binding called `list` and take the FIRST one, which is wrong
in two ways. A file importing it twice — `import { list, list as rows }` — got whichever name came
first, so calls through the other were invisible. And a re-export was invisible entirely:
`export { list } from "@ramonda/core"` in an app's own `ui` module hands on the framework's own
binding, and the rows it builds are cached exactly the same way.

Resolved through the alias chain now, which takes nothing away: an app's own function called `list`
has its own declaration and no chain leading to core, so it still resolves to itself and is still
left alone.

`importedFromCore` does the walking, so `Head`, `requestContext` and the context pair all follow a
re-export now too. It needed one more question of the checker — `resolveStep`, a single hop along an
alias chain — because neither existing resolver can answer this: `resolve` jumps to the end, where
the path differs per project, and `resolveLocal` does not move at all, where the specifier says
`./ui`. Stepping is the only way to read the chain the reader actually wrote.

No change to what is reported on any project in this repository.
