/**
 * Composition against the browser's own cascade — `...{base}` plus a condition.
 *
 *     node prototype-composition.mjs
 *
 * ## The question, and why it needed a browser
 *
 * `...{base}` is the one hole the compiler cannot see: a spread is a runtime value, so nothing at
 * build time knows what is in it. `merge.ts` warns when a composition cannot take effect, and a
 * review measured that warning — but never the RESULT. So this asks the only question that matters
 * to somebody reading a page: **does a composed element compute what the same declarations, written
 * out by hand in the author's own order, compute?**
 *
 * The oracle is not this package's own sheet, and that is the whole point: every other probe here
 * compares two halves of this package with each other, which cannot find a fault both halves share.
 *
 * ## How to read the result
 *
 * A case that DIFFERS and WARNS is the documented answer — the warning says in words that the
 * composition will not take effect, and names both conditions. A case that differs and says
 * **nothing** is the fault this exists to catch.
 *
 * Measured 2026-09-11: 21 compositions, 16 agreeing, 5 differing and all 5 warning, 0 silent.
 *
 * ## What is deliberately not here
 *
 * A spread inside a `@media` or a selector is REFUSED by the language, with a message naming where
 * to write it instead, so there is nothing to measure. And the warning is development-only, which
 * `viteBuild.test.ts` holds: in production those five differ silently, which is the trade the
 * warning's own note explains.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Sheet, transform } from "./dist/compiler/index.js";
import { merge } from "./dist/index.js";
import { builtFromThisSource } from "./built.mjs";

// This probe reads `dist`, and its numbers get written down as facts — see `built.mjs`.
builtFromThisSource();

const HERE = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(HERE, "..", "..", "apps", "playground-core", "package.json"))(
  "@playwright/test",
);

const CASES = [
  [
    "plain over plain",
    "color: rgb(1, 0, 0);",
    "color: rgb(2, 0, 0);",
    "color: rgb(1, 0, 0); color: rgb(2, 0, 0);",
    ["color"],
  ],
  [
    "a media query over a plain base",
    "color: rgb(1, 0, 0);",
    "@media (min-width: 1px) { color: rgb(2, 0, 0); }",
    "color: rgb(1, 0, 0); @media (min-width: 1px) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "a plain modifier over a media base",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); }",
    "color: rgb(2, 0, 0);",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } color: rgb(2, 0, 0);",
    ["color"],
  ],
  [
    "a wider breakpoint over a narrower",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); }",
    "@media (min-width: 40rem) { color: rgb(2, 0, 0); }",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } @media (min-width: 40rem) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "a narrower breakpoint over a wider",
    "@media (min-width: 40rem) { color: rgb(1, 0, 0); }",
    "@media (min-width: 1px) { color: rgb(2, 0, 0); }",
    "@media (min-width: 40rem) { color: rgb(1, 0, 0); } @media (min-width: 1px) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "supports over a media base",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); }",
    "@supports (display: grid) { color: rgb(2, 0, 0); }",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } @supports (display: grid) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "a media query over a supports base",
    "@supports (display: grid) { color: rgb(1, 0, 0); }",
    "@media (min-width: 1px) { color: rgb(2, 0, 0); }",
    "@supports (display: grid) { color: rgb(1, 0, 0); } @media (min-width: 1px) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "a hover over a plain base",
    "color: rgb(1, 0, 0);",
    "&:hover { color: rgb(2, 0, 0); }",
    "color: rgb(1, 0, 0);",
    ["color"],
  ],
  [
    "a plain modifier over a hover base",
    "&:hover { color: rgb(1, 0, 0); }",
    "color: rgb(2, 0, 0);",
    "&:hover { color: rgb(1, 0, 0); } color: rgb(2, 0, 0);",
    ["color"],
  ],
  [
    "a shorthand over a longhand under a media",
    "@media (min-width: 1px) { padding-left: 1px; }",
    "padding: 9px;",
    "@media (min-width: 1px) { padding-left: 1px; } padding: 9px;",
    ["padding-left", "padding-top"],
  ],
  [
    "a longhand over a shorthand under a media",
    "@media (min-width: 1px) { padding: 9px; }",
    "padding-left: 1px;",
    "@media (min-width: 1px) { padding: 9px; } padding-left: 1px;",
    ["padding-left", "padding-top"],
  ],
  [
    "a media query that does NOT hold",
    "color: rgb(1, 0, 0);",
    "@media (min-width: 9999px) { color: rgb(2, 0, 0); }",
    "color: rgb(1, 0, 0); @media (min-width: 9999px) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "print over a plain base",
    "color: rgb(1, 0, 0);",
    "@media print { color: rgb(2, 0, 0); }",
    "color: rgb(1, 0, 0); @media print { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "a media over a nested rule under a media",
    "@media (min-width: 1px) { &:hover { color: rgb(1, 0, 0); } }",
    "@media (min-width: 1px) { color: rgb(2, 0, 0); }",
    "@media (min-width: 1px) { &:hover { color: rgb(1, 0, 0); } color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "important over a media base",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); }",
    "color: rgb(2, 0, 0) !important;",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } color: rgb(2, 0, 0) !important;",
    ["color"],
  ],
  [
    "a media base over an important modifier",
    "@media (min-width: 1px) { color: rgb(1, 0, 0) !important; }",
    "color: rgb(2, 0, 0);",
    "@media (min-width: 1px) { color: rgb(1, 0, 0) !important; } color: rgb(2, 0, 0);",
    ["color"],
  ],
];

/** Whole sources, for shapes a base-plus-modifier pair cannot express. */
const WHOLE = [
  [
    "three deep, each under a wider breakpoint",
    "const one = @@(\n  @media (min-width: 1px) { color: rgb(1, 0, 0); }\n);\n" +
      "const two = @@(\n  ...{one};\n  @media (min-width: 20rem) { color: rgb(2, 0, 0); }\n);\n" +
      "const a = @@(\n  ...{two};\n  @media (min-width: 40rem) { color: rgb(3, 0, 0); }\n);\n",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } @media (min-width: 20rem) { color: rgb(2, 0, 0); } @media (min-width: 40rem) { color: rgb(3, 0, 0); }",
    ["color"],
  ],
  [
    "a guard that holds, under a media query",
    "const on = true;\nconst base = @@(\n  color: rgb(1, 0, 0);\n);\n" +
      "const a = @@(\n  ...{base};\n  if ({on}) { @media (min-width: 1px) { color: rgb(2, 0, 0); } }\n);\n",
    "color: rgb(1, 0, 0); @media (min-width: 1px) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
  [
    "a guard that does NOT hold",
    "const on = false;\nconst base = @@(\n  color: rgb(1, 0, 0);\n);\n" +
      "const a = @@(\n  ...{base};\n  if ({on}) { @media (min-width: 1px) { color: rgb(2, 0, 0); } }\n);\n",
    "color: rgb(1, 0, 0);",
    ["color"],
  ],
  [
    "the same base spread twice",
    "const base = @@(\n  @media (min-width: 1px) { color: rgb(1, 0, 0); }\n);\n" +
      "const a = @@(\n  ...{base};\n  color: rgb(9, 9, 9);\n  ...{base};\n);\n",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } color: rgb(9, 9, 9); @media (min-width: 1px) { color: rgb(1, 0, 0); }",
    ["color"],
  ],
  [
    "a base holding a HOLE, under a media query",
    'const tint = "rgb(1, 0, 0)";\nconst base = @@(\n  @media (min-width: 1px) { color: {tint}; }\n);\n' +
      "const a = @@(\n  ...{base};\n  @media (min-width: 40rem) { color: rgb(2, 0, 0); }\n);\n",
    "@media (min-width: 1px) { color: rgb(1, 0, 0); } @media (min-width: 40rem) { color: rgb(2, 0, 0); }",
    ["color"],
  ],
];

