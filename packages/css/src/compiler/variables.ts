import type { Block, BlockItem, ValuePart } from "./ast";

/**
 * What a block does with custom properties: the names it SETS, and the names it READS.
 *
 * Two halves of one question, and they are asked from two places — the rule that reports an unknown
 * name and the transform that hands them to the stylesheet. One function, so a name counted as set
 * in one place cannot be counted as unset in the other.
 */
export interface Variables {
  /** Every `--name` this block declares, whatever it is nested inside. */
  readonly set: readonly string[];
  /** Every `var(--name)` this block reads, with where the name was written. */
  readonly read: readonly VariableRead[];
  /**
   * Every REGISTERED name this block reads through `var()` — a reference to a `@@property` site.
   *
   * Kept apart from {@link Variables.read} because the question is the other one. A read in `read`
   * asks *does this name exist*, and a registered one always does: it carries an initial value, so
   * it always resolves. What is worth asking about it is whether anything ever SETS it — a property
   * read everywhere and set nowhere renders its initial value on every element, silently, and that
   * is the shape a forgotten setter has.
   *
   * Names only. The position a finding wants is the `@@property` site's, which is in another file
   * as often as not, and this is the half that says the name was read at all.
   */
  readonly readsRegistered?: readonly string[];
}

/**
 * One `@@property( … )` site: the name it registers, and where the author wrote it.
 *
 * The BINDING is kept beside the generated name because the generated name is not what anybody
 * wrote — a message naming `--r-2bj4gSXts` would send a person looking for a string that is in no
 * file. The binding is the word in their editor.
 */
export interface RegisteredSite {
  /** The generated name, which is what a block reads and what a setter has to set. */
  readonly name: string;
  /** The binding the author gave it, for the message. */
  readonly binding: string;
  /** The author's offset of the site's `@`, so a finding lands on the declaration. */
  readonly at: number;
  readonly length: number;
}

export interface VariableRead {
  readonly name: string;
  /** The author's offset of the first `-`, so a finding lands on the name itself. */
  readonly at: number;
  readonly length: number;
  /**
   * Whether the read carries a fallback — `var(--brand, #10b981)`.
   *
   * CSS's own way of saying the value may be absent, so a read with one is never reported. That is
   * the escape that costs nothing: it is the CSS an author writes anyway, not a directive of ours.
   */
  readonly fallback: boolean;
}

/**
 * Every custom property one block sets and reads.
 *
 * A block's custom properties land on ONE element, so nesting does not divide them: a name set at
 * the top and read inside `&:hover` is the same variable as one set and read in the same place.
 */
export function variablesIn(block: Block): Variables {
  const set: string[] = [];
  const read: VariableRead[] = [];
  const readsRegistered: string[] = [];

  const walk = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walk(item.items);
        continue;
      }
      if (item.property.startsWith("--")) set.push(item.property);
      readsIn(item.value, read);
      registeredReadsIn(item.value, readsRegistered);
    }
  };
  walk(block.items);

  return { set, read, readsRegistered };
}

/**
 * Every `var()` whose name is a RESOLVED reference — `var({angle})`, once `{angle}` is the name.
 *
 * A resolved reference arrives as its own part holding nothing but the generated name — see
 * `readBlock`, which builds it that way precisely so no rule has to find a name inside text. So the
 * question is only what stands immediately before it, and `var(` is the one answer that makes this
 * a read rather than a mention.
 *
 * **A bare `{angle}` in a value is NOT counted.** Writing the name where a value goes is not reading
 * the property, it is writing its name out as text, and CSS does nothing with that. Counting it
 * would turn one fault into evidence against another.
 */
function registeredReadsIn(parts: readonly ValuePart[], into: string[]): void {
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    if (part.kind !== "text" || part.resolved !== true) continue;

    const before = parts[index - 1];
    if (before.kind !== "text" || before.resolved === true) continue;
    if (!OPENS_VAR.test(before.text)) continue;

    into.push(part.text);
  }
}

