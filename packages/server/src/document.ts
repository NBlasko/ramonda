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

export interface Document {
  /** The shell, with `<!--ssr-->` where the app goes and optionally `<!--head-->` for its head. */
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
 * A shell missing a marker is returned as it is. It is a mistake, but a server that throws answers
 * 500 on every route, and a page with no app in it is the more diagnosable of the two.
 */
export function fillDocument({ template, html, title, head }: Document): string {
  let out = template.replace("<!--ssr-->", () => html ?? "");
  if (title !== undefined) {
    out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  }
  return out.replace("<!--head-->", () => head ?? "");
}
