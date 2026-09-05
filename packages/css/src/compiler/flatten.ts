import type { Block, BlockItem, NestedRule } from "./ast";
import { HOLE, collapse } from "./normalise";
import { CONDITION, SPREAD } from "./read";

/**
 * One declaration, taken out of the block it was written in.
 *
 * A whole block is one class and one rule, so nothing ever had to say what a block SETS. Composition
 * does: two blocks merge by keeping, per thing set, the one written later — so each declaration
 * needs a name for the thing it sets, and that name has to be equal exactly when two declarations
 * target the same thing.
 */
export interface AtomicDeclaration {
  /**
   * What this declaration sets, canonically — `display`, `:hover|background`,
   * `@media (min-width: 40rem)|:hover|color`.
   *
   * Two declarations with the same key are the same thing set twice, and the later one wins. It is
   * never parsed back, only compared, which is why the parts can share a separator that a selector
   * is allowed to contain.
   */
  readonly key: string;
  /** The property alone, which is what the sheet orders by. */
  readonly property: string;
  /**
   * The text this declaration hashes as, holes standing in as placeholders.
   *
   * The KEY is not enough to hash by: two blocks setting `color` to different values must be two
   * classes. This is `property:value;`, canonical, and it is what the class name is derived from.
   */
  readonly canonical: string;
  /** Appended to the class in the selector — `:hover`, ` .title`, `""` for the class alone. */
  readonly selector: string;
  /** The conditional at-rules around it, sorted — see {@link flatten}. */
  readonly conditions: readonly string[];
  /** The BLOCK's hole indices this declaration uses, in the order it uses them. */
  readonly holes: readonly number[];
}

/**
 * A block, taken apart into the declarations it makes.
 *
 * ## The key is canonical rather than as-written, and both halves are measured
 *
 * - **At-rules are sorted**, because they commute: measured in Chromium,
 *   `@media X { @supports Y { … } }` and `@supports Y { @media X { … } }` are the same rule. Keyed
 *   as written, two authors writing the same CSS in a different nesting order would get different
 *   keys — and a modifier would silently fail to override a base.
 * - **Selector parts compose in order**, because they do not commute: `&:hover` inside `& .title` is
 *   `& .title:hover` and the reverse is a different element.
 *
 * ## Holes are renumbered per declaration
 *
 * A hole's index belongs to the BLOCK, so `color: {{x}}` is hole 0 alone and hole 1 under another
 * declaration — the same declaration with two canonical texts, two classes, and the dedupe that pays
 * for this whole design gone. The placeholder carries the LOCAL index and {@link AtomicDeclaration.holes}
 * says which of the block's holes those are.
 *
 * ## What it does not do
 *
 * Nothing here decides identity beyond the text: number forms, colour forms and keyword case are
 * left alone for the reason `normalise` gives — a wrong merge changes a page nobody edited, and a
 * missed one costs a duplicate rule.
 */
/**
 * One argument of the merge a block compiles to.
 *
 * A run of declarations under the same guards is ONE map — not one each — a spread is another
 * block's map, and the guards are the conditions of the `@@if` groups it sits inside.
 *
 * **Nesting is a conjunction**, which is why the guards are a flat list rather than a tree. That is
 * only correct because the merge is associative, which was measured over 50,301 random groupings
 * drawn from one shorthand family: zero disagreements between a nested merge and a flat one.
 */
export type AtomicSegment =
  | { readonly kind: "declarations"; readonly guards: readonly number[]; readonly items: AtomicDeclaration[] }
  | { readonly kind: "spread"; readonly guards: readonly number[]; readonly hole: number };

/** Every declaration a block makes, ignoring how it is composed. */
export function flatten(block: Block): AtomicDeclaration[] {
  return segments(block).flatMap((one) => (one.kind === "declarations" ? one.items : []));
}

