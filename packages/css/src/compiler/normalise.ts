import type { Block, BlockItem, ValuePart } from "./ast";
import { AT_RULE_LINKS, MEDIA_FEATURES, PROPERTIES, SELECTORS } from "./keywords.generated";

/**
 * The canonical text of a block, which is the definition of its identity.
 *
 * Two blocks that normalise to the same string get the same class and therefore ONE rule, wherever
 * and by whomever they were written. That makes this the most dangerous function in the package, and
 * it is written around one asymmetry:
 *
 * - **a missed merge** costs one duplicate rule in a stylesheet — a few dozen bytes;
 * - **a wrong merge** changes a page nobody edited, in a way no test of either block alone can find.
 *
 * So it throws away only what provably cannot change meaning, and where there is any doubt it keeps
 * the difference. Number forms (`.5px` and `0.5px`), colour forms (`#FFF` and `#ffffff`) and keyword
 * case are all safe to fold in principle and are deliberately NOT folded: each needs a value parser
 * to do safely, and each buys a rule that was going to be duplicated anyway.
 *
 * It must also produce the same bytes in the server build and the client build, which is why it is
 * one exported function rather than a rule written down twice.
 */

/**
 * The delimiter around a hole's index in the canonical text.
 *
 * U+0000 has no meaning in CSS, and `readBlock` REFUSES a block that holds one — so a placeholder
 * made of it cannot be forged by the source it is protecting.
 *
 * **The refusal is what guarantees that, and it was not always there.** This note used to argue
 * from CSS preprocessing turning a NUL into U+FFFD, which does not apply: a block is read out of a
 * TypeScript file and nothing preprocesses it as CSS. A review measured a block carrying two of them
 * sharing an identity, and a class, with a block carrying a real hole.
 *
 * A placeholder is needed at all because the names are circular: the variable name is derived from
 * the class, the class from the hash, and the hash from this text. Something has to stand in for the
 * name while the name is being decided, and `substitute` puts the real one back afterwards.
 */
export const HOLE = "\u0000";

export function normalise(block: Block): string {
  return items(block.items);
}

function items(list: readonly BlockItem[]): string {
  let out = "";
  for (const item of list) {
    out += item.kind === "declaration" ? `${propertyName(item.property)}:${value(item.value)};` : rule(item);
  }
  return out;
}

function rule(item: Extract<BlockItem, { kind: "rule" }>): string {
  return `${collapse(item.prelude)}{${items(item.items)}}`;
}

/**
 * `COLOR` and `color` are the same property; `--Accent` and `--accent` are two.
 *
 * Only A–Z is folded, so the result never depends on the machine's locale — `toLowerCase` maps `I`
 * differently under a Turkish locale, and a class name that differs by locale would break the one
 * thing the name has to do.
 */
function propertyName(property: string): string {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The value, with its holes standing in as placeholders.
 *
 * The parts are joined BEFORE the whitespace is collapsed, and that ordering is the whole
 * correctness of it: collapsing each part on its own would trim the space in `4px solid {{colour}}`
 * off the end of the text part, and merge it with `4px solid{{colour}}` — two different values, one
 * class, and the second one broken.
 */
function value(parts: readonly ValuePart[]): string {
  let raw = "";
  for (const part of parts) raw += part.kind === "text" ? part.text : `${HOLE}${part.index}${HOLE}`;
  return collapse(raw);
}

/**
 * Runs of whitespace to one space, and none at the ends — except inside a string, where every
 * character an author wrote is what they meant (`content: "a  b"`).
 *
 * Exported for the virtual file, which writes one declaration's value into a string literal and has
 * to fold it the same way — not re-implement it. It is deliberately not on the package's surface.
 */
export function collapse(text: string): string {
  let out = "";
  let pending = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      pending = true;
      continue;
    }

    if (pending) {
      // Never a leading space: a run before anything has been written is trimmed rather than kept.
      if (out.length > 0) out += " ";
      pending = false;
    }

    if (c === '"' || c === "'") {
      i = string(text, i, (chunk) => {
        out += chunk;
      });
      continue;
    }

    out += c;
  }

  // A run at the end is simply never flushed, which is the trim.
  return out;
}

