/**
 * Boots the built server and asks it for a page.
 *
 * This exists because of a crash it would have caught. Core runs a block of browser setup at
 * import time in a development build, guarded — at the time — by `typeof document !== "undefined"`.
 * This server gives its Node process a jsdom document, so the guard passed and
 * `customElements.whenDefined` threw `ReferenceError` while the module was still loading. The
 * server died before serving anything, and nothing in the monorepo noticed: every unit test runs
 * in jsdom, where the same code is fine.
 *
 * So the check is deliberately shallow and deliberately REAL: a child process, the actual bundle,
 * an HTTP request. `/` rather than `/products`, because that route fetches from a public API and
 * a smoke test must not depend on the network.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * A port the OS says is free, not a constant.
 *
 * 5181 was hard-coded, and it failed once under a parallel turbo run: the second server hit
 * EADDRINUSE and died before answering. The worse version of that bug is silent — a leftover
 * server from an earlier run still listening on 5181 would have ANSWERED, and the smoke test would
 * have passed against a build that no longer exists.
 */
const PORT = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const server = spawn("node", ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output += chunk;
  });
}

const stop = () => {
  server.kill("SIGTERM");
};

const fail = (message) => {
  stop();
  console.error(`[smoke] ${message}\n\n--- server output ---\n${output.trim() || "(nothing)"}`);
  process.exit(1);
};

server.on("exit", (code) => {
  // Exiting before the request is the failure this was written for.
  if (code !== null && code !== 0) fail(`the server exited with code ${code} before serving anything`);
});

/** Waits for the port rather than a fixed sleep, so a slow machine does not fail spuriously. */
async function waitForServer(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`http://localhost:${PORT}/`);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return undefined;
}

const response = await waitForServer();
if (!response) fail("the server never answered on port " + PORT);
if (!response.ok) fail(`GET / answered ${response.status}`);

const html = await response.text();
const checks = [
  ["the app's root", '<div id="app">'],
  ["server-rendered content", "<h2>Home</h2>"],
  ["a hydration blob", "data-ramonda-state"],
];

for (const [what, needle] of checks) {
  if (!html.includes(needle)) fail(`GET / is missing ${what} (${needle})`);
}

stop();
console.log(`[smoke] the server rendered / with ${html.length} bytes, and all ${checks.length} checks passed`);
