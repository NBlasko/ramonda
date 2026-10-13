/** What several rule families share: the block's shape as the rules read it, and small readers of a value. */

import { type BlockItem as AnyItem, type Declaration, type NestedRule as AnyRule, type ValuePart } from "../ast";
import { CONDITION } from "../read";
import { HOLE } from "../normalise";
import { PROPERTIES, STRING_ALLOWED } from "../keywords.generated";
import { COLOUR_WORDS } from "./projectLimits";
import { endOfCall, endOfString } from "./text";

/**
 * A block as the rules read it: declarations and nested rules, and nothing else.
 *
 * A block-level `match` reaches them as one GROUP per arm — a `when` on the subject — because that
 * is what an arm is to every question asked here: declarations that apply under a condition. A
 * value is checked as the property's, a property name as a property, and two arms are never
 * compared with each other, exactly as two `when` groups are not. What only a match has — its keys —
 * is asked of the block before the conversion, by `blockMatchArms`.
 */
export interface NestedRule extends Omit<AnyRule, "items"> {
  readonly items: readonly BlockItem[];
}
export type BlockItem = Declaration | NestedRule;
export interface Block {
  readonly items: readonly BlockItem[];
}

/**
 * A declaration whose value CHOOSES — a value `match`, a choice — as one group per answer, each
 * holding the declaration with that answer as its whole value.
 *
 * So every rule that reads a value reads every arm: `color: match $(t) { a => redd; }` is reported
 * as `color: redd` is. Each answer is its own group, so two of them are never compared as a repeat
 * or an override. An answer holding a hole is left out: `hole-in-a-match-arm` reports it, and the
 * value rules would only say it again.
 */
function answersOf(item: Declaration): BlockItem[] | undefined {
  const chooses = item.value.find((part) => part.kind === "match" || part.kind === "choice");
  if (chooses === undefined) return undefined;
  const answers =
    chooses.kind === "match"
      ? chooses.arms.map((arm) => ({ hole: chooses.hole, value: arm.value }))
      : chooses.kind === "choice"
        ? [
            ...chooses.branches.map((one) => ({ hole: one.hole, value: one.value })),
            { hole: chooses.branches[chooses.branches.length - 1]?.hole ?? 0, value: chooses.otherwise },
          ]
        : [];
  return answers
    .filter((one) => one.value.length > 0 && !one.value.some((part) => part.kind === "hole"))
    .map((one) => ({
      kind: "rule",
      at: item.at,
      preludeEnd: item.at,
      prelude: `${CONDITION} ${HOLE}${one.hole}${HOLE}`,
      items: [{ ...item, value: one.value, valueAt: one.value[0]?.at ?? item.valueAt }],
    }));
}

export function asGroups(items: readonly AnyItem[]): BlockItem[] {
  return items.flatMap((item): BlockItem[] => {
    if (item.kind === "declaration") return answersOf(item) ?? [item];
    if (item.kind === "rule") return [{ ...item, items: asGroups(item.items) }];
    const prelude = `${CONDITION} ${HOLE}${item.hole}${HOLE}`;
    return item.arms.map((arm) => ({
      kind: "rule",
      at: arm.at,
      preludeEnd: arm.at === undefined ? undefined : arm.at + arm.key.length,
      prelude,
      items: asGroups(arm.items),
    }));
  });
}

/** Accepted by every property, whatever else it accepts. */
export const GLOBAL = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** The same list as a set, for the "does this exist" question rather than the "what was meant" one. */
export const KNOWN = new Set(PROPERTIES);

/** The same question as {@link STRING_ALLOWED}, asked once — see `stringNotAllowed`. */
export const STRINGS_FIT = new Set(STRING_ALLOWED);