/**
 * Copies one string literal out verbatim and returns the index of its closing quote.
 *
 * An unterminated string runs to the end of the text rather than throwing. This is a normaliser, not
 * a validator: the parser has already refused a block it could not read, and a second opinion here
 * would only be a second place for the two to disagree.
 */
function string(text: string, start: number, write: (chunk: string) => void): number {
  const quote = text[start];
  let i = start + 1;

  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) break;
    i++;
  }

  const end = Math.min(i, text.length - 1);
  write(text.slice(start, end + 1));
  return end;
}

/**
 * ONE SPELLING for a condition, and one for a selector.
 *
 * ## The fault these exist for
 *
 * A declaration's `key` — what decides whether one declaration OVERRIDES another — is derived from
 * its own text. A review measured what that costs when two files spell one condition differently: a
 * base written `@media (min-width:40rem)` and a modifier written `@media (min-width: 40rem)` are the
 * same CSS and became two keys, so the merge kept BOTH classes and which one won was decided by
 * whichever file the bundler transformed first.
 *
 * ## Why the source is canonicalised rather than the key
 *
 * CSS is case-insensitive about the words of the LANGUAGE — an at-rule's name, a media feature's
 * name, a pseudo-class's name — and case-sensitive about an author's own identifiers. Measured with
 * lightningcss: `:hover` and `:HOVER` are one rule, `.a` and `.A` are two. So a key cannot simply be
 * lower-cased; folding a class name would introduce, deliberately, the exact collision the review
 * was looking for.
 *
 * Making the SOURCE canonical moves the invariant from "the compiler normalises every spelling" to
 * "there is only one spelling", which is far cheaper to be right about and leaves an author's own
 * identifiers alone. The checker reports a text these would change and the formatter writes what
 * they return, so **the rule reports exactly what the canonicaliser can fix** — an error with no fix
 * is worse than a spelling, and one function asked two ways cannot drift from itself.
 *
 * ## What they deliberately leave alone
 *
 * `:nth-child(2n + 1)` and `@supports ((display: grid))` are each the same CSS as their tighter
 * spelling and each needs real parsing to rewrite: `:nth-child(2n of .a)` has whitespace that
 * matters, and telling a redundant paren from a grouping one is the `@supports` grammar. Left as
 * written, which costs a second class and reports nothing.
 */
export function canonicalSelector(selector: string): string {
  return selector.replace(A_PSEUDO, (whole, colons: string, name: string) => {
    const lowered = name.toLowerCase();
    // A name nobody generated is a browser's or a typo's, and neither is this function's to rewrite.
    if (!PSEUDO_CLASSES.has(`:${lowered}`) && !PSEUDO_ELEMENTS.has(`::${lowered}`)) return whole;
    // A pseudo-ELEMENT written with one colon is CSS's own legacy spelling for four of them.
    const written = colons === ":" && PSEUDO_ELEMENTS.has(`::${lowered}`) ? "::" : colons;
    return `${written}${lowered}`;
  });
}

export function canonicalCondition(condition: string): string {
  const space = condition.indexOf(" ");
  const name = space === -1 ? condition : condition.slice(0, space);
  if (!AT_RULES.has(name.toLowerCase())) return condition;

  const rest = space === -1 ? "" : condition.slice(space + 1);
  /**
   * A `@layer`'s name and a `@scope`'s selector are the AUTHOR'S, so only the at-rule's own name is
   * lowered for those. Everything else here takes a condition, whose feature names are the
   * language's.
   */
  const lowered = `@${name.slice(1).toLowerCase()}`;
  if (!CONDITIONAL.has(lowered)) return rest === "" ? lowered : `${lowered} ${rest}`;

  return `${lowered} ${canonicalFeatures(rest)}`;
}

