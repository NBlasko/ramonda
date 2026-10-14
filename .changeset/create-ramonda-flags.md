---
"create-ramonda": minor
---

Every question has a flag now, so the scaffolder runs from a script, CI or an agent: `--mode spa|ssr`, `--add css,query,…|none`, `--git` / `--no-git`, `--install` / `--no-install`, `--overwrite`, and `--yes` for the defaults. `--help` and `--version` print and exit. With no terminal, a question nothing answers stops the run with exit 1 and names the flags — it used to draw the prompt and exit 0 having made nothing. `--yes` never writes into a folder that is not empty; that takes `--overwrite`.

A generated project:

- `npm test` runs once and exits (`vitest run`); `test:watch` watches.
- `npm run check` runs everything the project has — lint, tests, build.
- The SSR entry guards the devtools panel with `import.meta.env.DEV`, as the docs do, instead of `__DEV__`.
- SSR no longer offers Router as an option: it always includes it.
- Its README names each package you chose, with the page to start from, and says what `typecheck` runs when it is `ramonda-css`.
