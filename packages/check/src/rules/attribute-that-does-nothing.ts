import ts from "typescript";
import { positionOf } from "../syntax";
import type { ElementRule, TextEdit } from "./rule";

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
 * ## TO ADD: what is left, and one of them is a TAG rather than a name
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
 * ~~`indeterminate` on an `<input>`.~~ **Withdrawn — core fixed it.** This note used to say the
 * attribute is written into the markup and `.indeterminate` stays `false`, and that was measured
 * and true when it was written. It is not true now: the attribute writer declines to write a name
 * HTML does not give the element and sets the PROPERTY instead, asking `keptInAProperty` against
 * the `ABSENT` table in `@ramonda/dom-facts`. So `indeterminate={true}` is the supported way to put a checkbox in its
 * third state, and a rule reporting it would report correct code.
 *
 * What is left here is the other half, and dom-facts hands it over by name: a property-only name
 * MISSPELLED. There is no `playbackrate` content attribute for `playbackRate` to be the lowercase
 * form of, so the table is matched exactly — and `playbackrate={2}` matches nothing, writes
 * nothing, and is the spelling the types encourage. Core drops it silently because it has nowhere
 * to say so; this package can report it at the line that wrote it. `keptInAProperty(tag, name)` is
 * the reader, and it is exported for this.
 *
 * And the static twin of RMD029: `disabled="false"` written as a literal, which turns the control ON
 * because a boolean attribute is true whenever it is PRESENT. `@ramonda/core` reports that while it
 * runs; reading it off the source needs the same list of names, and that list already sits in
 * `@ramonda/dom-facts` as `BOOLEAN_ATTRIBUTES` — put there rather than kept in `core` precisely so
 * this rule does not begin by making a second copy of it.
 *
 * `ElementContext`'s `truth` already reads it, for the other half of the same fact: asked about
 * `required="false"` it answers TRUE, because presence is what decides a boolean attribute. So the
 * rule above has the meaning settled for it and is left with the part only it can say — that the
 * line reads as the opposite of what it does.
 *
 * The wrinkle the other six do not have is the tag: they are dead wherever they appear, and these
 * are wrong only in one place. The issue shape already carries `tag`.
 *
 * `selected` on an `<option>` sits inside a `<select>`, and `<select>`/`<textarea>` belong to
 * another session — check with whoever owns `Select` and `TextArea` before writing a rule about
 * what goes inside them.
 */
export interface AttributeThatDoesNothingIssue {
  /** The tag it was written on. */
  tag: string;
  /** The attribute as written, which is what the reader has to find on the line. */
  attribute: string;
  /** What to write instead, in the words the report prints. */
  instead: string;
  /** The rename, for the four whose answer is a name — see {@link TextEdit}. */
  edit?: TextEdit;
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
/**
 * What to write instead, and — where there IS one — the name to write.
 *
 * `instead` is the sentence a reader gets. `rename` is the same answer as a bare name, for `--fix`,
 * and it is absent for the two whose answer is not a name at all: "put the markup in the element's
 * children" is a change of shape, and no span in this file is the new one.
 *
 * Two fields rather than parsing the name back out of the prose, because a sentence is written for
 * a person and would quietly stop parsing the day somebody improved it.
 */
const DEAD: ReadonlyMap<string, { instead: string; rename?: string }> = new Map([
  ["httpequiv", { instead: "write `http-equiv`, which is how HTML spells it", rename: "http-equiv" }],
  ["acceptcharset", { instead: "write `accept-charset`, which is how HTML spells it", rename: "accept-charset" }],
  [
    "defaultvalue",
    {
      instead: "write `value` — the attribute IS the initial value, and there is no controlled/uncontrolled pair here",
      rename: "value",
    },
  ],
  ["defaultchecked", { instead: "write `checked` — the attribute IS the initial state", rename: "checked" }],
  ["innerhtml", { instead: "put the markup in the element's children, which is what Ramonda renders" }],
  ["textcontent", { instead: "put the text in the element's children" }],
]);

export const attributeThatDoesNothing = {
  id: "attribute-that-does-nothing",

  report: {
    severity: "error",
    reportedWhen:
      "one of six camelCase names — `httpEquiv`, `acceptCharset`, `defaultValue`, `defaultChecked`, " +
      "`innerHTML`, `textContent` — reaches the DOM as itself, where no browser reads it",
    heading: (found) => `${found.length} attribute(s) that reach the DOM and do nothing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.attribute}={…}> is written as it stands, so the document gets \`${issue.attribute.toLowerCase()}\` — ${issue.instead}.`,
    ],
    advice:
      "An HTML attribute is written through `setAttribute`, which lowercases the name. Exactly two\n" +
      "names are aliased on the way, because they are reserved words: `className` becomes `class`\n" +
      "and `htmlFor` becomes `for`. Everything else is written as it stands.\n\n" +
      "So a camelCase name whose real attribute is spelled differently arrives as something no\n" +
      "browser has heard of. It renders, it does nothing, and there is nothing on the page to see.\n\n" +
      "The types refuse all of these at the call site, with the right spelling in the error — so\n" +
      "reaching this report means a `@ts-ignore`, a cast, or a file with no types at all.\n\n" +
      "**It is six names and nothing else.** An attribute nothing in the framework reads is not a\n" +
      "fault: a `data-*` written for a CSS selector or a test hook is exactly what `data-*` is for,\n" +
      "and this never reports one. What is reported is a name that was MEANT to do something and\n" +
      "cannot, because HTML spells it differently.\n\n",
  },

  /**
   * No order guard, for the same reason `class-instead-of-classname` needs none: the name is in the
   * source whether or not a later spread takes the attribute off the DOM, and the attribute the
   * author meant is missing either way.
   */
  evenWhenSpreading: true,

  read(_element, { tag, attributes }) {
    // A component tag decides its own props, so what it does with them is not settled here.
    if (tag === undefined) return [];

    const found: AttributeThatDoesNothingIssue[] = [];

    for (const attribute of attributes) {
      const written = attribute.name;
      const dead = DEAD.get(written.toLowerCase());
      if (dead === undefined) continue;

      /**
       * Four of the six have a name to write instead, and those are carried.
       *
       * `innerHTML` and `textContent` do not: their answer is "put it in the children", which is a
       * change of shape rather than a span. A machine that turned `innerHTML={markup}` into
       * children would be writing JSX out of a string it never read.
       */
      const name = ts.isJsxAttribute(attribute.at) ? attribute.at.name : undefined;
      const edit =
        dead.rename === undefined || name === undefined
          ? undefined
          : {
              from: name.getStart(),
              to: name.getEnd(),
              text: dead.rename,
              says: `\`${written}\` → \`${dead.rename}\``,
            };

      found.push({
        tag,
        attribute: written,
        instead: dead.instead,
        ...(edit ? { edit } : {}),
        ...positionOf(attribute.at),
      });
    }

    return found;
  },
} as const satisfies ElementRule<AttributeThatDoesNothingIssue>;
