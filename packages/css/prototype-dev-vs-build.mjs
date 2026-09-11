/**
 * The dev server against the build — does an author see the same styles from both?
 *
 * ## Why this exists, and why it is not the question it looks like
 *
 * The obvious reading is "dev must match prod", and measured against the code before the cascade
 * layers, **it already did** — both were wrong, in the same way, on all six readings below. So
 * agreement between the two was never the broken thing and asserting only that would have passed
 * through the whole fault.
 *
 * What WAS broken shows in the control (turn the layer tree off in `sheet.ts` and run this again):
 *
 *     1280  lazy=false  ->  red
 *     1280  lazy=true   ->  blue
 *
 * Loading a lazy chunk changed the colour of an element already on the page, which has nothing to do
 * with that chunk. A rule's place in the cascade depended on which files were in the build and on
 * when a chunk arrived. So this probe asks both questions: do the two agree, and is the answer
 * RIGHT — the second is the one with teeth.
 *
 * ## The fixture
 *
 * Three files share one rule and one of them arrives in a lazy chunk. Every class is put on one
 * element by hand rather than through `merge`, so nothing is resolved at the call site and the
 * SHEET's order is the only thing deciding — which is the shape review 12 found in a real build.
 *
 * The four ordering rules are all exercised at once: a shorthand against its longhand, an
 * unconditional declaration against a conditional one, and two breakpoints against each other. The
 * three viewports pick a different winner each.
 *
 *     node prototype-dev-vs-build.mjs
 *
 * Chromium is not a dependency of this package, so Playwright is resolved out of
 * `apps/playground-core`, which has it. The plugin comes from `dist`, so **build the package
 * first** — the trap this repository keeps paying for is a probe that reads a stale `dist`.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { builtFromThisSource } from "./built.mjs";

// This probe reads `dist`, and its numbers get written down as facts — see `built.mjs`.
builtFromThisSource();

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"))(
  "@playwright/test",
);

const root = mkdtempSync(join(HERE, "prototype-dev-vs-build-"));
mkdirSync(join(root, "src", "jsx"), { recursive: true });
symlinkSync(join(HERE, "node_modules"), join(root, "node_modules"));
writeFileSync(
  join(root, "package.json"),
  JSON.stringify({ name: "probe", private: true, type: "module", version: "0.0.0" }),
);

// Card writes the shared rule AND two overrides of it, at two breakpoints.
writeFileSync(
  join(root, "src", "Card.tsx"),
  `export const card = @@(\n` +
    `  color: red;\n` +
    `  margin: 0px;\n` +
    `  margin-left: 4px;\n` +
    `  @media (min-width: 40rem) { color: blue; }\n` +
    `  @media (min-width: 64rem) { color: rgb(0, 128, 0); }\n` +
    `);\n`,
);
// Panel writes only the shared halves — the innocent file that used to reverse Card.
writeFileSync(join(root, "src", "Panel.tsx"), `export const panel = @@( color: red; margin: 0px; );\n`);
// And a third, in a chunk that only arrives on a click.
writeFileSync(
  join(root, "src", "Lazy.tsx"),
  `export const lazy = @@( color: red; @media (min-width: 40rem) { color: blue; } );\n`,
);

writeFileSync(
  join(root, "src", "main.ts"),
  `import { card } from "./Card";\n` +
    `import { panel } from "./Panel";\n` +
    `const probe = document.createElement("div");\n` +
    `probe.id = "probe";\n` +
    `probe.className = card.className + " " + panel.className;\n` +
    `document.body.append(probe);\n` +
    `const button = document.createElement("button");\n` +
    `button.id = "load";\n` +
    `button.textContent = "load";\n` +
    `button.onclick = async () => {\n` +
    `  const { lazy } = await import("./Lazy");\n` +
    `  probe.className += " " + lazy.className;\n` +
    `  document.body.dataset.lazy = "yes";\n` +
    `};\n` +
    `document.body.append(button);\n`,
);
writeFileSync(
  join(root, "index.html"),
  `<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>`,
);

const runtimeStub = `export const jsx = (t, p) => ({ t, p });\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "f";\n`;
writeFileSync(join(root, "src", "jsx", "jsx-runtime.ts"), runtimeStub);
writeFileSync(join(root, "src", "jsx", "jsx-dev-runtime.ts"), runtimeStub);
writeFileSync(
  join(root, "vite.config.js"),
  `import { ramondaCss } from ${JSON.stringify(join(HERE, "dist", "vite.js"))};\n` +
    `export default {\n` +
    `  logLevel: "warn",\n` +
    `  plugins: [ramondaCss({ runtime: ${JSON.stringify(join(HERE, "dist", "index.js"))} })],\n` +
    `  esbuild: { jsx: "automatic", jsxImportSource: ${JSON.stringify(join(root, "src", "jsx"))} },\n` +
    `  build: { outDir: "out" },\n` +
    `};\n`,
);

const vite = resolve(HERE, "node_modules", "vite", "bin", "vite.js");
const run = (args) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [vite, ...args], { cwd: root, stdio: "pipe" });
    let said = "";
    child.stderr.on("data", (chunk) => (said += chunk));
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(said))));
  });

const serve = async (args, port) => {
  const child = spawn(process.execPath, [vite, ...args, "--port", String(port), "--strictPort"], {
    cwd: root,
    stdio: "ignore",
  });
  for (let waited = 0; waited < 60_000; waited += 200) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return child;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${args.join(" ")} never came up`);
};

await run(["build"]);
const dev = await serve([], 3021);
const built = await serve(["preview"], 3022);

const browser = await chromium.launch();
const tab = await browser.newPage();

async function readAt(port, width, lazy) {
  await tab.setViewportSize({ width, height: 800 });
  await tab.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
  if (lazy) {
    await tab.click("#load");
    await tab.waitForSelector("body[data-lazy=yes]");
  }
  return tab.evaluate(() => {
    const computed = getComputedStyle(document.getElementById("probe"));
    return {
      color: computed.color,
      marginLeft: computed.marginLeft,
      marginTop: computed.marginTop,
      classes: document.getElementById("probe").className.split(" ").length,
    };
  });
}

/** What the four ordering rules say the answer is, at each width. */
const WANT = {
  390: "rgb(255, 0, 0)",
  700: "rgb(0, 0, 255)",
  1280: "rgb(0, 128, 0)",
};

console.log("width  lazy   dev                          build                        agree   correct");
let differences = 0;
let wrong = 0;
for (const width of [390, 700, 1280]) {
  for (const lazy of [false, true]) {
    const a = await readAt(3021, width, lazy);
    const b = await readAt(3022, width, lazy);
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (!same) differences++;
    const right = a.color === WANT[width] && a.marginLeft === "4px";
    if (!right) wrong++;
    const show = (one) => `${one.color} ml=${one.marginLeft}`;
    console.log(
      `${String(width).padStart(5)}  ${String(lazy).padEnd(6)} ${show(a).padEnd(28)} ${show(b).padEnd(28)} ` +
        `${(same ? "same" : "DIFFER").padEnd(7)} ${right ? "ok" : `WANTED ${WANT[width]} / 4px`}`,
    );
  }
}
console.log(`\n${differences} difference(s) between the dev server and the build, ${wrong} wrong answer(s)`);

await browser.close();
dev.kill();
built.kill();
rmSync(root, { recursive: true, force: true });
