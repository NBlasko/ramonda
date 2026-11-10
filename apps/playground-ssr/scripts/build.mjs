#!/usr/bin/env node
/**
 * The three bundles this playground needs: the client, the server, and the diagnostics fixture.
 *
 * A script rather than three `esbuild` command lines, because of `ramondaOptions`. It carries the
 * settings Ramonda needs from the transform — `jsx`, `jsxImportSource` and `target` — and spreading
 * it is one thing to get right instead of three, in each of three places, kept in step by hand.
 *
 * `target` is the one that bites: Ramonda's decorators are TC39 stage-3 and no engine parses them,
 * so a build that does not lower them emits a file that dies with `SyntaxError: Invalid or
 * unexpected token` on the first page load. That reached a browser once. `esnext` — which is also
 * esbuild's DEFAULT — is the broken value, so a command line that merely forgets the flag has
 * already chosen it. `ramonda-check-bundle` at the end of `build` is the second line of defence;
 * this is the first.
 *
 * Usage: node scripts/build.mjs [client|server|fixture]   (all three when given nothing)
 */
import { build } from "esbuild";
import { ramonda, ramondaOptions } from "@ramonda/build/esbuild";

/**
 * Every `@ramonda/*` import resolved to this workspace's SOURCE.
 *
 * The point of a playground: it is built against the tree you are editing, not against whatever is
 * installed, so a change in `packages/` shows up here on the next build with no publish and no link
 * step. That is this app's own business — nothing about it is a Ramonda setting — which is why it
 * sits beside the spread rather than inside it.
 */
const packages = "../../packages";
const source = {
  "@ramonda/core/jsx-dev-runtime": `${packages}/core/src/jsx-dev-runtime.ts`,
  "@ramonda/core/jsx-runtime": `${packages}/core/src/jsx-runtime.ts`,
  "@ramonda/core": `${packages}/core/src/index.ts`,
  "@ramonda/router": `${packages}/router/src/index.ts`,
  "@ramonda/query": `${packages}/query/src/index.ts`,
  "@ramonda/form": `${packages}/form/src/index.ts`,
};

const shared = {
  // Both halves on purpose. The spread STATES the settings, where a reader can see them; the
  // plugin REFUSES a target that would leave the decorators in — including one written below this
  // spread, which silently wins otherwise. Measured: `target: "esnext"` under the spread alone
  // builds happily and exits 0, and the failure surfaces later as a bundle that does not parse.
  plugins: [ramonda()],
  ...ramondaOptions,
  bundle: true,
  format: "esm",
  // `true`, not `false` as a production build would use: this playground exists to exercise the
  // development diagnostics, and the smoke suite reads what they print.
  define: { __DEV__: "true" },
};

const targets = {
  client: {
    ...shared,
    entryPoints: ["src/entry-client.tsx"],
    // Inline, because the devtools smoke check resolves a component back to its source through it.
    sourcemap: "inline",
    alias: {
      ...source,
      "@ramonda/query/devtools": `${packages}/query/src/devtools.ts`,
      "@ramonda/form/devtools": `${packages}/form/src/devtools.ts`,
      "@ramonda/devtools": `${packages}/devtools/src/index.ts`,
    },
    outfile: "dist/client/assets/client.js",
  },
  server: {
    ...shared,
    entryPoints: ["src/entry-server.tsx"],
    platform: "node",
    alias: {
      ...source,
      "@ramonda/router/server": `${packages}/router/src/server.ts`,
      // A stub, because the panel is a browser thing and importing it would drag the DOM into a
      // server bundle.
      "@ramonda/devtools": "./devtools-stub.ts",
    },
    outfile: "dist/server/entry-server.js",
  },
  fixture: {
    ...shared,
    entryPoints: ["diagnostics-fixture.tsx"],
    platform: "node",
    alias: { ...source, "@ramonda/devtools": "./devtools-stub.ts" },
    outfile: "dist/server/diagnostics-fixture.js",
  },
};

const asked = process.argv[2];
if (asked !== undefined && targets[asked] === undefined) {
  console.error(`[build] no such target: ${asked} — one of ${Object.keys(targets).join(", ")}`);
  process.exit(2);
}

for (const [name, options] of Object.entries(targets)) {
  if (asked !== undefined && asked !== name) continue;
  await build(options);
  console.log(`[build] ${name} → ${options.outfile}`);
}

// The shell the client is served from, with the dev entry rewritten to the built bundle.
if (asked === undefined || asked === "client") {
  const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  mkdirSync("dist/client", { recursive: true });
  writeFileSync(
    "dist/client/index.html",
    readFileSync("index.html", "utf8").replace("/src/entry-client.tsx", "/assets/client.js"),
  );
}
