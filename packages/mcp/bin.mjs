#!/usr/bin/env node
/**
 * The launcher, committed, because a bin that IS a build output cannot be linked before it is built —
 * see `@ramonda/check`'s own `bin.mjs`, which this follows.
 *
 * TypeScript 7 has no JavaScript API, and the checker this server runs reads source through it. Said
 * on stderr, because stdout belongs to the protocol and a client would read the sentence as a message.
 */
const { default: ts } = await import("typescript");
if (typeof ts.createProgram !== "function") {
  console.error(
    `[ramonda-mcp] TypeScript ${ts.version ?? "(unknown version)"} is installed, and it has no JavaScript API to read your source with. ` +
      "Install TypeScript 5 or 6: `npm install -D typescript@6`.",
  );
  process.exit(2);
}

await import("./dist/cli.js");
