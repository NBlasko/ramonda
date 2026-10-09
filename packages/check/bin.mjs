#!/usr/bin/env node
/**
 * The launcher, committed, because a bin that IS a build output cannot be linked before it is built.
 *
 * `pnpm install` on a fresh checkout creates a package's bin links from what is on disk at that
 * moment, and `dist/cli.js` is not there yet — it warns and skips, and every build that calls
 * `ramonda-check` then fails with `not found`. A file that is always present takes the link, and
 * the build output is reached through it.
 */

/**
 * TypeScript 7 has no JavaScript API — its package exports `version` and nothing else — and the
 * analyzer reads source through that API at load time, so without this the run ends on *Cannot read
 * properties of undefined* before any of its own code can speak. Asked here, before `dist` loads.
 * `@ramonda/css` says the same sentence from `src/adapters/typescriptApi.ts`; this bin is not built,
 * so it cannot share it.
 */
const { default: ts } = await import("typescript");
if (typeof ts.createProgram !== "function") {
  console.error(
    `\n[ramonda-check] TypeScript ${ts.version ?? "(unknown version)"} is installed, and it has no JavaScript API to read your source with. ` +
      "Install TypeScript 5 or 6: `npm install -D typescript@5`.\n",
  );
  process.exit(1);
}

await import("./dist/cli.js");
