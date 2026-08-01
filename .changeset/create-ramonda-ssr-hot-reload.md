---
"create-ramonda": minor
---

SSR scaffolds now have a hot-reload dev server.

`npm run dev` on an SSR project starts a Vite server in middleware mode instead of
building the bundles and booting Node: edit a component and the change is live — the
browser hot-updates the client, and the server picks up the new code on the next
request via `ssrLoadModule`, with no restart and no build step. Production is
unchanged: `npm run build` + `npm start` still serve the esbuild bundle.

The one thing that made this work with Ramonda's TC39 decorators is `esbuild.target:
"es2022"` in `vite.config.ts` — Vite's default SSR target (`esnext`) leaves decorators
in the output, which Node can't parse (`ssrLoadModule` died on `@Host(...)`). es2022
down-levels them. `vite` is added as a dev dependency of the SSR template; `server.mjs`
branches dev (Vite) vs `--prod` (built output).
