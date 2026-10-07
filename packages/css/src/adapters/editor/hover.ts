/**
 * What a hover says inside a block: a property's grammar moved up from its JSDoc, and a sentence
 * for a selector, an at-rule or this language's own markers.
 *
 * Part of the editor plugin — see `../plugin.ts`, which wires these into the language service.
 */
import { AT_RULE_LINKS, SELECTORS } from "../../compiler/keywords.generated";
import { CONDITION, MATCH } from "../../compiler/read";
import { type Regions } from "./regions";
import type ts from "typescript";

/** Quick info at a position, or nothing when there is no position to ask about. */
export function quickInfoAt(service: ts.LanguageService, fileName: string, at: number | undefined) {
  return at === undefined ? undefined : service.getQuickInfoAtPosition(fileName, at);
}

/**
 * What THIS language says about a prelude, which nobody else can.
 *
 * TypeScript's own answer for `::after` is `(property) "&::after": ({ content: string } | …)[]` — a
 * true sentence about the object literal the virtual file builds, and useless to somebody asking
 * what `::after` does. `when` and `...` get nothing at all. A property already answers well,
 * because `asCss` reshapes what the generated types carry; this is the same idea for everything
 * else a block holds.
 *
 * The selector names, their groups and their MDN links are generated from `mdn-data`; the sentences
 * are written, and the generator refuses a sentence naming a selector CSS does not have. `when` and
 * `...` have no upstream — what they say is what this repository measured about them.
 */
const COMPOSITION: Readonly<Record<string, { signature: string; note: string }>> = {
  [CONDITION]: {
    signature: "when $( … )",
    note:
      "The declarations inside apply only while the condition holds.\n\n" +
      "Everything is one merge in the order it was written, so **later wins** — a group below a " +
      "declaration overrides it, and a group above it does not. That is the rule a reader of CSS " +
      "already has, and it is the thing a whole-block class could never express: the order of names " +
      "in a `class` attribute means nothing in CSS.\n\n" +
      "A group inside a group holds only when both conditions do.",
  },
  "else when": {
    signature: "else when $( … )",
    note:
      "The rest of the choice above it: its declarations apply when this condition holds and none " +
      "before it in the chain did. The first condition that holds brings its group, and the rest " +
      "are not asked.",
  },
  else: {
    signature: "else",
    note:
      "The last of the choice above it: its declarations apply when no condition in the chain held. " +
      "The first condition that holds brings its group, so this one comes in only when none did.",
  },
  [MATCH]: {
    signature: "match $( … )",
    note:
      "Picks one arm by the subject's value. Every arm is classes made when the block compiles, and " +
      "the render only chooses between them.\n\n" +
      "The keys are checked against the subject's type. `_` answers for every value the arms above " +
      "it do not name; without it, a subject no arm names brings nothing.",
  },
  "...": {
    signature: "...$( … )",
    note:
      "Merges another block's declarations here, in this position.\n\n" +
      "It works across files, because what it merges is a value — importable, storable in an object, " +
      "or picked out of one, which is what makes a choice between blocks exhaustive over a union.\n\n" +
      "**Later wins**, so what is spread above a declaration loses to it and what is spread below " +
      "overrides it.",
  },
};

/** `:has(…)` in a block is `:has()` upstream, and a bare `:hover` is itself. */
function selectorNamed(prelude: string): string | undefined {
  const trimmed = prelude.trim().replace(/^&/, "").trim();
  if (!trimmed.startsWith(":")) return undefined;

  const called = /^(:{1,2}[a-z-]+)\(/.exec(trimmed);
  if (called !== null) return `${called[1]}()`;
  return /^(:{1,2}[a-z-]+)$/.exec(trimmed)?.[1];
}

export function spoken(where: Regions, at: number): ts.QuickInfo | undefined {
  const found = where.preludes.find((span) => span.start <= at && at <= span.end);
  if (found === undefined) return undefined;

  const span = { start: found.start, length: found.end - found.start };
  const say = (signature: string, note: string): ts.QuickInfo => ({
    // The kind an editor shows beside the signature. "" is "no icon", which is right for a
    // selector: it is not a variable, a property or a function.
    kind: "" as ts.ScriptElementKind,
    kindModifiers: "",
    textSpan: span,
    displayParts: [{ text: signature, kind: "text" }],
    documentation: note === "" ? [] : [{ text: note, kind: "text" }],
  });

  const trimmed = found.prelude.trim();
  const marker = /^else\s+when\b/.test(trimmed)
    ? "else when"
    : /^else\b/.test(trimmed)
      ? "else"
      : trimmed.startsWith(CONDITION)
        ? CONDITION
        : trimmed.startsWith(MATCH)
          ? MATCH
          : trimmed === "..."
            ? "..."
            : undefined;
  const composition = marker === undefined ? undefined : COMPOSITION[marker];
  if (composition !== undefined) return say(composition.signature, composition.note);

  const name = selectorNamed(found.prelude);
  const known = name === undefined ? undefined : SELECTORS[name];
  if (name !== undefined && known !== undefined) {
    const lines = [known.group, known.note, known.url].filter((one) => one !== "");
    return say(name, lines.join("\n\n"));
  }

  /**
   * An at-rule shows its own text and its link, and no sentence.
   *
   * The difference from a selector is what the reader is asking: `@media (min-width: 40rem)` says
   * what it asks already, so a sentence would repeat the text. All 19 at-rules in `mdn-data` carry a
   * url, so this needs nothing written for it — which is also why an at-rule invented tomorrow shows
   * its own text rather than nothing.
   */
  const atRule = /^(@[a-z-]+)/.exec(trimmed)?.[1];
  const link = atRule === undefined ? undefined : AT_RULE_LINKS[atRule];
  if (link !== undefined) return say(trimmed, link);

  // A selector with no entry, or an at-rule nobody has heard of: its own text is the honest answer,
  // and it is better than a sentence about an object literal.
  return trimmed.startsWith("@") || trimmed.startsWith("&") || trimmed.startsWith(":") ? say(trimmed, "") : undefined;
}

/** The first line of a generated property's JSDoc: the name, an em dash, and the grammar. */
const GRAMMAR = /^`([a-z-]+)` — `([^`]*)`\n?/;

/**
 * A hover that reads as CSS rather than as the object literal the CSS is checked through.
 *
 * The type map is an object type, so TypeScript's own answer is `(property) "padding-left"?:
 * CssValue | undefined` — true, and the least useful true thing to put on the first and largest
 * line a reader sees. What someone hovering a CSS property wants is its GRAMMAR, and the generated
 * type carries it as the first line of its JSDoc, written by `build-css-properties.mjs`.
 *
 * So this MOVES that line up rather than finding the answer a second time. The shape is pinned by a
 * test, because the format is written in one place and read in another.
 *
 * A property the generator knows nothing about — a custom property — has no such line, and then
 * TypeScript's own answer stands, which is the right answer for a name only the author knows.
 */
export function asCss(info: ts.QuickInfo): ts.QuickInfo {
  const documentation = info.documentation ?? [];
  const text = documentation.map((one) => one.text).join("");
  const found = GRAMMAR.exec(text);
  if (found === null) return info;

  const [whole, property, syntax] = found;
  return {
    ...info,
    displayParts: [
      { text: property, kind: "propertyName" },
      { text: ": ", kind: "punctuation" },
      { text: syntax, kind: "text" },
    ],
    // Without the line that just became the signature: moved, not copied.
    documentation: [{ text: text.slice(whole.length), kind: "text" }],
  };
}
