/**
 * The same styles, written by hand and written as blocks, must give the SAME PIXELS.
 *
 *     node scripts/check-render-equality.mjs
 *     SELFTEST=change node scripts/check-render-equality.mjs   # one block off by a pixel; must fail
 *     SELFTEST=joined node scripts/check-render-equality.mjs   # classes joined, not merged; must fail
 *
 * ## Why pixels
 *
 * Every other comparison here reads `getComputedStyle`, and computed is not USED: a declaration can
 * compute exactly right and do nothing, or move something a computed value never mentions. What a
 * person sees is the picture, so the picture is the oracle — for a split, a layer, a merge, all of
 * it at once.
 *
 * ## Why no stored image
 *
 * The hand-written page IS the oracle, rendered in the same browser, on the same machine, in the
 * same run as the block page. Nothing is compared across platforms, fonts or antialiasing, so there
 * is nothing to tolerate: a pixel that differs is a real difference.
 *
 * ## What the block page is
 *
 * Each block is its own module with its own stylesheet, as in an application — so the sheets are
 * loaded in BOTH orders, and neither may change the picture. An element's blocks are merged in the
 * order its classes are written, which is the order the hand-written rules are in. The whole page is
 * photographed, not the element, because a fault can move an element rather than recolour it.
 *
 * A failure writes the two pictures and a third marking every differing pixel into
 * `apps/playground-core/test-results/render-equality/`, which CI keeps as an artefact.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./lib-load-ts.mjs";
import { PAIRS } from "./render-pairs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const selftest = process.env.SELFTEST;
const pw = createRequire(join(HERE, "..", "apps", "playground-core", "package.json"))("@playwright/test");
const CSS = join(HERE, "..", "packages", "css", "src");
const { transform } = await loadTs(join(CSS, "compiler", "transform.ts"));
const { Sheet } = await loadTs(join(CSS, "compiler", "sheet.ts"));
const runtime = await loadTs(join(CSS, "merge.ts"));
// A selftest's pictures go elsewhere, so a real failure after it in CI is not mixed up with them.
const OUT = join(
  HERE,
  "..",
  "apps",
  "playground-core",
  "test-results",
  selftest ? "render-equality-selftest" : "render-equality",
);

const pairs = structuredClone(PAIRS);
if (selftest === "change") pairs[0].blocks.b = "padding-left: 39px;";

/** What the runtime binds each helper the emitted module imports to. */
const HELPERS = {
  mergeClassNames: runtime.mergeClassNames,
  shorthands: runtime.shorthands,
  conditionsOf: runtime.conditionsOf,
  namesOf: runtime.namesOf,
  pick: runtime.pick,
};

/**
 * One block as its own module: the classes it hands back, and the stylesheet it imports.
 *
 * `shared` is written above the block in every module — a `@@keyframes` it names, say. A spread of
 * another block of the pair, `...{base}`, is that block IMPORTED from its own module, the way an
 * application spreads a base from another file: its classes are handed in as the import would.
 */
function compile(name, source, shared, compiled) {
  const file = `${name}.tsx`;
  const imports = Object.keys(compiled).filter((other) => source.includes(`...{${other}}`));
  const header = imports.map((other) => `import { ${other} } from "./${other}";\n`).join("");
  const built = transform(`${header}${shared}export const ${name} = @@( ${source} );\n`, { filename: file });
  if (built === undefined) throw new Error(`${name}: nothing compiled`);
  const imported = /^import \{([^}]*)\} from "@ramonda\/css";$/m.exec(built.code)?.[1] ?? "";
  const bound = imported
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => one.split(/\s+as\s+/));
  const body = built.code
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")
    .replace(/^export /gm, "");
  const classes = new Function(...bound.map(([, local]) => local), ...imports, `${body}\nreturn ${name};`)(
    ...bound.map(([exported]) => HELPERS[exported]),
    ...imports.map((other) => compiled[other].classes),
  );
  const sheet = new Sheet();
  sheet.add(file, built.blocks);
  return { classes: String(classes), css: sheet.cssFor(file) };
}

const page = (styles, body) =>
  `<!doctype html><html><head>${styles.map((one) => `<style>${one}</style>`).join("")}</head>` +
  `<body style="margin: 8px">${body}</body></html>`;

const wrong = [];
let shots = 0;

