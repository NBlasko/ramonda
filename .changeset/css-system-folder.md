---
"@ramonda/css": minor
---

Codegen writes into `css-system/`, and the output is meant to be committed.

```
ramonda.css.ts
css-system/
  index.ts         $, Value, Var, and this project's narrowed property map
  variables.css    :root, and an @property for each
```

```ts
import { $, type Value } from "../../css-system";
```

**It was `ramonda.css.generated.ts` and `.css`, gitignored — and the reason for hiding them was
wrong.** It said committing would let a config and its output drift apart in review. Hiding a file
does not stop it drifting, it stops anybody seeing that it has, and it costs a fresh clone its `$`
until something builds. `check-css-system.mjs` runs codegen and compares instead, the way this
repository already gates its own generated tables.

`outDir` renames the folder for a project that already has one by that name.

**Breaking:** move your imports from `ramonda.css.generated` to `css-system`, run
`ramonda-css codegen`, and drop the `.gitignore` lines.
