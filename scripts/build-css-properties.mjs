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
 *
 * ## Two files, one sweep, and that is the point
 *
 * The CSS checker needs a second table — the bare words each property accepts — and it needs to know
 * which properties the TYPES already cover, so it does not report `position: statik` a second time.
 * That is the same classification asked twice, and two scripts computing it would be a place to
 * drift: the checker would report what the types report, or go quiet where they are silent, and
 * nothing would say which.
 *
 * So one sweep writes both files, and `--check` compares both.
 */

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");
const TYPES = join(root, "packages/css/src/properties.generated.ts");
const KEYWORDS = join(root, "packages/css/src/compiler/keywords.generated.ts");
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
 * The types that stand for a name the AUTHOR invents, rather than one CSS defines.
 *
 * A property reachable through any of them accepts an identifier this cannot judge, so it is left
 * alone entirely — `animation-name: slidein` is not a typo, it is a keyframes name.
 *
 * Listed rather than pattern-matched on `-ident`: `<custom-property-name>` and `<counter-name>` do
 * not end in one, and a pattern would have to be read as a claim about every future type name.
 */
const FREE = new Set([
  "custom-ident",
  "dashed-ident",
  "ident",
  "custom-property-name",
  "counter-name",
  "keyframes-name",
  "timeline-name",
  "view-transition-name",
  "feature-value-name",
  "palette-identifier",
  "container-name",
  "anchor-name",
  "position-area",
  "string",
  "url",
  "attr-name",
]);

/**
 * Every bare keyword a property's grammar reaches, and whether it admits a free identifier.
 *
 * Two kinds of reference and both have to be followed. `<type>` goes to `syntaxes.json`; `<'name'>`
 * goes to another PROPERTY, which is how a shorthand is written. Missing the second was a real gap:
 * `white-space` is `normal | pre | … || <'text-wrap-mode'>`, so `nowrap` looked unknown and valid CSS
 * would have been reported.
 *
 * A type that resolves to nothing — `<length>`, `<color-function>` — is simply dropped, because it
 * can never be a bare identifier and the question here is only about those.
 */
function scan(name) {
  const words = new Set();
  let free = false;
  const seen = new Set();

  const walk = (syntax, depth) => {
    // A grammar deeper than this is one nothing here understands, so it is treated as free rather
    // than as closed — the safe direction is silence.
    if (depth > 12) {
      free = true;
      return;
    }

    let rest = syntax;

    rest = rest.replace(/<'([a-zA-Z0-9-]+)'>/g, (_whole, referenced) => {
      const target = properties[referenced];
      if (target === undefined) free = true;
      else if (!seen.has(`p:${referenced}`)) {
        seen.add(`p:${referenced}`);
        walk(target.syntax, depth + 1);
      }
      return " ";
    });

    rest = rest.replace(/<([a-zA-Z0-9-]+)(?:\s*\[[^\]]*\])?>/g, (_whole, referenced) => {
      if (FREE.has(referenced)) free = true;
      else if (syntaxes[referenced] !== undefined && !seen.has(`s:${referenced}`)) {
        seen.add(`s:${referenced}`);
        walk(syntaxes[referenced].syntax, depth + 1);
      }
      return " ";
    });

    // A bare word, and never a function name — `rgb(` is a function, `red` is a keyword.
    for (const match of rest.matchAll(/(?<![\w-])([a-z][a-z0-9-]*)(?![\w-]*\()/g)) words.add(match[1]);
  };

  walk(properties[name].syntax, 0);
  return { words: [...words].sort(), free };
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

const rows = [];
const keywordRows = [];
let unions = 0;
let checkable = 0;

for (const name of named) {
  const keywords = keywordsOf(properties[name].syntax);
  const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  const type = keywords === undefined ? "CssValue" : `Keyword<${keywords.map((k) => JSON.stringify(k)).join(" | ")}>`;
  rows.push(`  ${key}: ${type};`);

  if (keywords !== undefined) {
    // The types already report a bad value here, with a suggestion. The checker must not say it
    // twice — measured, `position: statik` came back from both.
    unions++;
    continue;
  }

  const scanned = scan(name);
  if (scanned.free || scanned.words.length === 0) continue;
  checkable++;
  keywordRows.push(`  ${JSON.stringify(name)}: ${JSON.stringify(scanned.words.join(" "))},`);
}

const types = `// Generated by scripts/build-css-properties.mjs from mdn-data (CC0-1.0). Do not edit.
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

const keywords = `// Generated by scripts/build-css-properties.mjs from mdn-data (CC0-1.0). Do not edit.
//
// ${checkable} properties whose values the CSS checker can judge: their grammar admits no arbitrary
// identifier, and the TYPES do not already cover them with a union. The other ${named.length - checkable} are
// absent on purpose — ${unions} are the types' to report, and the rest accept a name the author
// invents, like a keyframes name or a font family.

/**
 * Every property CSS defines, for the near-miss search.
 *
 * A runtime list, because a type has none — and one list out of one sweep is what stops the checker
 * and the type map disagreeing about what exists.
 *
 * **Not the keys of \`KEYWORDS\`, and the difference is the point.** That map holds only the ${checkable}
 * properties whose VALUES this can judge; this list is all ${named.length} names, because the near-miss
 * search is about the NAME. \`flex-direction\` is absent from the map — its values are the types' to
 * report — and it has to be here, or \`flex-dirction\` could never be suggested, which is the rule's
 * headline case.
 */
export const PROPERTIES: readonly string[] = ${JSON.stringify(named)};

/** Property -> the bare keywords its grammar reaches, space separated. */
export const KEYWORDS: Readonly<Record<string, string>> = {
${keywordRows.join("\n")}
};
`;

const said = `${named.length} properties, ${unions} typed as a union, ${checkable} value-checkable by the rules`;

if (!check) {
  writeFileSync(TYPES, types);
  writeFileSync(KEYWORDS, keywords);
  console.log(`[css-properties] wrote ${said}`);
  process.exit(0);
}

if (readFileSync(TYPES, "utf8") === types && readFileSync(KEYWORDS, "utf8") === keywords) {
  console.log(`[css-properties] up to date — ${said}`);
  process.exit(0);
}

console.error(
  `\n[css-properties] the generated files are out of date.\n\n` +
    `  They are written from mdn-data, so this means the data moved or the sweep that reads it did.\n` +
    `  Run \`node scripts/build-css-properties.mjs\` and read the diff: a property that GAINED a\n` +
    `  union is one whose grammar closed, and one that gained keywords is one the checker can now\n` +
    `  judge. Both files come from one sweep, so they cannot disagree.\n`,
);
process.exit(1);
