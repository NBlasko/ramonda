# apps/docs

The Ramonda documentation site — [ramonda.pages.dev](https://ramonda.pages.dev). It is itself a Ramonda
app: written with the framework, prerendered to static HTML by `renderPage`/`renderDocument` from
`@ramonda/core` and `routePaths` from `@ramonda/router`, then hydrated. Which makes it the framework's
largest test that server rendering works.

## The pipeline

```
turbo run build --filter=@ramonda/docs
```

- **`content`** — `scripts/build-content.mjs` turns `content/**.md` into vnode trees under
  `src/generated/`, with Shiki highlighting done at build time.
- **`check-api`** — fails the build when a public export is missing from `content/reference/api.md`, or
  when a diagnostic is raised in a package and has no section in `content/reference/diagnostics.md`. Both
  have self-tests (`DOCS_SELFTEST=api`, `DOCS_SELFTEST=diagnostics`), so a green run means something.
- **`build:client` / `build:server` / `prerender` / `index`** — esbuild twice, one HTML file per route,
  then a Pagefind index.

**`content` is a turbo task rather than a step inside the other scripts.** It used to be called by both
`check-types` and `build`, which turbo runs in parallel — so two processes rewrote `src/generated/` while
`tsc` was reading it, and three intermittent failures turned out to be that. Both declare
`dependsOn: ["content"]` now, so it runs once. Running `npm run build` in this directory without turbo
therefore needs `npm run content` first.

## Screenshots

```
npm run shots
```

`scripts/shots.mjs` starts the playground, drives a real Chrome over the DevTools Protocol, and writes
`public/devtools/*.webp` plus the badge GIF. Nothing is installed for it — Chrome and `ffmpeg` are the
only requirements, and Node's own `WebSocket` speaks CDP — a global that needs Node 22+, which `.nvmrc`
comfortably covers. Regenerate it after changing the panel: a
screenshot cannot fail a build, so a stale one stays wrong until somebody notices.
