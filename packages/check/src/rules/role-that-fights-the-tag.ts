import { positionOf } from "../syntax";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A `role` that tells a reader the element behaves in a way it does not.
 *
 * `<a href="/pricing" role="button">` and `<button role="link">` are the two, and they are opposite
 * halves of one mistake: the element KEEPS its behaviour and changes only what is announced about
 * it. So the reader is told what to expect and the element does something else.
 *
 * ## What the reader actually loses, which is different in each direction
 *
 * **A link announced as a button.** A button activates on Space as well as Enter, and a reader who
 * has been told "button" will press Space — on a link that is the browser's scroll shortcut, so the
 * page jumps down and nothing else happens. They also lose it from the list of LINKS a screen
 * reader offers, which is how somebody surveys what a page connects to, and they lose the
 * expectation that it goes anywhere at all.
 *
 * **A button announced as a link.** Now the reader expects a destination: a URL in the status bar,
 * a middle click that opens a tab, "copy link address" in the context menu. None of those exist,
 * and none of them fail loudly — the menu item is simply absent or copies nothing.
 *
 * Both are invisible to anybody using a mouse, and both survive review because the page looks and
 * behaves exactly as intended for the person testing it.
 *
 * ## Why the answer is never the role
 *
 * If it should be a button, use a `<button>`; if it should go somewhere, use an `<a href>`. The
 * element carries the behaviour and the role only describes it, so writing a role that disagrees
 * cannot bring the behaviour with it — which is what makes this a fault rather than a shortcut.
 *
 * ## Where it stays quiet
 *
 * An `<a>` with no `href`, or with `href="#"`, is not a link at all — `link-without-a-destination`
 * has that, and `role="button"` on one is somebody building a button out of an anchor, which is a
 * different conversation from this one. Only an anchor with a real destination is reported.
 *
 * An `href` this cannot READ goes quiet with them, and the first draft of this rule said the
 * opposite — that writing `href={where}` means the author has a destination. Planted, it does not
 * hold: `where` may perfectly well be `"#"`, which is the button-out-of-an-anchor case, and a rule
 * that guessed would report it. The silence contract wins, as it does everywhere else here.
 */
export interface RoleThatFightsTheTagIssue {
  /** The element it was written on. */
  tag: string;
  /** The role that was written. */
  role: string;
  /** Which direction the mismatch runs, so the report can say what the reader loses. */
  loses: "space" | "destination";
  file: string;
  line: number;
  column: number;
}

export const roleThatFightsTheTag = {
  id: "role-that-fights-the-tag",

  report: {
    severity: "warn",
    reportedWhen:
      "a `role` says the element behaves in a way the tag does not — a link as a button, or a button as a link",
    heading: (found) => `${found.length} element(s) announced as something they do not behave like:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      issue.loses === "space"
        ? `    <a href=… role="button"> is announced as a button, but Space scrolls the page instead of activating it.`
        : `    <button role="link"> is announced as a link, but it goes nowhere and has no address to copy.`,
    ],
    advice:
      "The element keeps its behaviour and the role changes only what is ANNOUNCED about it, so a\n" +
      "role that disagrees cannot bring the behaviour with it.\n\n" +
      "A link announced as a button: a button activates on Space as well as Enter, and a reader told\n" +
      '"button" will press Space — which on a link is the browser\'s scroll shortcut, so the page\n' +
      "jumps and nothing happens. It also leaves the list of LINKS a screen reader offers, which is\n" +
      "how somebody surveys what a page connects to.\n\n" +
      "A button announced as a link: the reader now expects a destination — a URL in the status bar,\n" +
      'a middle click that opens a tab, "copy link address". None of those exist, and none fail\n' +
      "loudly.\n\n" +
      "The answer is never the role. If it should be a button, use a `<button>`; if it should go\n" +
      "somewhere, use an `<a href>`. Both arrive announced correctly, focusable, and with the right\n" +
      "keys already working.\n\n" +
      "An `<a>` with no `href` is not a link at all and is not this — that is\n" +
      "`link-without-a-destination`, and building a button out of an anchor is a different\n" +
      "conversation.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  /**
   * A `@Host` props bag configures a real element, and a role written there announces as loudly.
   *
   * The role is read as a VALUE, so the order guard is taken for it — a spread after it may replace
   * it with one that agrees.
   */
  evenWhenSpreading: true,

  read(_element, { tag, attr, overwritable, at }: ElementContext) {
    if (tag !== "a" && tag !== "button") return [];

    const role = attr("role")?.trim().toLowerCase();
    if (role === undefined) return [];
    // A chain is a list of alternatives, and which one the browser takes is not asked here.
    if (role.includes(" ")) return [];
    if (overwritable("role")) return [];

    if (tag === "button" && role === "link") {
      return [{ tag, role, loses: "destination" as const, ...positionOf(at) }];
    }

    if (tag === "a" && role === "button") {
      // An anchor with no real destination is not a link, and `role="button"` on one is somebody
      // building a button out of it — a different conversation, and `link-without-a-destination`'s.
      // A destination this cannot read may be `"#"`, which is the other conversation entirely.
      const href = attr("href")?.trim();
      if (href === undefined || href === "" || href === "#") return [];
      return [{ tag, role, loses: "space" as const, ...positionOf(at) }];
    }

    return [];
  },
} as const satisfies ElementRule<RoleThatFightsTheTagIssue>;
