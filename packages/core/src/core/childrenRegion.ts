import { createId } from "../helpers/createId";
import { normalizeChildren } from "../vdom/h";
import {
  reconcileEntries,
  flattenEntries,
  disposeRegions,
  unmountChildrenNodes,
  reorderChildren,
} from "./DiffAndMerge";
import { addTaskToQueue } from "./Task";
import { queuePostCommit } from "./commit";
import { hydrateLevel, type HydrationWalk } from "../hydration/hydrate";
import type { ListHost } from "../helpers/listEngine";
import type { EnhancedChildNode, MaybeComponent, RecordEntry } from "../types/vdom";
import type { DONE } from "../helpers/constants";

/**
 * The comments that delimit a region's block in the DOM, and in the markup a
 * server render emits.
 *
 * The id is for a person reading the DOM; nothing matches on it. What is matched
 * is the SHAPE — `r…` opens, `/r…` closes — because a hydrating client's regions
 * mint their own ids and could never agree with the server's.
 */
export const openAnchor = (id: number): string => `r${id}`;
export const closeAnchor = (id: number): string => `/r${id}`;

/** A comment node, and one that opens a region block. */
export function isOpenAnchor(node: Node): boolean {
  return node.nodeType === 8 && /^r\d+$/.test((node as Comment).data);
}

export function isCloseAnchor(node: Node): boolean {
  return node.nodeType === 8 && /^\/r\d+$/.test((node as Comment).data);
}

/**
 * The id an anchor carries, for pairing an opening one with ITS closing one.
 *
 * Matching "the next close anchor" instead is not enough. A comment that merely
 * reads like an opening anchor — a shell is entitled to one — would then pair
 * with the close belonging to a real block further down, and everything between
 * them, including that block's own opening anchor, would be read as one block.
 * Measured: a stray `<!--r999-->` in front of the shell's `<meta>` swallowed it
 * into a portal's collected markup and deleted it from the head.
 */
export function anchorId(node: Node): string | undefined {
  if (node.nodeType !== 8) return undefined;
  const data = (node as Comment).data;
  const at = data.startsWith("/") ? 1 : 0;
  return /^\/?r\d+$/.test(data) ? data.slice(at) : undefined;
}

/**
 * A contiguous run of children that something OTHER than an element's render
 * owns, reconciled by the real reconciler.
 *
 * ## What it is for
 *
 * `list()` promises minted identity, per-item reactive scopes and the whole-list
 * skip. Those live in `ListEngine`, and the only thing that reaches them is
 * `reconcileEntries` — which needs a record of what was there last time, and a
 * parent to put nodes in. An element's render has both: its record hangs off the
 * element (`CHILD_RECORD`) and describes ALL of its children.
 *
 * A hook consuming renderable children has neither. A portal writes into a target
 * it SHARES — with the shell's own content and with every other portal — so it
 * cannot own that element's record, and it cannot reorder its children. That is
 * why Portal hand-rolled its own reconcile, and why `list()` crashed inside it.
 *
 * This is the missing boundary: a record of its own, a block of its own, and the
 * same `reconcileEntries` a render slot goes through. Portal is the first
 * consumer; the rule it establishes is that wherever a hook consumes renderable
 * children, `list()` works there.
 *
 * ## The anchors
 *
 * A pair of comment nodes delimiting the block — `<!--r7-->` before it and
 * `<!--/r7-->` after. Insertions go before the closing one, so a fresh node lands
 * inside this region rather than past every other portal's nodes at the end of
 * the target.
 *
 * Anchors rather than "insert before the node after my last one", because of the
 * EMPTY block: a region whose children render to nothing owns no nodes and would
 * have no position left to come back to.
 *
 * And COMMENTS rather than an attribute on the nodes, which is what a portal used
 * to mark its own tags with. An attribute on a node the reconciler owns cannot
 * survive: the attribute diff reads a node's current attributes as the previous
 * set and removes whatever the next vnode does not have, so the first re-render
 * of anything in the block erased the marker and the server dropped the tag from
 * the page. Measured on a portalled component that writes state in a server
 * `@created`: the head came back empty. A comment is not an attribute, so nothing
 * in the attribute pass can reach it — and it serializes, which is how a
 * hydrating client finds its own block in a shared target.
 *
 * ## Identity
 *
 * Regions mint their own id. The obvious choice — the owning hook's runtime id —
 * is wrong: `useCommon` hands a hook the OWNER's runtime, so that id is the
 * component's, and a region's `"7:g0"` would collide with the same component's
 * own `"7:g0"` from its JSX. Every id comes from one process-wide counter, so an
 * id minted here is one no component can also hold.
 */
