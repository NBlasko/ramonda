import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/**
 * Renders `preview.png` — what a block actually looks like with this extension installed.
 *
 *   node build-preview.mjs          # render it
 *   node build-preview.mjs --check  # fail if the code or the grammars have moved since (for CI)
 *
 * ## Why an image, which is the part worth explaining
 *
 * The user, reading the published marketplace page: *"u sam marketplace kada gledam docs, extension
 * primer kod nema bas te boje koje je potrebno da da."* They are right, and no change to the README
 * can fix it: the marketplace renders markdown with its own highlighter, and so do npm and GitHub.
 * None of the three has a way to load somebody else's grammar.
 *
 * Measured with `highlight.js`, which is the shape those renderers use: a block comes out with
 * `const` coloured and the CSS inside plain. Not wrong — just not the thing the extension is for.
 * An extension whose whole subject is colour has to SHOW the colour.
 *
 * ## Why it is generated rather than screenshotted
 *
 * A screenshot taken by hand goes stale silently, and this one is a claim about the grammars in this
 * folder. It is rendered from THOSE grammars, through shiki, and stamped with a hash of them plus
 * the code — so `--check` fails when either moves. The same bargain `build-og-png.mjs` makes, for
 * the same reason: an image cannot be diffed, so the question asked is "was this made from this".
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `shiki` and Chromium resolved from packages that HAVE them.
 *
 * This folder is deliberately not a workspace package — `tools/vscode-css` is published to the
 * marketplace and nothing installs it — so it has no `node_modules` of its own. The engine
 * generators in `scripts/` reach for playwright the same way and for the same reason.
 */
const from = (pkg, name) => createRequire(join(here, "..", "..", pkg, "package.json"))(name);
const { createHighlighter } = await import(
  createRequire(join(here, "..", "..", "packages", "css", "package.json")).resolve("shiki")
);
const pngPath = join(here, "preview.png");
const stampPath = join(here, "preview.png.stamp");
const check = process.argv.includes("--check");

/** The grammars this extension contributes, read from its own manifest so the two cannot drift. */
const manifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const grammars = manifest.contributes.grammars.map((one) => ({
  ...JSON.parse(readFileSync(join(here, one.path), "utf8")),
  name: one.path.split("/").pop().replace(".tmLanguage.json", ""),
  injectTo: one.injectTo,
}));

/**
 * What the picture shows, and each line earns its place.
 *
 * A block in a tag and a block in a binding are the two spellings; `$` is a declared variable; a
 * nested rule and a hole are what a reader wants to see coloured differently from the CSS around
 * them. Nothing here is a feature the extension does not have.
 */
const CODE = [
  "const panel = @@(",
  "  padding: $.space.gutter;",
  "  background: $.color.surface;",
  ");",
  "",
  "const card = (loud: boolean) => (",
  "  <div css={@@(",
  "    ...{panel};",
  '    color: {loud ? "#f05" : "#333"};',
  "    &:hover { border-color: $.color.accent; }",
  "  )}>Hello</div>",
  ");",
  "",
].join("\n");

const stamp = createHash("sha256")
  .update(CODE)
  .update(grammars.map((one) => JSON.stringify(one)).join("|"))
  .digest("hex");
const held = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";

if (held === stamp && existsSync(pngPath)) {
  if (check) console.log("[preview] up to date");
  process.exit(0);
}

if (check) {
  console.error(
    "[preview] preview.png was not rendered from the current grammars and sample\n" +
      "          it is an image, so nothing else would ever notice.\n" +
      "          run `node build-preview.mjs` in tools/vscode-css and commit the result.",
  );
  process.exit(1);
}

const highlighter = await createHighlighter({ themes: ["github-dark"], langs: ["tsx", "css", ...grammars] });
const html = highlighter.codeToHtml(CODE, { lang: "tsx", theme: "github-dark" });

const { chromium } = from(join("apps", "playground-core"), "@playwright/test");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 780, height: 480 }, deviceScaleFactor: 2 });
  await page.setContent(
    "<!doctype html><style>" +
      "html,body{margin:0;padding:0;background:#24292e}" +
      "pre{margin:0;padding:28px 32px;font:15px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;background:#24292e!important}" +
      "#shot{display:inline-block;border-radius:10px;overflow:hidden}" +
      '</style><div id="shot">' +
      html +
      "</div>",
  );
  await page.locator("#shot").screenshot({ path: pngPath });
} finally {
  await browser.close();
}

writeFileSync(stampPath, stamp + "\n");
console.log("[preview] rendered preview.png from this folder's own grammars");
