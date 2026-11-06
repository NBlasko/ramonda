/**
 * Where an element was written — the file, line and column the compiler hands the development
 * runtime with every tag.
 *
 * Kept on the vnode by `jsxDEV`, in development only, so a diagnostic about an element can name the
 * line it came from. The compiler builds this object on every call already; keeping it is one
 * reference. A vnode built by hand, or by the production runtime, has none, and a report then says
 * what it always said.
 */
export interface Source {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export const SOURCE: unique symbol = Symbol("ramonda.source");

export function sourceOf(vnode: unknown): Source | undefined {
  if (vnode === null || typeof vnode !== "object") return undefined;
  const source = (vnode as { [SOURCE]?: Source })[SOURCE];
  return source !== undefined && typeof source.fileName === "string" ? source : undefined;
}

/** `file:line:column`, the form an editor and a terminal both make clickable. */
export function written(source: Source): string {
  return `${source.fileName}:${source.lineNumber}:${source.columnNumber}`;
}
