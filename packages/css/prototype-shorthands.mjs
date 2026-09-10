/**
 * What every shorthand clears, swept against a real browser — the whole table, not a sample.
 *
 *     node prototype-shorthands.mjs
 *
 * ## Why a script rather than a test
 *
 * The oracle is an engine. `merge.test.ts` asserts five families and can run in CI; this asks the
 * question of all 98 shorthands and every leaf each of them touches, which needs a browser and takes
 * a minute. Chromium is not a dependency of this package, so Playwright is resolved out of
 * `apps/playground-core`.
 *
 * ## The fault it exists for
 *
 * `SHORTHANDS` drives the layer a rule lands in, the sheet's minor order, what a merge clears, and
 * the `~` list emitted into every block. A wrong entry silently loses a style — either the longhand's
 * class lands and wins over the shorthand's, or a declaration the author wrote is deleted.
 *
 * It used to be built from `mdn-data`'s `initial` field. That field was patched by hand TWICE here
 * for this exact fault, and measured after both patches it was still missing **37** longhands that a
 * shorthand resets. The pattern is age: `animation-range-*`, `border-image-*`,
 * `text-decoration-thickness`, `background-position-x/y` — longhands added to a shorthand after its
 * `initial` was written. So the leaves come from the engines now
 * (`scripts/build-shorthand-leaves.mjs`), and this is what watches that they still do.
 *
 * ## Both directions, and only one of them is survivable
 *
 * - **a longhand the browser RESETS and the table does not clear** — the longhand wins, silently,
 *   and the page shows a style CSS would not have;
 * - **a longhand the browser KEEPS and the table clears** — a declaration the author wrote is
 *   deleted. Worse, and measured at zero both before and after.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"))(
  "@playwright/test",
);

/** The table as it SHIPS, read out of the generated text — this is not the place to re-derive it. */
const { readFileSync } = await import("node:fs");
const SHORTHANDS = JSON.parse(
  /SHORTHANDS: Readonly<Record<string, readonly string\[\]>> = (\{[\s\S]*?\n\});/
    .exec(readFileSync(join(HERE, "src", "compiler", "keywords.generated.ts"), "utf8"))?.[1]
    ?.replace(/,(\s*[}\]])/g, "$1") ?? "{}",
);

const browser = await chromium.launch();
const tab = await browser.newPage();
// A DOCTYPE: quirks mode is a different CSS and no real page is in it.
await tab.setContent("<!doctype html><html><body></body></html>");

const answer = await tab.evaluate((table) => {
  /**
   * A value the property will take, so "did it change" is a readable question.
   *
   * The list is long because a short one does not ASK. With eight values, 107 of 321 pairs had no
   * probe that fitted and went unmeasured — `animation-duration` needs a time, `mask-repeat` a
   * keyword of its own, `transition-property` a property name. A pair nobody asks about is a pair
   * this cannot claim anything about, so the list grew until the unasked count reached zero.
   */
  const probes = [
    "7px",
    "17",
    "rgb(1, 2, 3)",
    "dotted",
    'url("zz.png")',
    "zz-name",
    "0.37",
    "37%",
    "3s",
    "37ms",
    "linear",
    "reverse",
    "both",
    "paused",
    "2",
    "infinite",
    "repeat-x",
    "no-repeat",
    "border-box",
    "content-box",
    "padding-box",
    "text",
    "alpha",
    "luminance",
    "add",
    "subtract",
    "opacity",
    "all",
    "none",
    "auto",
    "left top",
    "37% 37%",
    "cover",
    "contain",
    "37px 37px",
    "fill",
    "stretch",
    "round",
    "space",
    "scroll",
    "fixed",
    "local",
    "match-source",
    "under",
    "solid",
    "wavy",
    "1 2",
    "row",
    "column",
    "nowrap",
    "wrap",
    "flex-start",
    "center",
    "37deg",
    "normal",
    "bold",
    "italic",
    "small-caps",
    "serif",
    "1.37",
    "square",
    "inside",
    "collapse",
    "separate",
    "37px 37px 37px",
    "0 0 7px red",
    "grayscale(1)",
    "crosshair",
    "ease-in-out",
    "step-start",
    "cubic-bezier(0, 0, 1, 1)",
    "block",
    "visible",
    "hidden",
    "clip",
    "start",
    "end",
    "baseline",
    "stretch",
    "2px",
  ];
  const missed = [];
  const over = [];
  const unreadable = [];
  let checked = 0;

  for (const shorthand of Object.keys(table)) {
    const own = document.createElement("div");
    own.style.setProperty(shorthand, "initial");
    const leaves = [];
    for (let index = 0; index < own.style.length; index++) leaves.push(own.style.item(index));
    if (leaves.length === 0) continue;

    const ours = new Set(table[shorthand]);
    for (const leaf of leaves) {
      if (leaf === shorthand) continue;
      const probe = probes.find((one) => {
        const test = document.createElement("div");
        test.style.setProperty(leaf, one);
        return test.style.getPropertyValue(leaf) !== "";
      });
      if (probe === undefined) {
        unreadable.push(`${shorthand} -> ${leaf}`);
        continue;
      }

      const element = document.createElement("div");
      element.style.setProperty(leaf, probe);
      const before = element.style.getPropertyValue(leaf);
      element.style.setProperty(shorthand, "initial");
      const resets = element.style.getPropertyValue(leaf) !== before;

      checked++;
      if (resets && !ours.has(leaf)) missed.push(`${shorthand} resets ${leaf}`);
      if (!resets && ours.has(leaf)) over.push(`${shorthand} keeps ${leaf}`);
    }
  }
  return { checked, missed, over, unreadable };
}, SHORTHANDS);
await browser.close();

console.log(`${Object.keys(SHORTHANDS).length} shorthands, ${answer.checked} shorthand/leaf pairs asked of Chromium`);
console.log(`\n${answer.missed.length} the browser RESETS and the table does not clear — the longhand wins:`);
for (const one of answer.missed) console.log(`   ${one}`);
console.log(`\n${answer.over.length} the browser KEEPS and the table clears — the author's line is deleted:`);
for (const one of answer.over) console.log(`   ${one}`);
if (answer.unreadable.length > 0) {
  console.log(`\n${answer.unreadable.length} pair(s) no probe value fits, so not asked:`);
  for (const one of answer.unreadable.slice(0, 10)) console.log(`   ${one}`);
}