/** The first bare word in a value that is a named colour, with where it starts. */
export function namedColour(text: string): RegExpExecArray | null {
  for (const match of text.matchAll(/(?<![\w-])([a-zA-Z][a-zA-Z0-9-]*)(?![\w-]*\()/g)) {
    if (COLOUR_WORDS.has(match[1].toLowerCase())) return match as RegExpExecArray;
  }
  return null;
}

/**
 * A registered property set to a value its own `syntax` refuses.
 *
 * **Measured in Chromium 151, and it fails without failing:**
 *
 *     @property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg }
 *     .set { --angle: 12px }        ->  --angle computes to 0deg
 *
 * The value is discarded and the `initial-value` stands. Nothing is dropped and nothing is said, so
 * the element shows the default and looks deliberate — and a `@keyframes` frame set to the wrong
 * type behaves the same way, which is an animation that silently does not move.
 *
 * Both halves are here to be read: the reference has resolved to the site's generated name, and that
 * site's `syntax` came from its own block. It reuses {@link ACCEPTS}, so it gives up exactly the same
 * reports for exactly the same reason — a component with no matcher, or a multiplier, says nothing.
 *
 * A value holding a hole or a `var()` is not judged: what it will be is not known here.
 */
/**
 * A value with a trailing `!important` taken off — `!`, any space, and the word in any case.
 *
 * Read from the end rather than by regex: `\s*!\s*important\s*$` starts again at every space, and
 * measured, 40 000 spaces inside a value took 2.5 s.
 */
export function withoutImportant(value: string): string {
  const end = value.trimEnd();
  if (!end.toLowerCase().endsWith("important")) return value;
  const before = end.slice(0, -"important".length).trimEnd();
  return before.endsWith("!") ? before.slice(0, -1).trimEnd() : value;
}

/**
 * The selectors of a list, split at a comma only where it ends one — not inside a function's
 * argument, an attribute's brackets or a quote: `&:is(.a, :root)` is ONE selector.
 */
export function selectorsOf(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let at = "";
  for (const ch of list) {
    if (quote !== "") {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(at);
      at = "";
      continue;
    }
    at += ch;
  }
  out.push(at);
  return out;
}

/* ── reading a value ───────────────────────────────────────────────────────────────────────── */

interface Word {
  readonly text: string;
  readonly at: number | undefined;
}

/**
 * The bare identifiers in a value, and nothing else.
 *
 * Everything skipped here is something no keyword table could judge, and each would be a false
 * report: a string's contents (`content: "flexx"`), a function's name and arguments (`rgb(0 0 0)`,
 * `var(--x, flex)`), a number or a length, a hex colour, and `!important`.
 *
 * A hole contributes nothing at all — its value is decided at render, and this is a build-time
 * read.
 */
export function words(parts: readonly ValuePart[]): Word[] {
  const out: Word[] = [];

  for (const [position, part] of parts.entries()) {
    if (part.kind !== "text") continue;
    // The compiler's own text, not the author's: a generated name is no typo and has no position.
    if (part.resolved) continue;
    const text = part.text;

    /**
     * A word TOUCHING a hole is part of the hole's value, not a value of its own.
     *
     * `padding: $(n)px` is one length written in two pieces, and `px` on its own is nothing a
     * property accepts — read alone, `gap: $(n)px` gives *`gap` does not accept `px`*, a false
     * report on correct CSS. Whitespace is what separates values, so a piece with none between it
     * and the hole is the same value.
     */
    const glued = {
      before: position > 0 && parts[position - 1].kind === "hole" && !isSpace(text.charCodeAt(0)),
      after:
        position + 1 < parts.length &&
        parts[position + 1].kind === "hole" &&
        !isSpace(text.charCodeAt(text.length - 1)),
    };
    const first = out.length;

    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);

      if (code === 34 || code === 39) {
        index = endOfString(text, index);
        continue;
      }
      if (code === 33 /* ! */) {
        /**
         * `!important`, **and the space CSS allows after the bang.**
         *
         * Skipping only to the next SPACE would leave `important` in `! important` to be read as a
         * bare word — *"`color` does not accept `important`"*, about valid CSS. Measured in
         * Chromium: `! important`, `! important`, `!IMPORTANT` and `!` + a comment + `important`
         * all make the declaration win, and `!importantt` does not.
         *
         * Whitespace is stepped over first, then the word, so a word that merely begins with a bang
         * is still a word and is still reported — which is what this rule is for.
         */
        index++;
        while (index < text.length && isSpace(text.charCodeAt(index))) index++;
        while (index < text.length && !isSpace(text.charCodeAt(index))) index++;
        continue;
      }
      if (code === 35 /* # */ || (code >= 48 && code <= 57) || code === 46 /* . */) {
        while (index < text.length && !isSpace(text.charCodeAt(index)) && text.charCodeAt(index) !== 44) index++;
        continue;
      }
      /**
       * A leading `-` belongs to the word when a letter or another `-` follows it, which is CSS's own
       * identifier rule: `-webkit-transform` and `--brand` are one word each, and `-8px` is a number.
       * Without it, a vendor-prefixed property read as `webkit-transform` and a custom property as
       * `brand` — both reported as typos of something they are not.
       */
      const dashed = code === 45 && (isWordStart(text.charCodeAt(index + 1)) || text.charCodeAt(index + 1) === 45);
      if (!dashed && !isWordStart(code)) continue;

      const start = index;
      if (dashed) index += text.charCodeAt(index + 1) === 45 ? 2 : 1;
      while (index < text.length && isWordCharacter(text.charCodeAt(index))) index++;

      // A function: the name is not a keyword and its arguments are its own grammar.
      if (text.charCodeAt(index) === 40 /* ( */) {
        index = endOfCall(text, index);
        continue;
      }

      out.push({ text: text.slice(start, index), at: part.at === undefined ? undefined : part.at + start });
      index--;
    }

    if (glued.before && out.length > first) out.splice(first, 1);
    if (glued.after && out.length > first) out.pop();
  }

  return out;
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
const isWordStart = (code: number) => (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
const isWordCharacter = (code: number) => isWordStart(code) || (code >= 48 && code <= 57) || code === 45 || code === 95;

/**
 * Every declaration in a block, at any depth inside its nested rules, in source order — the walk
 * most rules make, done once per block.
 *
 * A rule reads `for (const item of declarationsIn(block))`, and the list is made by whichever of
 * them asks first. The rules that look at a nested rule's SELECTOR walk the rules themselves.
 */
const declarationsByBlock = new WeakMap<Block, readonly Declaration[]>();

export function declarationsIn(block: Block): readonly Declaration[] {
  let found = declarationsByBlock.get(block);
  if (found === undefined) {
    const out: Declaration[] = [];
    const walk = (items: readonly BlockItem[]): void => {
      for (const item of items) {
        if (item.kind === "rule") walk(item.items);
        else out.push(item);
      }
    };
    walk(block.items);
    found = out;
    declarationsByBlock.set(block, found);
  }
  return found;
}

/**
 * Every nested rule in a block, at any depth — the rules inside one before the rule itself, so the
 * rules reading a prelude report in a stable order.
 */
const rulesByBlock = new WeakMap<Block, readonly NestedRule[]>();

export function rulesIn(block: Block): readonly NestedRule[] {
  let found = rulesByBlock.get(block);
  if (found === undefined) {
    const out: NestedRule[] = [];
    const walk = (items: readonly BlockItem[]): void => {
      for (const item of items) {
        if (item.kind !== "rule") continue;
        walk(item.items);
        out.push(item);
      }
    };
    walk(block.items);
    found = out;
    rulesByBlock.set(block, found);
  }
  return found;
}
