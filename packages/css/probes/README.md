# Probes

Each file here measured one claim a decision in `DESIGN.md` rests on, before the code that depends
on it was written. They are the evidence, so they are kept — but they are not tests, nothing runs
them, and the package moved on after most of them were written.

Run one from the repository root, after `pnpm --filter @ramonda/css build`:

```
node packages/css/probes/prototype-scale.mjs
```

Three no longer run against the current code, and each says why when it is run:
`prototype-composition.mjs` imports `merge`, which is `mergeClassNames` now; `prototype-layers.mjs`
and `prototype-package-skew.mjs` build sheets in a shape the `Sheet` has since changed.
`prototype-typecheck.mjs` takes its fixture as an argument — `probes/example.tsx.txt`. What they
measured is written down beside the decision, in `DESIGN.md`.

The `.txt` fixtures are named so that no tool in the repository tries to read them as source — the
syntax is not TypeScript.
