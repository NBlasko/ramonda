import type { RenderedPage } from "./ssr";
import { PORTAL_TARGET_ATTR } from "../base/portalTarget";
import { escapeAttribute, escapeText } from "./escape";

export interface DocumentOptions {
  /**
   * `<html lang>`. Defaults to `"en"`.
   *
   * Not optional in practice: screen readers pick pronunciation from it, and
   * search engines use it to decide which audience a page is for. The default is
   * a default, not a recommendation.
   */
  lang?: string;
  /** Module scripts, appended at the end of `<body>` — your hydration entry. */
  scripts?: readonly string[];
  /** Stylesheet hrefs, linked in `<head>`. */
  styles?: readonly string[];
  /**
   * Raw markup appended to `<head>`, for whatever this does not model: a
   * favicon, a font preload, an analytics snippet.
   *
   * **Not escaped** — that is what makes it useful and what makes it yours to
   * get right. Never build it from anything a user typed.
   */
  headExtra?: string;
  /** `class` on `<body>`. */
  bodyClass?: string;
  /**
   * The element the app is mounted into, and what `hydrateRoot` must be given.
   * Defaults to `"app"`.
   */
  rootId?: string;
}

/**
 * Wraps a rendered page in a complete HTML document, ready to write to disk.
 *
 * ```ts
 * const page = await renderPage(<App />);
 * writeFileSync("dist/guide/state/index.html", renderDocument(page, {
 *   scripts: ["/assets/client.js"],
 *   styles: ["/assets/site.css"],
 * }));
 * ```
 *
 * Deliberately small. A shell is the one part of a static build that every
 * project wants slightly differently, so this models the pieces that are the
 * same everywhere — doctype, charset, viewport, title, the head the page
 * produced, a root element, the hydration script — and leaves the rest to
 * `headExtra`. Anything more opinionated would be a template engine, and anyone
 * who needs one can build the string themselves from `RenderedPage`.
 *
 * **`charset` comes first, before anything else in `<head>`.** A browser that
 * has not been told the encoding guesses from the first bytes and restarts the
 * parse if it guessed wrong; the spec asks for it within the first 1024 bytes.
 * A long title full of non-ASCII could push it past that, so it does not go
 * after the title.
 */
export function renderDocument(page: RenderedPage, options: DocumentOptions = {}): string {
  const { lang = "en", scripts = [], styles = [], headExtra = "", bodyClass, rootId = "app" } = options;

  const styleTags = styles.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`).join("");

  const scriptTags = scripts.map((src) => `<script type="module" src="${escapeAttribute(src)}"></script>`).join("");

  return (
    "<!doctype html>" +
    `<html lang="${escapeAttribute(lang)}">` +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeText(page.title)}</title>` +
    page.head +
    styleTags +
    headExtra +
    "</head>" +
    `<body${bodyClass ? ` class="${escapeAttribute(bodyClass)}"` : ""}>` +
    `<div id="${escapeAttribute(rootId)}">${page.body}</div>` +
    portalContainers(page.portals) +
    scriptTags +
    "</body>" +
    "</html>"
  );
}

/**
 * A container per named portal target, after the app root.
 *
 * After it on purpose: a modal aims at a container outside the app precisely to
 * escape a stacking context or an `overflow: hidden`, and emitting it inside the
 * root would put it back in the one it is trying to leave.
 *
 * Emitted even when the block is empty of elements, because the block's anchor
 * comments are what the client hydrates against — a container that arrives
 * without them makes the portal build a second copy of what the server wrote.
 */
function portalContainers(portals: Record<string, string> | undefined): string {
  if (portals === undefined) return "";

  let out = "";
  for (const name in portals) {
    out += `<div ${PORTAL_TARGET_ATTR}="${escapeAttribute(name)}">${portals[name]}</div>`;
  }
  return out;
}
