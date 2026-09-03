import { couldExist } from "./idTable";
import type { ProjectRule } from "./rule";

/**
 * `<a href="#pricing">` where nothing in the project carries `id="pricing"`.
 *
 * A fragment link is the one link a browser answers without asking a server, so it fails without
 * any of the signals a broken link usually gives: no 404, no network error, no console line. The
 * page simply does not move. A reader clicks "Skip to content" or an entry in a table of contents,
 * nothing happens, and there is nothing to tell them why.
 *
 * It is worth naming who this hurts most, because it is not everybody equally: a skip link is the
 * first thing a keyboard reader uses on a page, and it is the one nobody testing with a mouse ever
 * presses.
 *
 * ## Why this needs the project rather than one render
 *
 * The two halves are almost never written together. The link is in a navigation bar; the heading it
 * points at is in a page component three files away. That pairing is the whole reason this family
 * exists — no per-render subject can see both ends of it.
 */
export interface FragmentLinkToNowhereIssue {
  /** The id the link points at, without the `#`. */
  target: string;
  file: string;
  line: number;
  column: number;
}

export const fragmentLinkToNowhere = {
  id: "fragment-link-to-nowhere",

  report: {
    severity: "error",
    reportedWhen: 'an `href="#name"` points at an id no element in the project carries',
    heading: (found) => `${found.length} fragment link(s) pointing at nothing:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <a href="#${issue.target}"> — nothing in the project carries \`id="${issue.target}"\`.`,
    ],
    advice:
      "A fragment link is answered by the browser rather than by a server, so a broken one fails\n" +
      "with none of the usual signals: no 404, no network error, nothing in the console. The page\n" +
      "just does not move, and the reader is given no reason.\n\n" +
      "Give the target its `id`, or correct the link. Where the target is built rather than written\n" +
      "— a heading id generated from markdown, say — write the id out in the markup instead, or\n" +
      "this cannot see it.\n\n" +
      "The people this costs most are the ones least likely to be in the room when it is tested: a\n" +
      "skip link is the first thing a keyboard reader uses on a page, and the one nobody testing\n" +
      "with a mouse ever presses.\n\n",
  },

  read(project) {
    // An id this could not read means the project builds ids at runtime, and "defined nowhere"
    // stops being provable. See `ProjectContext.unreadable`.
    if (project.unreadable.length > 0) return [];

    return project.references
      .filter((reference) => reference.attribute.toLowerCase() === "href" && !couldExist(reference.target, project))
      .map(({ target, file, line, column }) => ({ target, file, line, column }));
  },
} as const satisfies ProjectRule<FragmentLinkToNowhereIssue>;
