import { readFileSync } from "node:fs";
import { createHighlighter } from "shiki";

/**
 * The site's syntax highlighter, kept apart from the content build so it can be measured.
 *
 * ## Why the themes are BOTH emitted
 *
 * `defaultColor: false` at the call site emits both themes as CSS variables on every token, so the
 * page follows the reader's light/dark preference with no second render and no JavaScript. The cost
 * is a slightly larger HTML payload, paid once at build.
 */

const grammar = (name) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/css/vscode/grammar/${name}.tmLanguage.json`, import.meta.url), "utf8"),
  );

/**
 * The two grammars an editor gets are the two the site gets.
 *
 * A `css=@( … )` block is not TypeScript, so the tsx grammar cannot tokenise it — measured, a fence
 * holding one came back with the theme's INVALID colour, and so did every line BELOW it, to the end
 * of the fence. The same injections that colour it in the editor colour it here, which is also the
 * only way the two can agree.
 */
export const highlighter = await createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: [
    "tsx",
    "ts",
    "js",
    "json",
    "css",
    "html",
    "bash",
    "markdown",
    { ...grammar("ramonda-css"), name: "ramonda-css", injectTo: ["source.tsx", "source.ts"] },
    // Into `source.css` as well: a hole sits inside a declaration's value, where the CSS grammar is
    // the one tokenising by then.
    {
      ...grammar("ramonda-css-hole"),
      name: "ramonda-css-hole",
      injectTo: ["source.tsx", "source.ts", "source.css"],
    },
  ],
});
