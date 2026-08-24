/**
 * The comment pair a SERVER render puts around each component's nodes, and the state it carries.
 *
 * ## Why they exist at all, and only here
 *
 * A component owns a range of its parent's children. On the client that range is known: the child
 * record says which nodes are whose, and the diff never has to ask the DOM. Served markup has no
 * record — it is text — so a hydrating client has to be told where each component's run of nodes
 * begins and ends. Two comments say it, and comments are the only thing that can: a `<script>` or a
 * wrapper element inside `<tr>` is fostered out of the table by the parser, and an attribute needs
 * an element the component may not have.
 *
 * They are consumed and REMOVED as each component hydrates, so after hydration the page holds
 * exactly what a client-side render would have produced — nothing extra, in development or in
 * production. A client render never creates one. That is the whole of their life: they are how the
 * server talks to the client about structure, and nothing in the runtime reads them afterwards.
 *
 * A subtree under `@deferHydration` keeps its markers until it resumes, because until then nobody
 * has learnt where its components are.
 *
 * ## The format
 *
 * `<!--c7-->` … `<!--/c7-->`, and the opening one carries the state blob after a single space:
 * `<!--c7 {"count":3}-->`. The id is minted per component per render and is for a person reading
 * the served HTML; nothing matches on it, because a hydrating client mints its own and could never
 * agree. What is matched is the SHAPE, exactly as `ChildrenRegion`'s anchors are.
 *
 * `c` rather than `r`: `ChildrenRegion` already owns `r…`/`/r…` and its `isOpenAnchor` matches
 * `^r\d+$`. A shared vocabulary would mean a portal's block and a component's block could be
 * mistaken for one another, and `anchorId`'s comment records what that costs — a stray anchor
 * swallowing a `<meta>`.
 */

/** A comment node, and one that opens a component's block. */
export function isComponentOpen(node: Node): boolean {
  return node.nodeType === 8 && /^c\d+( |$)/.test((node as Comment).data);
}

/** A comment node, and one that closes a component's block. */
export function isComponentClose(node: Node): boolean {
  return node.nodeType === 8 && /^\/c\d+$/.test((node as Comment).data);
}

/**
 * The serialized state on an opening marker, or `undefined` when the component had none to send.
 *
 * Absent rather than `"{}"` when nothing moved off its initial value: an empty shell is around 90
 * bytes per component that the client would parse and then do nothing with, which is the same
 * reason `serializeComponentToBlob` declines to produce one.
 */
export function markerBlob(node: Node): string | undefined {
  const data = (node as Comment).data;
  const at = data.indexOf(" ");
  return at === -1 ? undefined : data.slice(at + 1);
}

export const componentOpen = (id: number, blob: string | undefined): string =>
  blob === undefined ? `c${id}` : `c${id} ${blob}`;

export const componentClose = (id: number): string => `/c${id}`;
