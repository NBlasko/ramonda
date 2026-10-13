/**
 * What the editor offers inside a block that TypeScript cannot: a value's words, a selector's
 * pseudo-classes, and the caret's own reading of a half-written line.
 *
 * Part of the editor plugin — see `../plugin.ts`, which wires these into the language service.
 */
import { type Config } from "../../config/config";
import {
  PRIMITIVE,
  PROPERTIES,
  PROPERTY_NAMED,
  SELECTORS,
  UNION_TYPED,
  VALUE_WORDS,
} from "../../compiler/keywords.generated";
import { type Regions } from "./regions";
import { tokensOnlyKinds } from "../../config/codegen";
import type ts from "typescript";

/**
 * What the caret is in the middle of writing, read from the TEXT — a prelude, a value, or neither.
 *
 * The regions the plugin holds come from the PARSE, and a half-written line has not parsed into
 * anything. Measured, that is exactly the moment somebody asks: `position: ` and `&:` were both
 * answered with the 828 property names, and `position: stat` — where you no longer need the help —
 * was answered correctly.
 *
 * ## What separates a prelude from a declaration
 *
 * Nothing, from the caret backwards: `color:` and `&:` end the same way. What separates them is the
 * head of the run, and a nested rule's prelude starts with `&` in this language — `CssBlockShape`'s
 * key is `` `&${string}` ``, so that is a fact rather than a convention.
 *
 * The run is bounded by `;`, `{`, `}` and the block's own start, which is what keeps
 * `&:hover { color: ` a VALUE: the `{` ends the prelude's run before the `&` is reached.
 */
export function caretIn(
  text: string,
  position: number,
  where: Regions,
): { kind: "prelude"; colons: 1 | 2; typed: string } | { kind: "value"; property: string; typed: string } | undefined {
  const block = where.blocks.find((one) => one.start <= position && position <= one.end);
  if (block === undefined) return undefined;

  /** The word being typed, which is what a completion replaces. */
  let head = position;
  while (head > block.start && /[a-zA-Z-]/.test(text[head - 1])) head--;
  const typed = text.slice(head, position);

  /**
   * Back to the start of this run: a `;`, a brace, or just past the block's own opening.
   *
   * `block.start + 1` and not `block.start`, which is the `(` itself — measured, stopping on it put
   * the paren at the head of the run, so `&` was not first and `position` was not a name. The first
   * declaration in a block is the one that has no `;` before it, which is every case somebody types
   * into an empty block.
   */
  let from = head;
  while (from > block.start + 1 && !/[;{}]/.test(text[from - 1])) from--;
  const run = text.slice(from, head);

  if (run.trimStart().startsWith("&")) {
    const colons = run.endsWith("::") ? 2 : run.endsWith(":") ? 1 : undefined;
    // Only right after the colons. A caret elsewhere in a prelude is a combinator or a class name,
    // and this has no list for those — offering the pseudo-classes there would be a worse answer.
    return colons === undefined ? undefined : { kind: "prelude", colons, typed };
  }

  const colon = run.lastIndexOf(":");
  if (colon === -1) return undefined;
  const property = run.slice(0, colon).trim();
  return /^-{0,2}[a-zA-Z][\w-]*$/.test(property) ? { kind: "value", property, typed } : undefined;
}

/** The pseudo-classes or the pseudo-elements, without the colons the author has already typed. */
export function selectorsFor(colons: 1 | 2, typed: string): readonly string[] {
  const wanted = colons === 2 ? "::" : ":";
  const names = Object.keys(SELECTORS)
    .filter((one) => (colons === 2 ? one.startsWith("::") : !one.startsWith("::")))
    .map((one) => one.slice(wanted.length));

  /**
   * Unprefixed FIRST, then alphabetical: a dash sorts before a letter, so a plain sort puts eight
   * `-moz-` and `-ms-` names ahead of any real one after `&::`. `entryFor` says the same thing in
   * `sortText`, and both are here so the list reads right whether a consumer sorts it or takes it
   * as it comes.
   */
  return names
    .filter((one) => one.startsWith(typed.toLowerCase()))
    .sort((a, b) => Number(a.startsWith("-")) - Number(b.startsWith("-")) || a.localeCompare(b));
}