for (const engine of ["chromium", "firefox", "webkit"]) {
  let browser;
  try {
    browser = await pw[engine].launch();
    const tab = await browser.newPage({ viewport: { width: 320, height: 200 } });

    const shoot = async (html, hover) => {
      await tab.setContent(html);
      if (hover !== undefined) await tab.hover(hover);
      else await tab.mouse.move(310, 190);
      return tab.screenshot({ fullPage: true, animations: "disabled" });
    };

    for (const pair of pairs) {
      // In the order written, so a block spreading another comes after it, as an import would.
      const compiled = {};
      for (const [name, source] of Object.entries(pair.blocks))
        compiled[name] = compile(name, source, pair.shared ?? "", compiled);
      const markup = pair.markup.replace(/class="([^"]*)"/g, (_all, names) => {
        const each = names.split(/\s+/).map((one) => compiled[one].classes);
        // Without the merge, a shorthand written after its longhand no longer clears it.
        const merged = selftest === "joined" ? each.join(" ") : runtime.mergeClassNames(...each);
        return `class="${merged}"`;
      });
      const sheets = Object.values(compiled).map((one) => one.css);

      const hand = await shoot(page([pair.hand], pair.markup), pair.hover);
      for (const [order, styles] of [
        ["in order", sheets],
        ["reversed", [...sheets].reverse()],
      ]) {
        shots++;
        const blocks = await shoot(page(styles, markup), pair.hover);
        if (hand.equals(blocks)) continue;

        const diff = await tab.evaluate(
          async ([a, b]) => {
            const load = (src) =>
              new Promise((done) => {
                const image = new Image();
                image.onload = () => done(image);
                image.src = src;
              });
            const [one, two] = await Promise.all([load(a), load(b)]);
            const width = Math.max(one.width, two.width);
            const height = Math.max(one.height, two.height);
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            context.drawImage(one, 0, 0);
            const first = context.getImageData(0, 0, width, height);
            context.clearRect(0, 0, width, height);
            context.drawImage(two, 0, 0);
            const second = context.getImageData(0, 0, width, height);
            let count = 0;
            for (let at = 0; at < first.data.length; at += 4) {
              const same =
                first.data[at] === second.data[at] &&
                first.data[at + 1] === second.data[at + 1] &&
                first.data[at + 2] === second.data[at + 2] &&
                first.data[at + 3] === second.data[at + 3];
              if (!same) count++;
              second.data[at] = same ? first.data[at] / 3 + 170 : 255;
              second.data[at + 1] = same ? first.data[at + 1] / 3 + 170 : 0;
              second.data[at + 2] = same ? first.data[at + 2] / 3 + 170 : 0;
              second.data[at + 3] = 255;
            }
            context.putImageData(second, 0, 0);
            return { count, png: canvas.toDataURL("image/png") };
          },
          [`data:image/png;base64,${hand.toString("base64")}`, `data:image/png;base64,${blocks.toString("base64")}`],
        );
        // A PNG can differ in its bytes while every pixel agrees; only pixels are a difference.
        if (diff.count === 0) continue;

        const slug = `${engine}-${pair.name.replace(/[^a-z0-9]+/gi, "-")}-${order.replace(" ", "-")}`;
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `${slug}-hand.png`), hand);
        writeFileSync(join(OUT, `${slug}-blocks.png`), blocks);
        writeFileSync(join(OUT, `${slug}-diff.png`), Buffer.from(diff.png.split(",")[1], "base64"));
        wrong.push(`${engine} ${pair.name}, sheets ${order}: ${diff.count} pixel(s) differ — see ${slug}-diff.png`);
      }
    }
  } catch (error) {
    console.error(`[render] ${engine} would not launch, or the code failed: ${String(error).slice(0, 200)}`);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

if (wrong.length > 0) {
  console.error(`[render] ${wrong.length} of ${shots} block pages are not the hand-written page:`);
  for (const one of wrong) console.error(`[render]   ${one}`);
  console.error(`[render] the pictures are in ${OUT}`);
  process.exit(selftest ? 0 : 1);
}
if (selftest) {
  console.error(`[render] SELFTEST=${selftest} changed nothing — this check would not catch it.`);
  process.exit(1);
}
console.log(
  `[render] ${pairs.length} pairs, ${shots} pictures across three engines — every block page is the hand-written one`,
);
