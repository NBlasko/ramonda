---
"create-ramonda": minor
---

Every question has a flag now, so the scaffolder runs from a script, CI or an agent: `--mode spa|ssr`, `--add css,query,…|none`, `--git` / `--no-git`, `--install` / `--no-install`, `--overwrite`, and `--yes` for the defaults. `--help` and `--version` print and exit. With no terminal, a question nothing answers stops the run with exit 1 and names the flags — it used to draw the prompt and exit 0 having made nothing. `--yes` never writes into a folder that is not empty; that takes `--overwrite`.

`--mode` and `--add` ignore case; an empty `--add`, `none` beside an add-on, a `--no-` form of anything but `--git` and `--install`, and a file where the folder should be are refused with a sentence. A flag, a mode or an add-on one slip away from a real one is named: `--mood` → `--mode`, `quey` → `query`. The closing note adds `npm run check`, the command to run before a commit, and links the page that explains every script.

A generated project:

- `npm test` runs once and exits (`vitest run`); `test:watch` watches.
- `npm run check` runs everything the project has — lint, tests, build.
- The SSR entry guards the devtools panel with `import.meta.env.DEV`, as the docs do, instead of `__DEV__`.
- SSR no longer offers Router as an option: it always includes it.
- Its README names each package you chose, with the page to start from, and says what `typecheck` runs when it is `ramonda-css`.
