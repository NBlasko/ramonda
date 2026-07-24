import { renderPage, renderDocument } from "@ramonda/core";
import { routePaths } from "@ramonda/router";
import { App } from "./App";
import { routes } from "./routes";

/** Where the site is served from — used to build absolute og:image / canonical URLs. */
const BASE = "https://ramonda.pages.dev";

const DESCRIPTION = "Ramonda — a TypeScript UI framework built on class components, signals and TC39 decorators.";

/** Escapes a value going into a double-quoted attribute. */
function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * The favicon set, theme colour, and social-card tags. Not modelled by
 * `renderDocument` (which handles charset/viewport/title), so it goes in as
 * `headExtra`. `og:url`/`canonical` are per-page; the rest is site-wide.
 */
function headExtra(path: string, title: string): string {
  const url = BASE + (path === "/" ? "" : path);
  return [
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<meta name="theme-color" content="#7A4FBF">',
    // The per-page <Head> already emits <meta name="description"> for all 50
    // pages (from the page's own meta), so none is added here — a second one
    // would be a duplicate. og:/twitter: descriptions below are the site-wide
    // default, which the per-page Head does not set.
    `<link rel="canonical" href="${attr(url)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Ramonda">',
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(DESCRIPTION)}">`,
    `<meta property="og:image" content="${BASE}/og.png">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(DESCRIPTION)}">`,
    `<meta name="twitter:image" content="${BASE}/og.png">`,
  ].join("");
}

/**
 * Everything the prerender script needs, and nothing about the filesystem.
 *
 * The loop lives here rather than in the script because this is the side that
 * has the app: the script's job is to install a DOM and write files, and keeping
 * those two apart is what makes the pipeline testable without touching a disk.
 */
export function paths(): readonly string[] {
  const { paths, needsData } = routePaths(routes);
  if (needsData.length > 0) {
    // Every docs route is literal. If one ever is not, the build must say so
    // rather than quietly ship a site missing those pages.
    throw new Error(`[docs] These routes need concrete paths and none were supplied: ${needsData.join(", ")}`);
  }
  return paths;
}

export async function renderOne(path: string): Promise<string> {
  window.history.pushState(null, "", path);
  const page = await renderPage(<App />);
  return renderDocument(page, {
    lang: "en",
    styles: ["/assets/site.css"],
    scripts: ["/assets/client.js"],
    headExtra: headExtra(path, page.title),
    rootId: "app",
  });
}
