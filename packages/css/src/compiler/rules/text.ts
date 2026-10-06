/** Rules over a block's raw text, before it is read: a missing `;`, a `//` comment, a call left open. */

import { type Declaration } from "../ast";
import { type Block, type BlockItem } from "./shared";
import { type Finding } from "./index";

/**
 * A declaration with no `;` after it, which CSS allows for the last one in a block.
 *
 * **This package does not, and the reason is what happens NEXT.** A declaration without its
 * semicolon swallows whatever is written under it — that is `run-on-declaration`, and it reports the
 * line somebody adds rather than the line that was already wrong. So a block that is legal today
 * makes a stranger's next edit report a fault they did not write:
 *
 *     padding: 8px          legal, and silent
 *     padding: 8px          somebody adds a line
 *     color: red            run-on-declaration, on THEIR line
 *
 * Reported by a user, who wrote the first shape and asked for it to be refused.
 *
 * Every other declaration needs one and the formatter writes one, so requiring it costs nobody a
 * keystroke they were not already making. A nested rule's last declaration is included: it is the
 * same shape and the same next edit.
 */
export function missingSemicolon(block: Block, findings: Finding[]): void {
  /**
   * **Quiet wherever another rule has already spoken about this declaration.**
   *
   * A declaration with no `;` is usually a declaration, and sometimes it is wreckage: a run-on that
   * swallowed the next line, a hole standing where a property name goes, a string that was never
   * closed and ate the rest of the block. Each of those has a rule that explains it, and each leaves
   * a declaration with no terminator behind — so this spoke second, about a shape somebody is
   * already being told is wrong.
   *
   * Listing the shapes was the first attempt and it kept finding another one. Asking whether
   * anything has been said about the same span is the question that was actually being asked, and it
   * is the same one `inOrder` asks of TypeScript's diagnostics for exactly this reason.
   */
  const spoken = (item: Declaration): boolean =>
    item.at !== undefined &&
    item.end !== undefined &&
    findings.some((one) => one.at >= item.at! && one.at <= item.end!);

  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walkItems(item.items);
        continue;
      }
      if (item.terminated === true || item.end === undefined) continue;
      // A spread is its own shape and has its own rules; it is not a declaration missing anything.
      if (item.property.startsWith("...")) continue;
      /**
       * A property name holding a BRACE is wreckage, whatever recovered from it.
       *
       * A name is an identifier, so a `{` or `}` in one means the parser rebuilt something from a
       * shape nobody wrote — a hole standing where a property goes, the body a broken selector left
       * behind. The rule that explains it reports at its own position, which is not always inside
       * this declaration's span, so `spoken` alone does not see it.
       */
      if (item.property.includes("{") || item.property.includes("}")) continue;

      /**
       * A declaration with NO VALUE yet, which is the state an editor is in most.
       *
       * `padding: ` while it is being typed has no value and no `;`, and saying so on every
       * keystroke is noise. The strict read refuses a valueless declaration outright, so nothing
       * reaches a build this way — and in the tolerant read it is also what the wreckage of a
       * malformed selector looks like, which another rule explains.
       */
      if (item.value.length === 0) continue;

      if (spoken(item)) continue;

      findings.push({
        rule: "missing-semicolon",
        at: item.end,
        length: 0,
        message:
          `this declaration has no \`;\`. CSS lets the last one in a block go without, and this does not:` +
          `\n\n        a declaration with no \`;\` swallows whatever is written under it next, so the` +
          `\n        line somebody adds tomorrow is the one that gets reported.`,
      });
    }
  };

  walkItems(block.items);
}

/* ── the rules ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Two declarations run together, which is what a missing `;` makes of them.
 *
 * **Nothing else reports it, and that had to be measured.** `padding: 4px 0 border-left: 1px solid
 * red` is one value to the parser, and `padding` is not among the 123 properties whose values are a
 * closed union — so the type layer has no grounds and `unknown-value` has nothing to check against.
 * The browser drops both declarations and the page renders without the style, silently, which is the
 * whole reason this exists.
 *
 * **A colon inside a value is the tell.** CSS values do not contain bare colons; the three places one
 * legitimately appears — inside a string, inside `url( … )`, inside any other function — are exactly
 * where this does not look. A hole is skipped too: what is inside one is TypeScript, and a colon
 * there is a type annotation or a conditional.
 */
export function runOn(declaration: Declaration, findings: Finding[]): void {
  for (const part of declaration.value) {
    if (part.kind !== "text" || part.at === undefined) continue;

    const at = bareColon(part.text);
    if (at === -1) continue;

    /** The name the colon belongs to, which is the declaration that was swallowed. */
    let start = at;
    while (start > 0 && isNameCharacter(part.text.charCodeAt(start - 1))) start--;
    const name = part.text.slice(start, at);
    if (name === "") continue;

    findings.push({
      rule: "run-on-declaration",
      at: part.at + start,
      length: name.length,
      message:
        `\`${name}\` is being read as part of \`${declaration.property}\`'s value — ` +
        `the declaration before it has no \`;\`, so the browser drops both.`,
    });
    return;
  }
}

