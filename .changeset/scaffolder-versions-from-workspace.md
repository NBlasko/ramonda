---
"create-ramonda": minor
---

Every version the scaffolder writes now comes from the workspace, and the scaffolder has
tests.

**The build tools are derived like the framework packages already were.** `vitest`, `vite`,
`jsdom`, `@types/node` from `packages/core`, `typescript` and `@biomejs/biome` from the root,
`esbuild` from `apps/docs` — read at build time. They were hand-written constants, and one had
drifted a whole major: the template pinned `vitest@^3.2.4` while core, testing-library and the
docs app were all on `^4.1.10`, so a generated project tested against a version the framework
does not use. Exact pins are widened to a caret, because this repo pins some tools exactly for
a reproducible lockfile and a generated project does not want that.

**`vite` is installed with the testing add-on**, because it is a PEER dependency of vitest
(`^6 || ^7 || ^8`). Without it vitest has no transform: measured on a scaffolded SSR project,
the `.tsx` reached the runtime unchanged and the suite died with `SyntaxError: Invalid or
unexpected token` and `0 test`. The SPA template had vite already, which is why only SSR was
broken — and why the bug survived the fix for the vitest version.

**Twelve tests, none of which need a network or an install.** They check the built CLI rather
than the source, because the ranges are injected at build time — the source cannot tell you
what a user would get. Each case stands for a defect that shipped: one range for all
first-party packages, a tilde where a caret would pin a single patch, a missing vitest peer,
the `pnpm-workspace.yaml` with both spellings of the build-approval key, the absence of the
`pnpm` field in package.json (pnpm 11 ignores it), the devtools import with the right guard per
template, and the SSR template's development/production build split.

Type-checking a scaffolded project is deliberately NOT among them: it needs a real install to
resolve `@ramonda/*` and `vitest`, and a symlink to this workspace's `node_modules` does not
provide those under pnpm's isolated layout. That belongs to the end-to-end pass, which is now
written down as a skill (`.claude/skills/update-dependencies`) — including the part no unit
test can do: scaffolding a project and running it with pnpm 10 and 11, since this repo pins
pnpm 9, whose behaviour is not the one users get.
