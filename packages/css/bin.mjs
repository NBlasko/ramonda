#!/usr/bin/env node
/**
 * The launcher, committed, because a bin that IS a build output cannot be linked before it is built.
 *
 * `pnpm install` on a fresh checkout creates a package's bin links from what is on disk at that
 * moment, and `dist/cli.js` is not there yet — it warns and skips, and every build that calls
 * `ramonda-css` then fails with `not found`. A file that is always present takes the link, and the
 * build output is reached through it.
 *
 * ## Why it says so rather than throwing
 *
 * This file already explained that `dist/cli.js` may not be there and then imported it anyway. On a
 * tree where it is missing, node prints `ERR_MODULE_NOT_FOUND` and a ten-frame stack naming
 * `internal/modules/esm/resolve` — which says nothing about a build, and which cost a reproduction
 * to connect to one. It happened in CI: the `Lint and format` job runs `pnpm lint`, `pnpm lint` runs
 * `ramonda-css lint`, and that job builds nothing. A developer never sees it, because a working tree
 * has `dist` from the last build; a fresh checkout always does.
 *
 * So the check is here, where the fact is known, rather than in each of the places that call this.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = new URL("./dist/cli.js", import.meta.url);

if (!existsSync(fileURLToPath(cli))) {
  console.error(
    `\n[ramonda-css] @ramonda/css is not built, so there is no command to run yet.\n` +
      `[ramonda-css] ${fileURLToPath(cli)} does not exist.\n\n` +
      `[ramonda-css]   pnpm exec turbo run build --filter=@ramonda/css\n\n` +
      `[ramonda-css] This is not a broken install. \`bin.mjs\` is committed so the bin link exists\n` +
      `[ramonda-css] before the build does — see the comment at the top of this file.\n`,
  );
  process.exit(1);
}

await import(cli.href);