/** The first colon that is not inside a string or a function, or -1. */
export function bareColon(text: string): number {
  let depth = 0;
  let quote = 0;

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);

    if (quote !== 0) {
      if (code === 92 /* \ */) index++;
      else if (code === quote) quote = 0;
      continue;
    }

    if (code === 34 /* " */ || code === 39 /* ' */) quote = code;
    else if (code === 40 /* ( */) depth++;
    else if (code === 41 /* ) */) depth = Math.max(0, depth - 1);
    else if (code === 58 /* : */ && depth === 0) return index;
  }

  return -1;
}

/** A CSS property name's characters, which is what stands before the colon that gave it away. */
function isNameCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 95
  );
}

/**
 * A `(` in a value that no `)` closes, named where it opens.
 *
 * ## The fault this answers, and why it was parked
 *
 * `content: url(;` is a missing `)`, and what the author was told had nothing to do with it. The
 * value scanner counts parens and a block's own closer is a `)` like any other, so the value ran
 * past `)}` into the author's own code:
 *
 *     content: url(;      →  `const d = (1 + 2)` is not a declaration
 *                            reported on line 4, for a mistake on line 2
 *
 * The note that parked this said the parens are BALANCED so no cheap check exists. True of the
 * block, false of the DECLARATION: inside one, `url(` is short a `)` and counting says so.
 *
 * ## What the count has to skip
 *
 * A string, and that is not a detail — measured, a naive count called `url("a)b.png"` balanced and
 * `url("a(b.png")` unclosed, both backwards. `endOfString` is what the other value rules already
 * use, so there is one answer to *where does this string end* rather than two.
 *
 * ## Why the last unclosed one is named
 *
 * `calc(min(1px, 2px` is short two, and the author's fix starts at the innermost — a `)` typed at
 * the end closes `min` first. So the position reported is the last `(` still open, which is the one
 * their cursor wants.
 */
export function unclosedCall(block: Block, findings: Finding[]): void {
  const walkItems = (items: readonly BlockItem[]): void => {
    for (const item of items) {
      if (item.kind === "rule") {
        walkItems(item.items);
        continue;
      }

      /** Every `(` still open at the end of the value, innermost last. */
      const open: { at: number; name: string }[] = [];
      for (const part of item.value) {
        if (part.kind !== "text" || part.at === undefined) continue;
        /**
         * Only as far as the `;`, because the value has ALREADY swallowed the block's closer.
         *
         * That is the fault itself, seen from inside: `content: url(;` comes back as the single
         * value `url(;\n)}>x</div>`, so a count over the whole part meets the block's own `)` and
         * calls it balanced. The declaration ends at its `;` whatever the scanner did with the rest,
         * and everything past that belongs to somebody else.
         */
        const text = part.text.slice(0, terminator(part.text));
        for (let index = 0; index < text.length; index++) {
          const code = text.charCodeAt(index);
          if (code === 34 || code === 39) {
            index = endOfString(text, index);
            continue;
          }
          if (code === 40) {
            let from = index;
            while (from > 0 && /[\w-]/.test(text[from - 1] ?? "")) from--;
            open.push({ at: part.at + from, name: `${text.slice(from, index)}(` });
          } else if (code === 41) {
            open.pop();
          }
        }
      }

      const last = open.at(-1);
      if (last === undefined) continue;

      findings.push({
        rule: "unclosed-call",
        at: last.at,
        length: last.name.length,
        message:
          `\`${last.name}\` is never closed — it needs a \`)\`.\n\n        Until it is, the value runs ` +
          `past the end of the block, and what gets reported is\n        whatever your own code says ` +
          `after it.`,
      });
    }
  };

  walkItems(block.items);
}

/**
 * Where a declaration's own `;` is, skipping one inside a string — or the end of the text.
 *
 * Its own walk rather than `indexOf(";")`, and that is measured: `content: url("a)b.png";` has a
 * `;` only after the quote, and `content: "a;b";` has one inside it. Cutting at the first `;` read
 * the second as a two-character value and called its parens balanced by accident.
 */
export function terminator(text: string): number {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index);
      continue;
    }
    if (code === 59 /* ; */) return index;
  }
  return text.length;
}

export function endOfString(text: string, start: number): number {
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

export function endOfCall(text: string, open: number): number {
  let index = open + 1;
  let depth = 1;
  while (index < text.length && depth > 0) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = endOfString(text, index);
    } else if (code === 40) depth++;
    else if (code === 41) depth--;
    index++;
  }
  return index - 1;
}
