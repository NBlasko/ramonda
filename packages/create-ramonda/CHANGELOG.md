# create-ramonda

## 0.0.4

### Patch Changes

- 7b530bb: Add an optional **Biome** choice to the scaffolder — one tool for both linting and
  formatting.

  Picking it drops a `biome.json` (recommended lint rules via Biome 2.x's `preset`,
  2-space / 120-column formatter, git-ignore aware) into the project, adds
  `@biomejs/biome` as a dev dependency, and wires up `lint` (`biome lint .`) and
  `format` (`biome format --write .`) scripts. Both templates ship already formatted the
  way the config expects, so a fresh project is clean on the first run — `format` reports
  no changes and `lint` passes.

- 7b530bb: The SSR template now handles server-side redirects, and `@ramonda/*` are pinned so
  scaffolds can actually pick up new releases.

  - The generated `entry-server` catches `ServerRedirect` and hands `server.mjs` a
    plain `{ redirect }`, which answers with a 302 — so a route guard added to a
    scaffolded SSR app works on the first load, not just after hydration.
  - `@ramonda/*` dependencies switch from `^0.0.1` to `~0.0.1`. On a `0.0.z` version
    the caret pins to that exact patch, so scaffolds were frozen at 0.0.1 and could
    never install a newer framework — including the release that adds the redirect API
    the template above uses. The tilde (`>=0.0.1 <0.1.0`) lets a scaffold take the
    latest 0.0.x while the scaffolder still gates the 0.1 / 1.0 line itself.

## 0.0.3

### Patch Changes

- Scaffolded apps now show the rotating Ramonda flower (an inline SVG whose petals inherit the accent colour) instead of a placeholder dot — in both the SPA and SSR templates. Also fix the Testing add-on's generated test: it called `render(App)` instead of `render(<App />)`, which was a type error.

## 0.0.2

### Patch Changes

- Fix the CLI doing nothing when run via `npm create ramonda` / `npx create-ramonda`. The "invoked as CLI" guard compared `process.argv[1]` (the `node_modules/.bin` symlink npm runs the bin through) against `import.meta.url` (the real file), so they never matched and `main()` never ran. Compare resolved real paths instead.
