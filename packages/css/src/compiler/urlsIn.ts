/**
 * Every `url( … )` in a piece of CSS text: the path as written, and where it starts in the text.
 *
 * Read character by character rather than by a regex: `url\(\s*(["']?)([^"')]*)\1\s*\)` lets the
 * spaces before the path and the path itself both take a space, so an unclosed `url(` and a run of
 * spaces is tried every way — measured, it did not finish in two minutes at 10 000 spaces. The
 * parser collapses runs of whitespace before a rule sees a value, but a reader is not the only
 * caller this may ever have.
 */
export function urlsIn(text: string): { readonly path: string; readonly at: number }[] {
  const found: { path: string; at: number }[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (;;) {
    const open = lower.indexOf("url(", from);
    if (open === -1) return found;
    let at = open + 4;
    while (at < text.length && /\s/.test(text[at])) at++;
    const quote = text[at] === '"' || text[at] === "'" ? text[at] : "";
    if (quote !== "") at++;
    const start = at;
    while (at < text.length && (quote !== "" ? text[at] !== quote : text[at] !== ")" && !/\s/.test(text[at]))) at++;
    const path = text.slice(start, at);
    if (quote !== "" && at < text.length) at++;
    while (at < text.length && /\s/.test(text[at])) at++;
    if (text[at] === ")") found.push({ path, at: start });
    from = Math.max(at, open + 4);
  }
}

/** A path with any query or fragment taken off — `icons.svg#home` is the file `icons.svg`. */
export function withoutQuery(path: string): string {
  const query = path.indexOf("?");
  const fragment = path.indexOf("#");
  const cut = [query, fragment].filter((one) => one !== -1);
  return cut.length === 0 ? path : path.slice(0, Math.min(...cut));
}
