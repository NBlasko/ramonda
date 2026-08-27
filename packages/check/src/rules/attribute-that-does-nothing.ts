import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementRule } from "./rule";

/**
 * An attribute that reaches the DOM verbatim and that nothing reads.
 *
 * An HTML attribute is written through `setAttribute`, which lowercases the name. Two names are
 * ALIASED on the way because they are reserved words — `className` becomes `class`, `htmlFor`
 * becomes `for` — and that is the whole of the exception list. Every other name is written as it
 * stands, so a camelCase name whose real attribute is spelled differently arrives as something no
 * browser has ever heard of.
 *
 * Measured, one render of every camelCase name a JSX author might reach for, reading back what
 * landed in the document: `httpEquiv` arrives as `httpequiv` while the attribute is `http-equiv`;
 * `acceptCharset` as `acceptcharset` against `accept-charset`; `defaultValue` and `defaultChecked`
 * mark a controlled/uncontrolled distinction this framework does not have, and have no attributes
 * at all; `innerHTML` and `textContent` are
 * properties rather than attributes. All six render, none does anything, and none is visible on the
 * page as being wrong.
 *
 * ## Why this exists when the types refuse all six
 *
 * `global.ts` now refuses each of them with the correct spelling written into the error, which is
 * the better place: it fires at the call site, before anything runs. This is the second net, for
 * the reasons the type is not the whole answer — a `@ts-ignore`, a base class loosened by a cast, a
 * JavaScript file. A type is a defence only while nobody casts it away, and an attribute that does
 * nothing is worth naming however somebody got there.
 *
 * ## TO ADD: two more, and one of them is a TAG rather than a name
 *
 * `selected` on an `<option>`. Not a dead name — `selected` is real HTML — but what it means depends
 * on the order the options reached their select, and no author writes that order. HTML keeps the
 * later of two claims and gives an unclaimed select the first option it holds, so the same markup
 * means different things depending on how the render that produced it was reached. `@ramonda/core`
 * refuses the plain `<select>` tag in `global.ts` (`RefusedSelectTag`, whose property NAME is the
 * message TypeScript prints) and points at `<Select value={x}>`, which settles the choice once the
 * options exist — but the option's own attribute is still writable, and this is where that would be
 * named.
 *
 * `indeterminate` on an `<input>`. Measured: the attribute is written into the markup, there is no
 * such content attribute in HTML at all, and `.indeterminate` stays `false`. The purest member of
 * the family — a name that does nothing, everywhere it appears — and the only one of the three that
 * needs no tag to decide it.
 *
 * The wrinkle the other six do not have is the tag: they are dead wherever they appear, and these
 * are wrong only in one place. The issue shape already carries `tag`.
 */
export interface AttributeThatDoesNothingIssue {
  /** The tag it was written on. */
  tag: string;
  /** The attribute as written, which is what the reader has to find on the line. */
  attribute: string;
  /** What to write instead, in the words the report prints. */
  instead: string;
  file: string;
  line: number;
  column: number;
}

/**
 * The dead names, lowercased, and what each one should have been.
 *
 * Keyed lowercase because the fault does not depend on the capitals: `httpequiv` written in full
 * lowercase is exactly as dead as `httpEquiv`, and it passes the types, since a lowercase name goes
 * through the index signature rather than through any DOM property.
 */
const DEAD: ReadonlyMap<string, string> = new Map([
  ["httpequiv", "write `http-equiv`, which is how HTML spells it"],
  ["acceptcharset", "write `accept-charset`, which is how HTML spells it"],
  [
    "defaultvalue",
    "write `value` — the attribute IS the initial value, and there is no controlled/uncontrolled pair here",
  ],
  ["defaultchecked", "write `checked` — the attribute IS the initial state"],
  ["innerhtml", "put the markup in the element's children, which is what Ramonda renders"],
  ["textcontent", "put the text in the element's children"],
]);

export const attributeThatDoesNothing = {
  id: "attribute-that-does-nothing",

  report: {
    severity: "warn",
    reportedWhen: "an attribute is written whose name reaches the DOM verbatim and that nothing reads",
    heading: (found) => `${found.length} attribute(s) that reach the DOM and do nothing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.attribute}={…}> is written as it stands, so the document gets ` +
        `\`${issue.attribute.toLowerCase()}\` — ${issue.instead}.`,
    ],
    advice:
      "An HTML attribute is written through `setAttribute`, which lowercases the name. Exactly two\n" +
      "names are aliased on the way, because they are reserved words: `className` becomes `class`\n" +
      "and `htmlFor` becomes `for`. Everything else is written as it stands.\n\n" +
      "So a camelCase name whose real attribute is spelled differently arrives as something no\n" +
      "browser has heard of. It renders, it does nothing, and there is nothing on the page to see.\n\n" +
      "The types refuse all of these at the call site, with the right spelling in the error — so\n" +
      "reaching this report means a `@ts-ignore`, a cast, or a file with no types at all.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(element, { tag }) {
    if (tag === undefined) return [];

    const found: AttributeThatDoesNothingIssue[] = [];

    for (const attribute of openingOf(element).attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const written = attribute.name.getText();
      const instead = DEAD.get(written.toLowerCase());
      if (instead === undefined) continue;

      found.push({ tag, attribute: written, instead, ...positionOf(attribute) });
    }

    return found;
  },
} as const satisfies ElementRule<AttributeThatDoesNothingIssue>;
