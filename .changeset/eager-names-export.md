---
"@ramonda/check": minor
---

Five rules identified a framework export by the name the FILE gave it, not the name the module
exports.

`import { requestContext as rc }` renames the binding, and so does an app's own module doing
`export { Head } from "@ramonda/core"`. Every one of these rules tested the local name FIRST and
only then asked which module it came from, so both spellings went quiet:

- **`late-request-read`** and **`client-only-request-read`** on `requestContext` and `requestKey`
- **`head-tags-collide`** on `Head`
- **`context-pair`**, which both context rules read through, on `createContext`

`importedFromCore` takes the exported name now and checks it where the chain reaches core — so an
alias and a re-export both resolve, while an app's OWN function of the same name still has its own
declaration, no chain to core, and is still left alone. That last part is the whole reason these
rules resolve rather than match a name, and it is unchanged.

**`late-request-read` also reads the held context two more ways.** `const { headers } = context` and
`context["cookies"]` below an `await` reach the same getters on the same object as `context.headers`
does, and both were silent. The destructure report quotes the line — `{ headers } = context` — rather
than a dotted form that is nowhere on it.

No change to what is reported on any project in this repository.
