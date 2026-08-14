/**
 * The HTML shell, and putting a render into it.
 *
 * The last step of every server render and every prerender, and the step that carried the same two
 * faults in three separate files — because each app wrote its own.
 */

/**
 * Escape the characters that let text break out of the element it is written into.
 *
 * `&` first, or an escape written by an earlier branch would be escaped again. Takes `unknown`
 * because the commonest caller is an error page, and what a `catch` receives is not always a string.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/**
 * How a named portal target's container is marked. The same attribute `renderDocument` writes and
 * the client resolves a target name against — the two must agree or hydration builds a second copy.
 */
export const PORTAL_TARGET_ATTR = "data-ramonda-portal-target";

export interface Document {
  /**
   * The shell, with `<!--ssr-->` where the app goes, and optionally `<!--head-->` for its head and
   * `<!--portals-->` for named portal targets.
   */
  template: string;
  /**
   * What the app rendered.
   *
   * Optional because the callers are `.mjs` files with no types to protect them, and a render that
   * came back empty should produce a shell rather than the string "undefined" in the page.
   */
  html?: string;
  /** Read back from `document.title` after the render — raw text, so it is escaped here. */
  title?: string;
  /** Head elements as `outerHTML`, already escaped by having been serialised from real nodes. */
  head?: string;
  /**
   * What each named portal target collected — `renderPage()`'s `portals`.
   *
   * A portal aimed at a name rather than an element is the only kind that can exist on the server:
   * the shell is a string assembled AFTER the render, so the `<div>` a modal wants to live in does
   * not exist while the tree is being built. The server collects into a detached container per
   * name and hands the markup back here; the shell emits a container carrying that name, and the
   * client adopts the block inside it.
   */
  portals?: Record<string, string>;
}

/**
 * The rendered app, its title and its head, put into the shell.
 *
 * **Every substitution is a FUNCTION.** `String.prototype.replace` reads `$&`, `` $` ``, `$'`, `$$`
 * and `$1` in the REPLACEMENT as patterns, so a page that renders a price — "Save $$ today" — put
 * the marker back into its own output. The page still answered 200 with a corrupted body, which is
 * the kind of fault that reaches production and stays there. A function replacement is exempt from
 * that reading entirely, so this is not an escaping problem to get right per character; it is a
 * choice of overload.
 *
 * **The title is escaped and the head is not**, and the asymmetry is the point: `head` is
 * `outerHTML` serialised from real nodes, so it is already markup, while `title` is raw text read
 * back from `document.title`. A page that sets its title from a product name or a search term
 * therefore decides what lands in the document, and `</title><script>` is a short string.
 *
 * A shell missing `<!--ssr-->` or `<!--head-->` is returned as it is. It is a mistake, but a server
 * that throws answers 500 on every route, and a page with no app in it is the more diagnosable of
 * the two. `<!--portals-->` is the exception and throws — see below for why that one cannot be
 * quiet.
 */
export function fillDocument({ template, html, title, head, portals }: Document): string {
  let out = template.replace("<!--ssr-->", () => html ?? "");
  // An EMPTY title is a report that nothing set one — `renderPage` returns `""` when no `Head` in
  // the tree spoke — and not a title of "". Writing it emptied the shell's own `<title>`, which a
  // scaffolded project with no `Head` shipped as `<title></title>`.
  if (title) {
    out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  }
  out = out.replace("<!--head-->", () => head ?? "");

  const blocks = portalContainers(portals);
  if (blocks !== "" && !out.includes(PORTALS_MARKER)) {
    // The one missing marker that is NOT returned quietly.
    //
    // A shell with no `<!--ssr-->` produces a page with no app in it, which announces itself. A
    // shell with nowhere to put a portal produces a page that looks entirely correct and then
    // builds the modal a SECOND time on hydration, because the client found no container to adopt.
    // That is the shape of fault this package exists to stop shipping.
    throw new Error(
      `[ramonda] this render collected ${Object.keys(portals ?? {}).length} portal target(s) — ` +
        `${Object.keys(portals ?? {}).join(", ")} — and the shell has no <!--portals--> to put them in. ` +
        "Add it after your app's root element, inside <body>.",
    );
  }
  return out.replace(PORTALS_MARKER, () => blocks);
}

const PORTALS_MARKER = "<!--portals-->";

/**
 * A container per named target, in the order the render collected them.
 *
 * Emitted even when a block holds no elements: the block's anchor comments are what the client
 * hydrates against, so a container arriving without them is the same as no container at all.
 */
function portalContainers(portals: Record<string, string> | undefined): string {
  if (portals === undefined) return "";
  let out = "";
  for (const name in portals) {
    out += `<div ${PORTAL_TARGET_ATTR}="${escapeAttribute(name)}">${portals[name]}</div>`;
  }
  return out;
}

/**
 * Escapes a double-quoted attribute value — the same rule `renderDocument` uses.
 *
 * `<` and `>` are left alone: both are legal unescaped inside a quoted attribute, and the
 * serializer the rest of this pipeline uses leaves them too. The quote is what could end the
 * attribute early.
 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