/**
 * The words a property accepts, for a caret standing in its value.
 *
 * **123 properties have a closed grammar and a real union, and TypeScript offers those itself** —
 * better than this could, with `!important` and `var()` beside each. The other 428 are `string |
 * number`, and with nothing from us, typing `transform: n` offered zero entries, so the editor fell
 * back to its own word list and suggested `nav`, `noframes`, `noscript` — HTML tag names, in a CSS
 * value.
 *
 * The list is the one the CHECKER already reads. `KEYWORDS` holds the bare words each property's
 * grammar reaches, for exactly the properties the types do not cover, and `PROPERTY_NAMED` holds
 * the ones whose value is a property name. So the table that reports `display: flexx` is the table
 * that suggests `flex`.
 *
 * A property that admits a free identifier — `animation-name`, `font-family` — has no entry and
 * gets nothing, which is right: that name is the author's own and nothing can suggest it.
 */
export function valueWords(property: string, config: Config): readonly string[] | undefined {
  // A real union is TypeScript's to offer, and it offers `!important` and `var()` beside each word.
  if (UNION_TYPED.includes(property)) return undefined;

  /**
   * **A union the PROJECT gave it, which `UNION_TYPED` cannot know about.**
   *
   * That constant is generated from the shipped map and ships with the package. The moment a config
   * narrows `z-index` to `1 | 2 | 5 | 10`, the generated module gives it a real union — and
   * offering everything CSS allows would suggest `auto` and `abs()` beside values the type refuses.
   * A suggestion that does not compile is worse than no suggestion.
   *
   * So the question is put to the config as well. A property with a closed list is TypeScript's to
   * answer, exactly as a property with a shipped union is.
   */
  if (config.properties?.[property as keyof NonNullable<Config["properties"]>] !== undefined) {
    const rule = config.properties[property as keyof NonNullable<Config["properties"]>] as
      | { readonly values?: readonly unknown[] }
      | undefined;
    if (rule?.values !== undefined) return undefined;
  }

  const own = VALUE_WORDS[property];
  // A property whose value is a property NAME — `transition-property`, `will-change` — takes any of
  // them, which is what a real CSS language service offers there too.
  const named = PROPERTY_NAMED[property] === undefined ? [] : PROPERTIES;
  if (own === undefined && named.length === 0) return undefined;

  /**
   * A kind this project takes only from its TOKENS offers none of that kind's literals.
   *
   * The offer has to match what the rule accepts, or the editor suggests what the checker reports:
   * with `"<color>": { hardcoded: false }`, typing `color: ` would offer 210 colour keywords, every
   * one of which `hardcoded-not-allowed` then refuses.
   *
   * What stays is what the SETTING itself leaves alone, so the two agree by construction rather
   * than by a second list: `currentcolor` is a reference to the inherited colour rather than one
   * anybody wrote, and the CSS-wide keywords below are not values either.
   */
  const kinds = tokensOnlyKinds(config.properties);
  const primitive = PRIMITIVE[property];
  const literal =
    primitive !== undefined && kinds.includes(primitive) ? (word: string) => word === "currentcolor" : () => true;

  return [
    ...(own === undefined ? [] : own.split(" ").filter(Boolean).filter(literal)),
    ...named.filter(literal),
    "var()",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
  ];
}

/**
 * One word as a completion entry.
 *
 * A function is written `translate()` in the table and offered under that name — which is what a
 * reader recognises — but INSERTED without its closing parenthesis, so the caret lands where the
 * arguments go and the editor closes the bracket itself.
 */
export function entryFor(name: string): ts.CompletionEntry {
  const call = name.endsWith("()");
  /**
   * A VENDOR-PREFIXED name sorts last. Somebody typing `&::` wants `before` or `after`;
   * `-moz-progress-bar` is a name they will never reach for.
   *
   * The same judgement as the call below, one step further: the ordinary answer first. Both stay in
   * the list — a project supporting an old engine needs them, and they are one keystroke away.
   */
  const prefixed = name.startsWith("-");
  return {
    name,
    kind: "string" as ts.ScriptElementKind,
    sortText: `${prefixed ? "2" : "0"}${call ? "1" : "0"}`,
    ...(call ? { insertText: name.slice(0, -1) } : {}),
  };
}

/** A quoted key as CSS spells it — see the note in `getCompletionsAtPosition`. */
export function unquoted(name: string): string {
  return name.length > 1 && name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1) : name;
}
