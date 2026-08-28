import ts from "typescript";
import { propertyOnlyNames } from "@ramonda/dom-facts";
import { positionOf } from "../syntax";
import type { ElementRule, TextEdit } from "./rule";

/**
 * `playbackrate={2}` — a name one capital away from the only spelling it has.
 *
 * A few pieces of element state live in a PROPERTY and have no attribute of that name at all: an
 * `<input>`'s `indeterminate`, a media element's `volume`, `playbackRate` and `currentTime`. There
 * is no `playbackrate` content attribute for `playbackRate` to be the lowercase form OF, so the
 * name has exactly one spelling — the one the DOM gives it — and anything else is not that name.
 *
 * Core matches the table exactly for that reason — `keptInAProperty`, in the attribute writer —
 * and the consequence is silent: `playbackrate={2}` matches nothing, so it falls through the
 * property-only branch and is written as an ATTRIBUTE. The
 * document gets `playbackrate="2"`, nothing reads it, and the video plays at normal speed. Nothing
 * throws, nothing warns, and the line looks right.
 *
 * ## Why the types do not catch it
 *
 * `RamondaArgs` is a union, and one arm of it is `{ [val: Lowercase<string>]: any }` — the escape
 * hatch that lets any real lowercase HTML attribute through without enumerating them. `playbackRate`
 * typechecks because the element's DOM properties are another arm; `playbackrate` typechecks
 * because it is lowercase. Both are accepted and only one of them does anything.
 *
 * That is what makes this worth a rule rather than a note. It is not a name somebody invented — it
 * is the RIGHT name in the wrong case, written by somebody who reasonably expected HTML's usual
 * indifference to it, and the type system waves it through.
 *
 * ## Where the names come from
 *
 * `@ramonda/dom-facts`, through `propertyOnlyNames` — the same table `keptInAProperty` answers
 * from, so what this reports and what core does cannot come apart. The table's own note hands this half
 * over by name: core "writes the property instead; `@ramonda/check` will report the same names where
 * they are typed, which is the better place of the two".
 */
export interface MisspelledElementPropertyIssue {
  /** The tag it was written on. */
  tag: string;
  /** The name as WRITTEN, which is what the reader has to find on the line. */
  written: string;
  /** The one spelling that works. */
  meant: string;
  /** The rename, which has exactly one answer — see {@link TextEdit}. */
  edit?: TextEdit;
  file: string;
  line: number;
  column: number;
}

export const misspelledElementProperty = {
  id: "misspelled-element-property",

  report: {
    severity: "warn",
    reportedWhen:
      "a name is written in the wrong case for element state that lives only in a property, so it is written as an attribute nothing reads",
    heading: (found) => `${found.length} property name(s) written in a case the element does not have:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag} ${issue.written}={…}> — write \`${issue.meant}\`, which is the only spelling this state has.`,
    ],
    advice:
      "A few pieces of element state live in a PROPERTY and have no attribute of that name at all:\n" +
      "an `<input>`'s `indeterminate`, and a media element's `volume`, `playbackRate` and\n" +
      "`currentTime`. There is no lowercase content attribute for these to be the HTML spelling of,\n" +
      "so each has exactly one name and anything else is a different one.\n\n" +
      "Written in the wrong case it is not set at all. It goes into the document as an attribute\n" +
      "instead, nothing reads it, and the element keeps whatever it had:\n\n" +
      "```tsx\n" +
      "<video playbackRate={2} />   // sets the property\n" +
      '<video playbackrate={2} />   // writes playbackrate="2" and does nothing\n' +
      "```\n\n" +
      "The types accept both. `RamondaArgs` has an arm keyed on `Lowercase<string>` so that any real\n" +
      "lowercase HTML attribute passes without being enumerated, and the wrong spelling goes through\n" +
      "it — which is exactly why this is reported here instead.\n\n" +
      "None of this state survives a server render, whichever way it is spelled: there is nowhere in\n" +
      "markup to put it, so it is set when the page hydrates. That is HTML's limit rather than the\n" +
      "framework's.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * No order guard: this is a rule about what the author WROTE.
   *
   * A spread carrying the right spelling would set the property as well, and the misspelled name is
   * still on the line doing nothing — the same reasoning `class-instead-of-classname` takes, and
   * the opposite of `false-on-a-boolean-attribute`, which names an outcome a spread can change.
   */
  evenWhenSpreading: true,

  read(_element, { tag, attributes }) {
    if (tag === undefined) return [];

    // The table is keyed by `nodeName`, which HTML gives in upper case.
    const names = propertyOnlyNames(tag.toUpperCase());
    if (names === undefined) return [];

    const found: MisspelledElementPropertyIssue[] = [];

    for (const attribute of attributes) {
      // The right spelling is what core matches, and it needs nothing said about it.
      if (names.has(attribute.name)) continue;

      const meant = [...names].find((name) => name.toLowerCase() === attribute.name.toLowerCase());
      if (meant === undefined) continue;

      /**
       * The one answer there is: the name, in the only case it has.
       *
       * The span is the NAME node, not the attribute — `playbackrate={2}` keeps its value, and
       * replacing the whole attribute would mean re-printing an expression this never read.
       */
      const name = ts.isJsxAttribute(attribute.at) ? attribute.at.name : undefined;
      const edit =
        name === undefined
          ? undefined
          : {
              from: name.getStart(),
              to: name.getEnd(),
              text: meant,
              says: `\`${attribute.name}\` → \`${meant}\``,
            };

      found.push({ tag, written: attribute.name, meant, ...(edit ? { edit } : {}), ...positionOf(attribute.at) });
    }

    return found;
  },
} as const satisfies ElementRule<MisspelledElementPropertyIssue>;