/**
 * A block as the arguments of one merge, in the order the author wrote them.
 *
 * `flatten` answers *what does this set*; this answers *how is it composed*. Two functions because
 * most of the package only needs the first — the rules, the sheet and the checker all ask what a
 * block sets and never how it was assembled.
 */
export function segments(block: Block): AtomicSegment[] {
  const out: AtomicSegment[] = [];
  walk(block.items, "", [], [], out);
  return out;
}

function walk(
  items: readonly BlockItem[],
  selector: string,
  conditions: readonly string[],
  guards: readonly number[],
  out: AtomicSegment[],
): void {
  /** The run being built, so declarations under one guard are one map rather than one each. */
  const run = (): AtomicDeclaration[] => {
    const last = out[out.length - 1];
    if (last?.kind === "declarations" && same(last.guards, guards)) return last.items;
    const fresh: AtomicDeclaration[] = [];
    out.push({ kind: "declarations", guards: [...guards], items: fresh });
    return fresh;
  };

  for (const item of items) {
    if (item.kind === "rule") {
      const condition = holeIn(item.prelude, CONDITION);
      if (condition !== undefined) {
        walk(item.items, selector, conditions, [...guards, condition], out);
        continue;
      }
      if (item.prelude.trimStart().startsWith("@")) {
        walk(item.items, selector, [...conditions, collapse(item.prelude)], guards, out);
        continue;
      }
      walk(item.items, selector + suffixOf(item), conditions, guards, out);
      continue;
    }

    const spread = holeIn(item.property, SPREAD);
    if (spread !== undefined) {
      out.push({ kind: "spread", guards: [...guards], hole: spread });
      continue;
    }

    run().push(declarationOf(item, selector, conditions));
  }
}

/** One declaration, with the context it was written in. */
function declarationOf(
  item: Extract<BlockItem, { kind: "declaration" }>,
  selector: string,
  conditions: readonly string[],
): AtomicDeclaration {
  const property = propertyName(item.property);
  /** Local to this declaration, so the same declaration anywhere is the same text. See above. */
  const holes: number[] = [];
  let value = "";
  for (const part of item.value) {
    if (part.kind === "text") {
      value += part.text;
      continue;
    }
    value += `${HOLE}${holes.length}${HOLE}`;
    holes.push(part.index);
  }

  return {
    key: [...[...conditions].sort(), ...(selector === "" ? [] : [selector]), property].join("|"),
    property,
    canonical: `${property}:${collapse(value)};`,
    selector,
    conditions: [...conditions].sort(),
    holes,
  };
}

/**
 * The hole index a composition marker's head holds — `@@if {{c}}`, `...{{base}}` — or nothing.
 *
 * The marker and nothing else: `@@iffy {{c}}` is not a condition, and `... {{a}} {{b}}` is not a
 * spread. Anything that is not exactly the marker and one hole falls through to being read as what
 * it looks like, which is a selector or a property name, and is refused there.
 */
function holeIn(head: string, marker: string): number | undefined {
  const escaped = marker === SPREAD ? "\\.\\.\\." : marker;
  const found = new RegExp(`^\\s*${escaped}\\s*${HOLE}(\\d+)${HOLE}\\s*$`).exec(head);
  return found === null ? undefined : Number(found[1]);
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((one, index) => one === b[index]);

/**
 * What a nested rule appends to its parent's selector.
 *
 * `&:hover` is `:hover` and `& .title` is ` .title` — the `&` is where the parent goes, so what
 * follows it is the suffix. A prelude with no `&` is a DESCENDANT, which is what CSS nesting says a
 * bare selector means inside a rule, so it gets the space CSS would have added.
 */
function suffixOf(rule: NestedRule): string {
  const prelude = collapse(rule.prelude);
  return prelude.startsWith("&") ? prelude.slice(1) : ` ${prelude}`;
}

/** `COLOR` and `color` are one property; `--Accent` and `--accent` are two. See `normalise`. */
function propertyName(property: string): string {
  return property.startsWith("--") ? property : property.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
