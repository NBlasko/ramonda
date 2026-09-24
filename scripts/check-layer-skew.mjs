/**
 * Two stylesheets from two releases on one page, and the right declaration still wins.
 *
 *     node scripts/check-layer-skew.mjs
 *     SELFTEST=order node scripts/check-layer-skew.mjs
 *
 * ## The fault this is for
 *
 * A published package ships CSS it built with one release of this compiler; the application that
 * pulls it in built its own with another. Nothing on the page reconciles them — they agree only
 * about the layer names in their opening statement. Get that wrong and a rule in a package silently
 * beats a narrower rule in the application, in a page nobody edited, with the answer depending on
 * which file the bundler happened to put first.
 *
 * ## Why a browser, and why the REAL `Sheet`
 *
 * Whether a layer order MEANS what it is supposed to mean is the cascade's answer, and the cascade
 * lives in a browser. `prototype-package-skew.mjs` modelled the naming because the scheme was not
 * built; it is built now, so this drives the real compiler, the real `Sheet` and the real
 * `mergeClassNames`, and only the two-sheets-on-one-page arrangement is set up here.
 *
 * **The merge is not optional in the arrangement**, and leaving it out is what made an early version
 * of this report a failure that was not one. For a family the compiler SPLITS, both declarations are
 * longhands with the same key, so `mergeClassNames` settles them before the browser sees a class and
 * the element never carries two. Putting both classes on by hand asks the cascade a question the
 * system never asks it.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;

const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const COMPILER = join(HERE, "..", "packages", "css", "src", "compiler");
const { Sheet } = await loadTs(join(COMPILER, "sheet.ts"));
const { transform } = await loadTs(join(COMPILER, "transform.ts"));
const { mergeClassNames } = await loadTs(join(HERE, "..", "packages", "css", "src", "merge.ts"));

/** One release's stylesheet, through the real compiler and the real sheet. */
function sheetFor(name, css) {
  const sheet = new Sheet();
  const built = transform(`const a = @@( ${css} );\nexport default a;\n`, `/${name}.ts`, {});
  sheet.add(`${name}.ts`, built?.blocks ?? []);
  return { css: sheet.cssFor(`${name}.ts`), classes: (built?.blocks ?? []).map((one) => one.className) };
}

/**
 * Each row: what the package writes, what the application writes, and what the page must show.
 *
 * The cases are chosen for the four ways a declaration can reach the sheet — a shorthand no table
 * can split, one that splits, one whose split was REFUSED, and `all`.
 */
const CASES = [
  ["a shorthand no table splits", "background: red;", "background-color: blue;", "backgroundColor", "rgb(0, 0, 255)"],
  ["a shorthand that splits", "padding: 8px;", "padding-left: 40px;", "paddingLeft", "40px"],
  ["a split REFUSED for a var()", "padding: var(--w);", "padding-left: 40px;", "paddingLeft", "40px"],
  ["`all` against a shorthand", "all: unset;", "background: red;", "backgroundColor", "rgb(255, 0, 0)"],
];

const wrong = [];
let tried = 0;

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage();

    for (const [what, packageCss, appCss, read, wanted] of CASES) {
      const fromPackage = sheetFor("package", packageCss);
      const fromApp = sheetFor("app", appCss);
      const merged = String(mergeClassNames(fromPackage.classes.join(" "), fromApp.classes.join(" ")));

      for (const appFirst of [true, false]) {
        const sheets = appFirst ? [fromApp.css, fromPackage.css] : [fromPackage.css, fromApp.css];
        // The break: the layer statement stripped, which is the one thing holding the order
        // together across two files. Without it the answer follows the load order, which is the
        // fault this whole scheme exists to remove.
        const written = selftest === "order" ? sheets.map((one) => one.replace(/^@layer [^;]*;\n/, "")) : sheets;

        tried++;
        const shown = await tab.evaluate(
          ([written, merged, read]) => {
            // A DOCTYPE, because quirks mode is a different CSS and no real page is in it.
            document.documentElement.innerHTML =
              `<head>${written.map((one) => `<style>${one}</style>`).join("")}</head>` +
              `<body><div id=x style="--w:1px" class="${merged}"></div></body>`;
            const found = document.getElementById("x");
            return found === null ? "" : getComputedStyle(found)[read];
          },
          [written, merged, read],
        );
        if (shown !== wanted)
          wrong.push(
            `${engine} ${what}, ${appFirst ? "app's sheet first" : "package's first"}: ${shown} not ${wanted}`,
          );
      }
    }
  } catch (error) {
    // A browser that will not launch is a check that asked LESS, silently.
    console.error(`[skew] ${engine} would not launch: ${String(error).slice(0, 120)}`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

console.log(`[skew] ${tried} arrangements across three engines`);

if (wrong.length > 0) {
  console.error(`[skew] ${wrong.length} of ${tried} gave the page the wrong declaration:`);
  for (const one of wrong.slice(0, 6)) console.error(`[skew]   ${one}`);
  process.exit(selftest ? 0 : 1);
}

if (selftest) {
  console.error(`[skew] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log(`[skew] every arrangement gives the page the same declaration, in either load order`);