/** One composition, built through the real transform, merge and sheet — and what it warned. */
function composed(source) {
  const built = transform(source, { filename: "/a.tsx" });
  if (built === undefined) throw new Error("refused: " + source.slice(0, 40));
  const code = built.code
    .split("\n")
    .filter((line) => !line.startsWith("import ") && !line.startsWith("export "))
    .join("\n");

  /**
   * The warning is said ONCE PER MESSAGE for the life of the process, and `forget` is a test-only
   * export this probe cannot reach through `dist`. It does not need to: every message names the
   * property AND both conditions, so no two cases here share one — asserted below rather than
   * assumed, because a silently deduped warning would read exactly like a case that did not warn.
   */
  const said = [];
  const spoke = console.warn;
  console.warn = (...args) => void said.push(args.map(String).join(" "));
  const value = new Function("_merge", code + "\nreturn a;")(merge);
  console.warn = spoke;

  const sheet = new Sheet();
  sheet.add("/a.tsx", built.blocks);
  return {
    className: value.className,
    css: sheet.cssFor("/a.tsx"),
    warned: said.length > 0,
    messages: said,
    // A hole reaches an element through `setProperty`, never a style string — see `cssBlock.ts`.
    inline: (value.properties ?? []).map((one, at) => [one, String((value.values ?? [])[at])]),
  };
}