/**
 * Every region currently holding nodes, for the server's marker pass.
 *
 * A region's record is its own — that is the whole point of the class — so a walk over the target
 * element cannot see the components inside it. The server has to mark those too, or a hydrating
 * client finds no marker in a portal and builds a second copy of everything there. A registry rather
 * than a back-reference on the anchor: the pass needs the block's CLOSING anchor to know where the
 * markers go, and only the region knows that.
 */
const liveRegions = new Set<ChildrenRegion>();

/** What the server's marker pass needs from each live region: its record, and where its block ends. */
export function regionBlocks(): { entries: RecordEntry[]; parent: ChildNode; before: ChildNode }[] {
  const blocks: { entries: RecordEntry[]; parent: ChildNode; before: ChildNode }[] = [];
  for (const region of liveRegions) {
    const block = region.block();
    if (block !== undefined) blocks.push(block);
  }
  return blocks;
}

export class ChildrenRegion {
  private readonly id = createId();
  /** What this block held last pass — the region's own `CHILD_RECORD`. */
  private record: RecordEntry[] = [];
  /**
   * The block's nodes in order, as of last pass.
   *
   * Doubles as the position map for the reorder: the nodes are contiguous and
   * nothing else moves them, so this IS their DOM order, and reading it back
   * costs nothing where a walk over a shared parent's children would.
   */
  private order: ChildNode[] = [];
  private open: Comment | undefined;
  private close: Comment | undefined;
  private parent: ChildNode | undefined;
  /** The last children given, so a self-refresh has something to reconcile. */
  private children: unknown;
  private refreshQueued = false;
  private disposed = false;
  private readonly listHost: ListHost;

  constructor(
    private readonly owner: MaybeComponent,
    name: string,
  ) {
    this.listHost = {
      reBuild: () => this.invalidate(),
      name,
    };
    liveRegions.add(this);
  }

  /** This block, for the server's marker pass — see `regionBlocks`. */
  block(): { entries: RecordEntry[]; parent: ChildNode; before: ChildNode } | undefined {
    if (this.parent === undefined || this.close === undefined) return undefined;
    return { entries: this.record, parent: this.parent, before: this.close };
  }

  /** Brings the block into line with `children`, inside `parent`. */
  reconcile(children: unknown, parent: ChildNode): void {
    if (this.disposed) return;
    this.children = children;
    this.place(parent);

    // The same normalization a render goes through, so a region's children get
    // owner stamping, nested-array grouping and hole handling identically — with
    // this region as the origin instead of a component's render.
    const normalized = normalizeChildren(Array.isArray(children) ? children : [children], this.id);

    const unclaimed: (EnhancedChildNode | DONE)[] = [];
    const result = reconcileEntries(normalized, this.record, undefined, this.owner, parent, unclaimed, this.listHost);
    this.record = result.entries;

    // Before the reorder, for the reason the render path has: stale nodes still
    // in the DOM make correctly-placed ones look misplaced and cause moves.
    unmountChildrenNodes(unclaimed, false);

    const ordered: ChildNode[] = [];
    flattenEntries(result.entries, ordered);
    reorderChildren(parent, ordered, this.close!, this.order);
    this.order = ordered;
  }

  /** The nodes this region owns, in order — what a caller needs to move or seed. */
  get nodes(): readonly ChildNode[] {
    return this.order;
  }

