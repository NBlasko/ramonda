import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Writes `@ramonda/css`'s property map from MDN's own CSS data.
 *
 *   node scripts/build-css-properties.mjs          # write it
 *   node scripts/build-css-properties.mjs --check  # fail if it is out of date (for CI)
 *
 * ## Why generated, and why from this
 *
 * The map is what makes a CSS property name checkable: every block becomes an object literal typed
 * `Partial<CssProperties>`, and an object literal is what gets excess-property checking. So a name
 * MISSING from the map is a false error on somebody's valid CSS — which is the one failure this
 * cannot have, and the reason the list is taken from data rather than written by hand.
 *
 * `mdn-data` is **CC0-1.0**: public domain, no attribution required and no condition attached.
 *
 * ## The split, and it is measured rather than chosen
 *
 * A property gets a real union only when its grammar, fully expanded, is a `|`-separated list of
 * bare keywords. Everything else is `string | number`, and its typos belong to the CSS checker,
 * where the message is one we write. The reason is in DESIGN.md and it is readability: a template
 * literal type does catch `padding: 10pxx`, and says so in a union that grows combinatorially with
 * every shorthand position.
 *
 * Measured, on 551 non-prefixed properties: **123 are a closed keyword set** and 428 are not.
 * `display` is NOT one of them, and DESIGN.md used to say it was — its grammar allows
 * `inline flow-root`, so a union of its single keywords would reject valid CSS. That is the line
 * this holds: **a union only where the grammar is genuinely closed.**
 *
 * ## The three things a union has to allow, or it reports valid CSS
 *
 * Each was a false error before it was added, and each was measured:
 *
 * | written | without | with |
 * |---|---|---|
 * | `position: inherit` | `TS2322` | fine — every property takes the CSS-wide keywords |
 * | `position: var(--p)` | `TS2322` | fine — and `var(--p, absolute)` too |
 * | `position: absolute !important` | `TS2322` | fine |
 *
 * They are folded into one named alias, `Keyword<…>`, and the name is worth more than the tidiness:
 * TypeScript prints the ALIAS in a diagnostic instead of expanding the union, so the message stays
 * one line and the *did you mean* survives.
 */

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");
const OUT = join(root, "packages/css/src/properties.generated.ts");
const check = process.argv.includes("--check");

const properties = require("mdn-data/css/properties.json");
const syntaxes = require("mdn-data/css/syntaxes.json");

/**
 * A property's grammar with every `<reference>` replaced by what it stands for.
 *
 * A terminal type — `<color>`, `<length>`, `<string>` — has no entry in `syntaxes.json` and is left
 * as it is, which is exactly what marks the property as not enumerable. The depth bound stops a
 * grammar that refers to itself, and `<'property'>` references are left alone for the same reason:
 * a property whose grammar is another property's is a shorthand, and no shorthand is a keyword set.
 */
function expand(syntax, depth = 0) {
  if (depth > 8) return syntax;
  return syntax.replace(/<([a-zA-Z0-9-]+)>/g, (whole, name) =>
    syntaxes[name] === undefined ? whole : `[ ${expand(syntaxes[name].syntax, depth + 1)} ]`,
  );
}

const KEYWORD = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * The keywords a property accepts, or `undefined` when it accepts anything else as well.
 *
 * Strict on purpose. `&&`, `||` and juxtaposition all mean the property takes COMBINATIONS of its
 * keywords — `overflow: hidden auto`, `display: inline flow-root` — and a union of the singles would
 * reject those. A multiplier, a function, a comma or a terminal type means the same. Any of them and
 * the property is `string | number`.
 */
function keywordsOf(syntax) {
  const expanded = expand(syntax);
  if (/<|\(|\{|\+|\*|\?|,|#|!|&&|\|\|/.test(expanded)) return undefined;

  const parts = expanded
    .replace(/[[\]]/g, " ")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 && parts.every((part) => KEYWORD.test(part)) ? [...new Set(parts)] : undefined;
}

/**
 * Vendor-prefixed names are left out and caught by an index signature instead.
 *
 * A hundred of them, each one a name nobody misspells into a different property — and an index
 * signature on `` `-${string}` `` accepts every one, including the prefixes MDN does not list. It
 * costs nothing that matters: a key not starting with `-` still has to be a real property, so
 * `dsiplay` is still an excess property with a suggestion beside it.
 */
const named = Object.keys(properties)
  .filter((name) => !name.startsWith("-"))
  .sort();

const rows = named.map((name) => {
  const keywords = keywordsOf(properties[name].syntax);
  const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  const type = keywords === undefined ? "CssValue" : `Keyword<${keywords.map((k) => JSON.stringify(k)).join(" | ")}>`;
  return `  ${key}: ${type};`;
});

const unions = rows.filter((row) => row.includes("Keyword<")).length;

const file = `// Generated by scripts/build-css-properties.mjs from mdn-data (CC0-1.0). Do not edit.
//
// ${named.length} properties, ${unions} of them a closed keyword set. Everything else is \`string | number\`
// and its typos belong to the CSS checker — see the script for the measurement behind that split.

/** Every property accepts these, whatever else it accepts. */
export type CssGlobal = "inherit" | "initial" | "unset" | "revert" | "revert-layer";

/** A property that takes anything a grammar would have to read. */
export type CssValue = string | number;

/**
 * A closed set of keywords, plus the three things every property also accepts.
 *
 * Named rather than written out at each property, and the name is what keeps a diagnostic readable:
 * TypeScript prints \`Keyword<"static" | …>\` instead of expanding the whole union, and the
 * *did you mean* survives.
 */
export type Keyword<K extends string> = K | CssGlobal | \`var(\${string})\` | \`\${K | CssGlobal} !important\`;

export interface CssProperties {
${rows.join("\n")}
}
`;

if (!check) {
  writeFileSync(OUT, file);
  console.log(`[css-properties] wrote ${named.length} properties, ${unions} of them a closed keyword set`);
  process.exit(0);
}

const onDisk = readFileSync(OUT, "utf8");
if (onDisk === file) {
  console.log(`[css-properties] up to date — ${named.length} properties, ${unions} of them a closed keyword set`);
  process.exit(0);
}

console.error(
  `\n[css-properties] packages/css/src/properties.generated.ts is out of date.\n\n` +
    `  It is written from mdn-data, so this means the data moved or the rule that reads it did.\n` +
    `  Run \`node scripts/build-css-properties.mjs\` and read the diff: a property that GAINED a\n` +
    `  union is a property whose grammar closed, and one that lost it is one that opened.\n`,
);
process.exit(1);
