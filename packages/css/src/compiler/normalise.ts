import type { Block, BlockItem, ValuePart } from "./ast";

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
 * U+0000 becomes U+FFFD during CSS preprocessing, so no author can write one into a block — a
 * placeholder made of it cannot be forged by the source it is protecting.
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
 */
function collapse(text: string): string {
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
