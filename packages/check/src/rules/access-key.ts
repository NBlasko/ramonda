import { positionOf } from "../syntax";
import type { ElementRule } from "./rule";

/**
 * `accessKey`, which takes a shortcut away from somebody who was already using it.
 *
 * The attribute asks the browser to bind a single character to this element. The problem is whose
 * character it is: the browser already has bindings for most letters, and so does every screen
 * reader — which is the population most likely to be using keyboard shortcuts in the first place.
 * One page's `accessKey="s"` overrides whatever that user's software does with `s`, on that page
 * only, with no way to discover it and no way to turn it off.
 *
 * It also cannot be got right, which is the part that makes this a rule rather than a preference.
 * The modifier differs by browser and by platform, the conflicts differ by screen reader, and
 * nothing announces the binding to anybody — so a page cannot even tell the reader the shortcut
 * exists. There is no spelling of this attribute that is safe on every reader's machine.
 */
export interface AccessKeyIssue {
  /** The tag it was written on. */
  tag: string;
  /** The character claimed, when it is written out — the whole point of the report. */
  claimed: string | undefined;
  file: string;
  line: number;
  column: number;
}

export const accessKey = {
  id: "access-key",

  report: {
    severity: "warn",
    reportedWhen: "an `accessKey` is written, which overrides a shortcut the reader's own software may be using",
    heading: (found) => `${found.length} element(s) claiming a keyboard shortcut with \`accessKey\`:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.tag}> claims ${
        issue.claimed === undefined ? "a shortcut" : `\`${issue.claimed}\``
      } — which the browser or a screen reader may already be using.`,
    ],
    advice:
      "`accessKey` binds a character to this element, and the character is not the page's to give.\n" +
      "Browsers already bind most letters, and so does every screen reader — the software of the\n" +
      "people most likely to be using keyboard shortcuts at all. One page's `accessKey` overrides\n" +
      "that binding, on that page only, with nothing to discover it by and no way to switch it off.\n\n" +
      "It cannot be got right either: the modifier differs by browser and platform, the conflicts\n" +
      "differ by screen reader, and nothing announces the binding — so the page cannot even tell\n" +
      "the reader the shortcut is there.\n\n" +
      "Where a shortcut really is wanted, own it: a key handler the page documents on screen, which\n" +
      "can be listed, chosen to avoid the common bindings, and turned off.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * Reported past a spread, from the side a spread cannot reach over.
   *
   * What is claimed is that this element TAKES a key combination off the user, which is a fact
   * about the rendered element rather than about a misspelling — so a later spread that removes
   * the attribute makes the claim untrue, and the guard is taken here.
   */
  evenWhenSpreading: true,

  read(_element, { tag, attr, has, overwritable, at }) {
    if (tag === undefined || !has("accessKey") || overwritable("accessKey")) return [];

    return [{ tag, claimed: attr("accessKey"), ...positionOf(at) }];
  },
} as const satisfies ElementRule<AccessKeyIssue>;