/** `var(` at the very end of the text before the name, with CSS's own whitespace allowed inside. */
const OPENS_VAR = /(?:^|[^\w-])var\s*\(\s*$/i;

/**
 * Every `var(--name)` in one value, with the name's own position and whether it has a fallback.
 *
 * A fallback holds a value, so it holds `var()` too — `var(--brand, var(--accent))` reads both, and
 * scanning for every occurrence rather than parsing the call gets the nested one for free. Each is
 * asked about its own fallback: in that example both have one, and in `var(--a, var(--b))` the inner
 * name has none and is the one that has to exist.
 *
 * `var` is matched case-insensitively because CSS function names are, and a `var(` inside a string is
 * stepped over: `content: "var(--x)"` is text, and reporting it would be reporting a quotation.
 *
 * A RESOLVED part is skipped — see `TextPart.resolved`. The name in it is this compiler's own, from
 * a `@@property` site that by definition exists.
 */
export function readsIn(parts: readonly ValuePart[], into: VariableRead[]): void {
  for (const part of parts) {
    if (part.kind !== "text" || part.resolved || part.at === undefined) continue;
    const text = part.text;

    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 39) {
        index = endOfString(text, index);
        continue;
      }
      if (code !== 118 && code !== 86 /* v V */) continue;
      /**
       * **The END of an ident that happens to be `var`**, which was read as a call and reported.
       *
       * This looked for `v`, `a`, `r`, `(` and never at what came before, so `mysvar(--x)` was a read
       * of `--x` — a name nothing sets, reported on valid CSS with nothing else to explain it. A
       * false report is the one failure a checker does not survive. `-` counts, because a CSS ident
       * may hold one: `my-var(` is one ident, not `my-` and a call.
       */
      if (index > 0 && isWordCharacter(text.charCodeAt(index - 1))) continue;

      let after = index + 1;
      if ((text.charCodeAt(after) | 32) !== 97 /* a */) continue;
      if ((text.charCodeAt(after + 1) | 32) !== 114 /* r */) continue;
      after += 2;
      while (after < text.length && isSpace(text.charCodeAt(after))) after++;
      if (text.charCodeAt(after) !== 40 /* ( */) continue;

      let start = after + 1;
      while (start < text.length && isSpace(text.charCodeAt(start))) start++;
      if (text.charCodeAt(start) !== 45 || text.charCodeAt(start + 1) !== 45) {
        // Not a custom property — `var(SomeIdent)` is not valid CSS and is nothing this owns.
        index = after;
        continue;
      }

      let end = start + 2;
      while (end < text.length && isWordCharacter(text.charCodeAt(end))) end++;

      /**
       * The name ran to the end of this part, so it is NOT FINISHED — the next part is a hole, or
       * the text simply stops.
       *
       * `var(--brand-{n})` is refused by `glued-hole`, and this reported `--brand-` as well: one
       * fault came back as two, and the second named a variable nobody wrote. An unreadable call is
       * not evidence of a missing name either way, which is what the note below already says about
       * the character after it.
       */
      if (end === text.length) {
        index = end - 1;
        continue;
      }

      // Past the name, a comma is a fallback and `)` is the end of the call. Anything else is text
      // this cannot read, and an unreadable call is not evidence of a missing name either way.
      let next = end;
      while (next < text.length && isSpace(text.charCodeAt(next))) next++;

      into.push({
        name: text.slice(start, end),
        at: part.at + start,
        length: end - start,
        fallback: text.charCodeAt(next) === 44 /* , */,
      });
      index = end - 1;
    }
  }
}

function endOfString(text: string, start: number): number {
  const quote = text.charCodeAt(start);
  let index = start + 1;
  while (index < text.length) {
    if (text.charCodeAt(index) === 92) {
      index += 2;
      continue;
    }
    if (text.charCodeAt(index) === quote) return index;
    index++;
  }
  return index;
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
const isWordCharacter = (code: number) =>
  (code >= 97 && code <= 122) ||
  (code >= 65 && code <= 90) ||
  (code >= 48 && code <= 57) ||
  code === 45 ||
  code === 95 ||
  code >= 128;
