import type { Block, BlockItem, NestedRule } from "./ast";
import { HOLE, collapse } from "./normalise";

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
export function flatten(block: Block): AtomicDeclaration[] {
  const out: AtomicDeclaration[] = [];
  walk(block.items, "", [], out);
  return out;
}

function walk(
  items: readonly BlockItem[],
  selector: string,
  conditions: readonly string[],
  out: AtomicDeclaration[],
): void {
  for (const item of items) {
    if (item.kind === "rule") {
      if (item.prelude.trimStart().startsWith("@")) {
        walk(item.items, selector, [...conditions, collapse(item.prelude)], out);
        continue;
      }
      walk(item.items, selector + suffixOf(item), conditions, out);
      continue;
    }

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

    out.push({
      key: [...[...conditions].sort(), ...(selector === "" ? [] : [selector]), property].join("|"),
      property,
      canonical: `${property}:${collapse(value)};`,
      selector,
      conditions: [...conditions].sort(),
      holes,
    });
  }
}

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