  /**
   * Adopts the block a server render left behind, starting at `open`.
   *
   * This is the ordinary hydration walk — `hydrateLevel`, the same one an
   * element's children go through — pointed at a run of siblings instead of at
   * everything under a parent. That is the whole reason it exists: a portalled
   * COMPONENT is only restored if `hydrateComponent` runs on it, reading the
   * state blob off its host and adopting it as the instance's own. Reusing the
   * element and reconciling against it is not the same thing — the node carries
   * no `_componentInstance`, so the diff builds a fresh component, the server's
   * `@created` never happened on this side, and its state is gone.
   *
   * The server's own anchors are REUSED rather than replaced. Their ids belong to
   * the server's regions and will not match this one's, but an id is only ever
   * read by a person looking at the DOM — nothing matches on it, and reusing the
   * nodes means the adoption moves nothing at all.
   */
  hydrate(children: unknown, parent: ChildNode, open: Comment): void {
    if (this.disposed || this.open !== undefined) return;
    this.children = children;
    this.parent = parent;
    this.open = open;

    const normalized = normalizeChildren(Array.isArray(children) ? children : [children], this.id);
    const walk: HydrationWalk = { cursor: open.nextSibling as EnhancedChildNode | null, count: 0 };
    this.record = hydrateLevel(normalized, this.owner, parent, walk, this.listHost).entries;

    const ordered: ChildNode[] = [];
    flattenEntries(this.record, ordered);
    this.order = ordered;

    // Where the walk stopped IS the closing anchor, when the server wrote as many
    // nodes as this render wants. It is not when the client renders more children
    // than the server did: those were built and inserted before the anchor, and
    // the walk stopped on it all the same. Either way the anchor is the node the
    // walk ran into, so the only case left is a block the server never closed.
    const stop = walk.cursor;
    if (stop !== null && isCloseAnchor(stop)) {
      this.close = stop as unknown as Comment;
      return;
    }
    this.close = document.createComment(closeAnchor(this.id));
    parent.insertBefore(this.close, stop);
  }

  /**
   * Tears the block down: `@destroyed` for every component in it, the list
   * engines released, and the anchor taken out.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveRegions.delete(this);
    if (this.order.length > 0) unmountChildrenNodes(this.order as EnhancedChildNode[], false);
    // The engines are reachable only from the record — the nodes going is not
    // enough, or every item that read an ancestor's signal stays subscribed.
    disposeRegions(this.record);
    this.record = [];
    this.order = [];
    this.open?.remove();
    this.close?.remove();
    this.open = undefined;
    this.close = undefined;
    this.parent = undefined;
  }

  /**
   * Puts the anchor in `parent`, moving the whole block when the parent changed.
   *
   * A moved region takes the SAME nodes across, so component state relocates
   * rather than a second copy being built beside a stale one.
   */
  private place(parent: ChildNode): void {
    if (this.close === undefined) {
      this.open = document.createComment(openAnchor(this.id));
      this.close = document.createComment(closeAnchor(this.id));
      parent.appendChild(this.open);
      parent.appendChild(this.close);
      this.parent = parent;
      return;
    }
    if (this.parent === parent) return;

    parent.appendChild(this.open!);
    for (const node of this.order) parent.appendChild(node);
    parent.appendChild(this.close);
    this.parent = parent;
  }

  /**
   * What an item's invalidated scope reports to.
   *
   * In a render slot the answer is "re-render the owner", because the render is
   * what calls `list()` again. Here the children came from a hook's props
   * factory, whose cache is keyed on the signals the FACTORY read — an item
   * reading something deeper leaves it clean, so the callback would not rerun and
   * the row would go stale with nothing saying why.
   *
   * So both: the owner is queued exactly as before (its render may be what the
   * signal really meant, and the queue de-duplicates), and the region's own
   * refresh rides the same drain through the post-commit queue. Reconciling with
   * the very same descriptor is enough — the engine's dirty scope is what makes
   * the pass rebuild that one item, and an already-current region takes the
   * whole-list skip and touches nothing.
   */
  private invalidate(): void {
    if (this.disposed || this.refreshQueued) return;
    const owner = this.owner;
    if (!owner) return;

    this.refreshQueued = true;
    addTaskToQueue(owner);
    queuePostCommit(owner, () => {
      this.refreshQueued = false;
      if (this.disposed || this.parent === undefined) return;
      this.reconcile(this.children, this.parent);
    });
  }
}
