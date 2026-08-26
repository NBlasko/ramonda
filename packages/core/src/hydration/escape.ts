/**
 * Escaping for the places this package builds HTML as a STRING.
 *
 * Everywhere else the DOM does it: an element serialized through `outerHTML` has its text and its
 * attributes escaped by the serializer, and nothing here has to think about it. These two are for
 * the seams where markup is assembled by hand — the document shell, and the head and portal blocks
 * a server render collects node by node.
 */

/**
 * Escapes text content.
 *
 * `<title>` holds text, and the page title is page data — a doc page called `"<script> and you"` is
 * an ordinary thing to want and must not end the title element. `&` first, or the escapes escape
 * each other.
 */
export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escapes a double-quoted attribute value.
 *
 * `<` and `>` are left alone: they are legal unescaped inside a quoted attribute, and the HTML
 * serializer the rest of this pipeline uses leaves them too. The quote is the character that could
 * end the attribute early.
 */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
