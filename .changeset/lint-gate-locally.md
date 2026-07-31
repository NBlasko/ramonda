---
"@ramonda/core": patch
---

Two committed failures that `turbo run` cannot see, and a `pnpm check` that would have caught them.

The branch was green on `turbo run check-types test build` while carrying a sparse array in
`apps/playground-ssr/server.mjs` (`?? [, target]`, which oxlint's `no-sparse-arrays` refuses) and a
misformatted `apps/playground-core/src/pages/QueryPage.tsx`. Both would have failed `ci.yml`.

The reason turbo missed them: **no app under `apps/` has a `lint` script**, so `turbo run lint` covers
`packages/` only — and `format:check` is not a turbo task at all. Both are root scripts, and CI runs the
root scripts. `pnpm check` now runs the same four in the same order, and the gap is written down in
`.github/workflows/README.md` rather than left to be rediscovered.

The parse rewrite was checked against the original on seven inputs, including the no-colon and
`src/x.tsx::9` cases, before replacing it.
