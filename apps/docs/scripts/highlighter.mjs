import { readFileSync } from "node:fs";
import { bundledThemes, createHighlighter } from "shiki";

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
    readFileSync(new URL(`../../../tools/vscode-css/grammar/${name}.tmLanguage.json`, import.meta.url), "utf8"),
  );

/**
 * The two grammars an editor gets are the two the site gets.
 *
 * A `css=@@( … )` block is not TypeScript, so the tsx grammar cannot tokenise it — measured, a fence
 * holding one came back with the theme's INVALID colour, and so did every line BELOW it, to the end
 * of the fence. The same injections that colour it in the editor colour it here, which is also the
 * only way the two can agree.
 */
/**
 * A GitHub theme, with a length's unit given its number's colour.
 *
 * The GitHub themes colour `keyword.other.unit` as a keyword, so `4px` read as a blue `4` and a red
 * `px` — on this site only, since the editor's own themes give a length one colour. The theme keeps
 * its name, so every call site and the CSS variables it emits are unchanged.
 */
async function withUnitsAsNumbers(name) {
  const theme = structuredClone((await bundledThemes[name]()).default);
  const numeric = theme.tokenColors.find((rule) =>
    [rule.scope].flat().some((scope) => scope === "constant.numeric" || scope === "constant"),
  );
  if (numeric?.settings?.foreground === undefined) throw new Error(`${name}: no colour for a number`);
  theme.tokenColors.push({ scope: "keyword.other.unit", settings: { foreground: numeric.settings.foreground } });
  return theme;
}

export const highlighter = await createHighlighter({
  themes: [await withUnitsAsNumbers("github-light"), await withUnitsAsNumbers("github-dark")],
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
    /**
     * A block written OUTSIDE a tag, and a `$` path — the two the site was missing.
     *
     * `ramonda-css` injects into `meta.tag`, so it colours `css={@@( … )}` and nothing else. A
     * `const panel = @@( … )` is not in a tag and `@@keyframes( … )` never is, so both came out as
     * TypeScript trying to read a parameter list: `color` as `variable.parameter.tsx`, the `:` as a
     * type annotation. Those are the two spellings the pages teach most.
     *
     * The list is now the extension's own, and `grammar.test.ts` holds it to that — an editor and
     * this site colouring one block differently is a difference a reader cannot resolve.
     */
    { ...grammar("ramonda-css-value"), name: "ramonda-css-value", injectTo: ["source.tsx", "source.ts"] },
    {
      ...grammar("ramonda-css-variable"),
      name: "ramonda-css-variable",
      injectTo: ["source.tsx", "source.ts", "source.css"],
    },
  ],
});