/**
 * A condition's feature names lowered and its colons spaced, and nothing else touched.
 *
 * One space after the colon, which is the convention a declaration already uses and the one the user
 * chose. The value after it is left exactly as written — it may be an author's own custom property,
 * and it is not this function's to fold.
 */
function canonicalFeatures(rest: string): string {
  const spaced = rest.replace(A_FEATURE, (whole, open: string, name: string, gap: string) => {
    const lowered = name.toLowerCase();
    /**
     * A name the language owns: a media feature, or — inside `@supports` — a property, because what
     * that at-rule holds between parens is a DECLARATION rather than a query.
     *
     * The colon is spaced only for a KNOWN name, and that is not caution for its own sake: a value
     * may hold a colon of its own, and `@supports (background: url(http://x))` spaced blindly comes
     * back as `url(http: //x)`.
     */
    if (!MEDIA_FEATURE_NAMES.has(lowered) && !PROPERTY_NAMES.has(lowered)) return whole;
    return `${open}${lowered}${gap === undefined ? "" : ": "}`;
  });

  /**
   * A media TYPE and the logical keywords, which are the language's words and carry no parens —
   * `@media PRINT`, `@media NOT print`, `@media screen AND (min-width: 40rem)`.
   */
  return spaced.replace(A_BARE_WORD, (whole, word: string) =>
    MEDIA_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : whole,
  );
}

/** `:name` or `::name`, and nothing about what follows a `(` — that is the author's own text. */
const A_PSEUDO = /(::?)([a-zA-Z-]+)/g;

/**
 * A feature name after a `(`, with the colon and the whitespace after it when there is one.
 *
 * A range condition — `(width > 40rem)` — has no colon, and the group comes back empty so nothing is
 * inserted. A `(prefers-reduced-motion)` with no value is the same case.
 */
const A_FEATURE = /(\()([a-zA-Z-]+)(\s*:\s*)?/g;

/** The at-rules whose CONDITION is the language's own vocabulary, so its feature names are lowered. */
const CONDITIONAL = new Set(["@media", "@supports", "@container"]);

/** Every at-rule name CSS has, lowered — a name outside it is not this function's to rewrite. */
const AT_RULES = new Set(Object.keys(AT_RULE_LINKS).map((one) => one.toLowerCase()));

/** Every pseudo-class and pseudo-element, without the `()` a functional one is listed with. */
const PSEUDO_CLASSES = new Set(
  Object.keys(SELECTORS)
    .filter((one) => one.startsWith(":") && !one.startsWith("::"))
    .map((one) => one.replace(/\(\)$/, "")),
);
const PSEUDO_ELEMENTS = new Set(
  Object.keys(SELECTORS)
    .filter((one) => one.startsWith("::"))
    .map((one) => one.replace(/\(\)$/, "")),
);

/** Every media feature, so a name outside the list — a browser's, or a typo — is left as written. */
const MEDIA_FEATURE_NAMES = new Set(MEDIA_FEATURES.map((one) => one.toLowerCase()));

/** Every property, for `@supports`, whose parens hold a declaration rather than a query. */
const PROPERTY_NAMES = new Set(PROPERTIES.map((one) => one.toLowerCase()));

/**
 * The media types and the logical keywords — the words a condition holds OUTSIDE its parens.
 *
 * A closed list, and short: the four types anybody writes plus the deprecated ones CSS still parses,
 * and `and`, `or`, `not`, `only`. A word outside it is an author's own — a `@layer` name reaches here
 * through no path, but a `@container`'s name does, and that is theirs.
 */
const MEDIA_WORDS = new Set([
  "all",
  "print",
  "screen",
  "speech",
  "aural",
  "braille",
  "embossed",
  "handheld",
  "projection",
  "tty",
  "tv",
  "and",
  "or",
  "not",
  "only",
]);

/** A bare word, outside any parens — see `MEDIA_WORDS`. */
const A_BARE_WORD = /(?<![\w(-])([a-zA-Z-]+)(?![\w(-])/g;
