---
"@ramonda/check": minor
---

`unsplittable-import` no longer reports a template the bundler can read, and `unexposed-env-read`
reads both spellings of an env variable.

**A FALSE REPORT on a documented feature.** `` import(`./pages/${name}.js`) `` is not a path a
bundler cannot read — Vite turns it into a chunk per matching file. Measured with Vite 7 rather than
reasoned about, and the boundary measured with it:

| written | modules transformed | chunks emitted |
|---|---|---|
| `` `./pages/${w}.js` `` | 4 | `a-*.mjs`, `b-*.mjs` — **split** |
| `` `./pages/${w}` `` — no suffix | 1 | none |
| `` `pages/${w}.js` `` — not relative | 1 | none |
| `import(specifier)` | 1 | none |

So a template splits only with a RELATIVE head and a non-empty tail after the last substitution, and
that is exactly what is left alone now. The last three rows are the rule's own claim confirmed:
nothing is emitted, and at run time there is nothing to fetch.

**`import.meta.env["VITE_API_URL"]` is the same read as `import.meta.env.VITE_API_URL`**, and the
rule saw only the dot. A key held in a `const` — what a project with more than two of them does — is
the same read one hop further, and is read now too. A key nothing settles is still not judged, and
neither is the public prefix or a name the bundler provides itself.

No change to what is reported on any project in this repository.