const cases = [];
for (const [what, base, modifier, plain, read] of CASES) {
  cases.push({
    what,
    read,
    plain,
    ...composed("const base = @@(\n  " + base + "\n);\nconst a = @@(\n  ...{base};\n  " + modifier + "\n);\n"),
  });
}
for (const [what, source, plain, read] of WHOLE) cases.push({ what, read, plain, ...composed(source) });

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// A DOCTYPE. Quirks mode is a different CSS, and it caught this session three times in one day.
await tab.setContent("<!doctype html><html><head></head><body></body></html>");

const answer = await tab.evaluate((given) => {
  const read = (css, className, properties, inline) => {
    document.head.innerHTML = "<style>" + css + "</style>";
    document.body.innerHTML = "";
    const probe = document.createElement("div");
    probe.id = "probe";
    if (className) probe.className = className;
    for (const [name, value] of inline ?? []) probe.style.setProperty(name, value);
    document.body.append(probe);
    const computed = getComputedStyle(probe);
    return properties.map((one) => computed.getPropertyValue(one));
  };
  return given.map((one) => ({
    what: one.what,
    warned: one.warned,
    read: one.read,
    ours: read(one.css, one.className, one.read, one.inline),
    // `&` is the element itself, which is what a nested rule means inside a block.
    plain: read("#probe { " + one.plain.replace(/&/g, "#probe") + " }", "", one.read),
  }));
}, cases);
await browser.close();

/**
 * No case may be silent because ANOTHER case already said the same sentence — see `composed`. A
 * repeat would read exactly like a composition that needs no warning, which is the one thing this
 * probe must not confuse.
 */
const sentences = cases.flatMap((one) => one.messages);
const repeated = sentences.filter((one, at) => sentences.indexOf(one) !== at);
if (repeated.length > 0) {
  console.error("a warning was deduped away, so `warned` below is not trustworthy:\n  " + repeated.join("\n  "));
  process.exit(1);
}

const differ = answer.filter((one) => one.ours.join("|") !== one.plain.join("|"));
const silent = differ.filter((one) => !one.warned);

console.log(answer.length + " compositions against the same CSS by hand");
console.log("   " + (answer.length - differ.length) + " agree");
console.log("   " + (differ.length - silent.length) + " differ AND warn — the documented answer");
console.log("   " + silent.length + " differ with NOTHING said");

if (differ.length > 0) {
  console.log("\nevery difference:");
  for (const one of differ) {
    console.log((one.warned ? "   warned  " : "!! SILENT  ") + one.what);
    one.ours.forEach((value, at) => {
      if (value !== one.plain[at]) {
        console.log("        " + one.read[at].padEnd(16) + value + "   by hand " + one.plain[at]);
      }
    });
  }
}
