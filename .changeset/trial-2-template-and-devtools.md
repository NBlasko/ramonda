---
"create-ramonda": patch
"@ramonda/devtools": patch
"@ramonda/core": patch
---

Template and devtools findings from the second trial:

- The SSR template's `scripts/build.mjs` sets `NODE_ENV` to `production` before it asks for its defines. `import.meta.env.DEV` follows `NODE_ENV`, so a shell exporting `NODE_ENV=development` shipped every development branch, the devtools import among them, in the production bundle. An existing project can copy the one line.
- The SSR template no longer defines or declares `__DEV__`. Nothing a project installs reads it — every package picks its development or production build through its `exports` conditions — and the installation page already said a project does not need it, while `vite.config.ts` defined it with no word why. A project's own development branch is `import.meta.env.DEV`.
- No `CLAUDE.ramonda.md` is written beside a `CLAUDE.md` that already has a line `@AGENTS.md`, which is all the project's says.
- With style blocks and Biome both chosen, the README says why `biome.json` leaves `src` out: `npm run lint` and `npm run format` hand it to `ramonda-css`, which runs the project's own Biome over every file in it.
- The scaffolded entry calls the devtools badge what it looks like, a round R.
- The devtools panel shows what each `@compute` holds under **Computed**, read off its cache and never by running it, and the cache counters under **Cache**, as text rather than as a quoted string that read as the getter's value. A `Map` and a `Set` open into their entries like an array, where a `Map` showed as `Map [object Map]`.
