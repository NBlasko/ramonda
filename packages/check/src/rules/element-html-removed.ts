import { positionOf } from "../syntax";
import type { ElementRule } from "./rule";

/**
 * A tag HTML removed — still rendered by every browser, and no longer anything.
 *
 * These are not typos. Each was a real element once, each still parses, and most still paint
 * something on the screen — which is exactly why they survive in a codebase: nothing breaks, so
 * nothing draws attention to them. What they no longer have is a specification saying what they
 * mean, so an accessibility tree has nothing to map them to and a future browser owes them nothing.
 *
 * ## Two of them are worse than obsolete
 *
 * `<marquee>` and `<blink>` MOVE, and moving content that cannot be paused is a failure of WCAG
 * 2.2.2 outright. A reader who needs time on a line cannot get it, and for some it is a vestibular
 * trigger. Those two are the reason this rule pays for itself even though the rest is tidying.
 *
 * ## Why a table rather than "not in the element list"
 *
 * Because a name nobody has heard of is a different fault with different advice —
 * `attribute-that-does-nothing`'s territory for names, and a custom element is legitimate whenever
 * it has a dash in it. These are names that WERE right, so the advice is a replacement rather than
 * a correction, and only a table can carry that.
 */
export interface ElementHtmlRemovedIssue {
  /** The tag as written, lowercased. */
  tag: string;
  /** What to write instead, in the words the report prints. */
  instead: string;
  /** Whether it also moves, which is a failure in its own right rather than a tidying job. */
  moves: boolean;
  file: string;
  line: number;
  column: number;
}

/**
 * The obsolete elements, each with what replaced it.
 *
 * Source: the **HTML Living Standard**'s own list of non-conforming features, filtered to elements
 * a person might still type. `<isindex>`, `<nextid>` and `<plaintext>` are left out — nobody is
 * writing those into a new component, and a table nothing consults is a table that drifts.
 *
 * Leans SHORT, like every table this package reports FROM: a name too many here is a report against
 * markup that is fine.
 */
const REMOVED: ReadonlyMap<string, string> = new Map([
  ["marquee", "put the movement in CSS, where a reader can stop it — and honour `prefers-reduced-motion`"],
  ["blink", "if it must draw the eye, do it with colour and weight rather than motion"],
  ["center", "centre it in CSS — `text-align` or a flex container"],
  ["font", "style it in CSS; the attributes here reach nothing"],
  ["big", "use CSS `font-size`, or a heading if it is one"],
  ["strike", "`<s>` for something no longer accurate, or `<del>` for something removed from a document"],
  ["tt", "`<code>` for code, `<kbd>` for keys, or CSS `font-family` for the look alone"],
  ["acronym", "`<abbr>`, which is what it became and what a screen reader announces"],
  ["applet", "`<object>`, or the element for whatever the content really is"],
  ["dir", "`<ul>`, which is what a list of names is"],
  ["frame", "the page's own layout — frames are gone from the standard"],
  ["frameset", "the page's own layout — frames are gone from the standard"],
  ["noframes", "nothing: there are no frames left for it to be the fallback of"],
  ["basefont", "set the base font in CSS on `:root` or `body`"],
  ["nobr", "CSS `white-space: nowrap`"],
  ["spacer", "margin or padding in CSS"],
  ["bgsound", "`<audio>`, with controls a reader can reach"],
]);

/** The two that move, which is a WCAG failure rather than a tidying job. */
const MOVES: ReadonlySet<string> = new Set(["marquee", "blink"]);

export const elementHtmlRemoved = {
  id: "element-html-removed",

  report: {
    severity: "warn",
    reportedWhen: "a tag HTML has removed is written, so nothing defines what it means",
    heading: (found) => `${found.length} tag(s) HTML no longer has:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.moves
        ? `    <${issue.tag}> moves, and moving content that cannot be paused fails WCAG 2.2.2 — ${issue.instead}.`
        : `    <${issue.tag}> was removed from HTML — ${issue.instead}.`,
    ],
    advice:
      "These still parse and most still paint something, which is why they survive: nothing breaks,\n" +
      "so nothing draws attention to them. What they no longer have is a specification saying what\n" +
      "they MEAN — so the accessibility tree has nothing to map them to, and a future browser owes\n" +
      "them nothing.\n\n" +
      "`<marquee>` and `<blink>` are worse than obsolete. Moving content that cannot be paused is a\n" +
      "failure of WCAG 2.2.2 on its own: a reader who needs time on a line cannot get it, and for\n" +
      "some people motion is a vestibular trigger. If something must move, it belongs in CSS, where\n" +
      "it can be stopped and where `prefers-reduced-motion` is honoured:\n\n" +
      "```css\n" +
      "@media (prefers-reduced-motion: reduce) {\n" +
      "  .ticker { animation: none; }\n" +
      "}\n" +
      "```\n\n" +
      "A name nobody has ever heard of is a different report. This one is for names that WERE right,\n" +
      "so each has a replacement rather than a correction.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * The subject is the TAG, and no spread changes a tag.
   *
   * Nothing written on the element can make `<marquee>` into something HTML still has, so the
   * family's spread guard has nothing to protect here.
   */
  evenWhenSpreading: true,

  read(_element, { tag, at }) {
    if (tag === undefined) return [];

    const instead = REMOVED.get(tag);
    if (instead === undefined) return [];

    return [{ tag, instead, moves: MOVES.has(tag), ...positionOf(at) }];
  },
} as const satisfies ElementRule<ElementHtmlRemovedIssue>;
