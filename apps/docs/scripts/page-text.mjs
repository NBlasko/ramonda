import { installCommands } from "./install-commands.mjs";

/**
 * The site as a coding agent reads it: every page as plain Markdown, an index, and the whole site in
 * one file.
 *
 * Found by an agent that built an app from these docs alone. It read them by fetching the HTML, and
 * the HTML is a prerendered app: navigation, highlighting spans, and the script bundles, which an
 * agent told to learn from the docs alone must not read. The Markdown is the same text the pages are
 * rendered from, so it cannot say something the page does not.
 *
 * What changes on the way from the source:
 *
 * - a `demo:` fence is dropped — it is a live component on the page, and has no text;
 * - an `install` fence becomes the npm commands, the first tab the page shows;
 * - a link to a page of this site goes to that page's Markdown, absolute, so an agent that follows
 *   it stays in Markdown, and the whole-site file still works once downloaded;
 * - a marker the build keeps for itself (`[rules:start]: # "…"`) is dropped.
 *
 * Every other fence keeps its info string as written. `tsx expect-error` and `tsx expect-report:…`
 * say the example is wrong on purpose, which an agent copying code needs to know more than anyone.
 */

/** The origin every link is written against. `src/entry-server.tsx` says the same, and a test holds them equal. */
export const SITE = "https://ramonda.dev";

/** The Markdown address of a page path: `/` is `/index.md`, `/concepts/state` is `/concepts/state.md`. */
export function textPath(path) {
  return `${path === "/" ? "/index" : path}.md`;
}

const FENCE = /^(\s*)(`{3,})(.*)$/;
const MARKER = /^\[[^\]]+\]: #(\s|$)/;
const LINK = /\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g;

/**
 * One page's Markdown, from its source with the frontmatter already taken off.
 *
 * `pages` is the set of this site's page paths: a link to one of them goes to its Markdown, and
 * any other link to this site (an image, a download) keeps its own address, made absolute.
 */
export function pageText(body, { title, pages, where }) {
  const out = [];
  const lines = body.split("\n");
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const open = FENCE.exec(line);
    if (open !== null) {
      const [, indent, ticks, info] = open;
      const close = new RegExp(`^\\s*${ticks}\\s*$`);
      let end = at + 1;
      while (end < lines.length && !close.test(lines[end])) end++;
      const inside = lines.slice(at + 1, end);
      const lang = info.trim();
      if (lang.startsWith("demo:")) {
        // The blank line after it goes too, or every demo leaves two.
        if (lines[end + 1] === "") end++;
      } else if (lang === "install") {
        const npm = installCommands(inside.join("\n"), where).find(([manager]) => manager === "npm");
        out.push(`${indent}${ticks}sh`, ...npm[1].split("\n").map((command) => indent + command), `${indent}${ticks}`);
      } else {
        out.push(line, ...inside, ...(end < lines.length ? [lines[end]] : []));
      }
      at = end;
      continue;
    }
    if (MARKER.test(line)) continue;
    out.push(
      line.replace(LINK, (_, path, hash = "") => {
        const page = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
        return `](${SITE}${pages.has(page) ? textPath(page) : path}${hash})`;
      }),
    );
  }

  let text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text.startsWith("# ")) text = `# ${title}\n\n${text}`;
  return `${text}\n`;
}

/**
 * `llms.txt`: what the site is, and a line per page to start from, grouped by section.
 *
 * The page for each diagnostic code and each checker rule is left out of it — there are over a
 * hundred and fifty, and each set has an index page listed here that links every one. The
 * whole-site file has them all.
 */
export function llmsIndex(pages, { name, summary, leaveOut }) {
  const sections = new Map();
  for (const page of pages) {
    if (leaveOut.has(page.section)) continue;
    const heading = page.section === "" ? "Overview" : page.section;
    if (!sections.has(heading)) sections.set(heading, []);
    const description = page.description === "" ? "" : `: ${page.description}`;
    sections.get(heading).push(`- [${page.title}](${SITE}${textPath(page.path)})${description}`);
  }
  return [
    `# ${name}`,
    "",
    `> ${summary}`,
    "",
    `Every page is also plain Markdown: add \`.md\` to its path, as in ${SITE}/concepts/state.md. The whole site in one file is ${SITE}/llms-full.txt. Both describe the latest release.`,
    "",
    ...[...sections].flatMap(([heading, lines]) => [`## ${heading}`, "", ...lines, ""]),
  ].join("\n");
}

/** `llms-full.txt`: every page, in the site's order, each under the address it is read at. */
export function llmsFull(pages) {
  return `${pages.map((page) => `<!-- ${SITE}${textPath(page.path)} -->\n\n${page.text}`).join("\n\n")}`;
}
