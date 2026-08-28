import { createId } from "../helpers/createId";
import { normalizeChildren } from "../vdom/h";
import {
  reconcileEntries,
  flattenEntries,
  disposeRegions,
  unmountChildrenNodes,
  reorderChildren,
  reparentRegions,
} from "./DiffAndMerge";
import { addTaskToQueue } from "./Task";
import { queuePostCommit } from "./commit";
import { hydrateLevel, isSplitRemainder, type HydrationWalk } from "../hydration/hydrate";
import { reportBlockLengthMismatch } from "../debug/hydrationMismatch";
import type { ListHost } from "../helpers/listEngine";
import type { EnhancedChildNode, MaybeComponent, RecordEntry } from "../types/vdom";
import { BLOCK_CLOSE, BLOCK_OWNER, CHILD_RECORD, HOSTS_A_BLOCK, type DONE } from "../helpers/constants";

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
 * Tells an element that it holds a block, so the diff need not go looking.
 *
 * `firstHostedBlock` has to know whether an element hosts one — a hosted block sits after the
 * element's own children, so a fresh child must go in before it — and it used to answer by walking
 * every child on every reorder. See `HOSTS_A_BLOCK` for the measurement and for why the mark is
 * never taken off.
 *
 * Written from BOTH ways a block reaches a parent: placed by a client build, and adopted from a
 * server render. Missing either one is a host that looks empty while it is not.
 */
function markAsHost(parent: ChildNode): void {
  (parent as unknown as { [HOSTS_A_BLOCK]?: true })[HOSTS_A_BLOCK] = true;
}

export class ChildrenRegion {
  private readonly id = createId();
  /** What this block held last pass — the region's own `CHILD_RECORD`. */
  private record: RecordEntry[] = [];
  /**
   * The nodes this block holds, in order, derived from `record` on every read.
   *
   * Deliberately not a cached array. A COMPONENT inside this block re-renders on its own, straight
   * into the record entry it owns, without this region hearing about it — so a list captured when
   * the region last reconciled is stale the moment a child's state moves, and every reader of it is
   * then working from a description of a DOM that no longer exists. `dispose()` unmounted the nodes
   * of the last pass and left the new ones in a target it no longer has an anchor in. Walking the
   * record instead walks into that child's CURRENT entries, which is the only place the truth is.
   */
  private get order(): ChildNode[] {
    const nodes: ChildNode[] = [];
    flattenEntries(this.record, nodes);
    return nodes;
  }
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
  }

  /**
   * Publishes this block on its own OPENING ANCHOR: the record it holds, and where it ends.
   *
   * The record belongs to the region — that is the whole point of the class — so a walk over the
   * target element cannot see the components inside it, and three readers need to: the server's
   * marker pass, the devtools tree, and the search an empty component does for its own position.
   *
   * On the anchor rather than in a registry of live regions, and that is the fix for two faults at
   * once. A registry is only emptied by `dispose`, and nothing disposes a server render's tree — so
   * it grew by one per portal per request for the life of the process, and the marker pass rebuilt
   * the whole of it once per DOM node. The anchor is a node already in the target: it goes when the
   * block goes, and an ordinary walk finds it where it is.
   */
  private publish(): void {
    const open = this.open as unknown as EnhancedChildNode | undefined;
    if (open === undefined) return;
    open[CHILD_RECORD] = this.record;
    (open as unknown as { [BLOCK_CLOSE]?: ChildNode })[BLOCK_CLOSE] = this.close;
    // And the region itself, so a teardown of the HOST element can tell it. See `hostRemoved`.
    (open as unknown as { [BLOCK_OWNER]?: { hostRemoved(): void } })[BLOCK_OWNER] = this;
  }

  /**
   * The element this block lived in is being removed by whoever owns it.
   *
   * The nodes go — they are inside it — and every component in here is torn down, which is what the
   * teardown was already doing by finding the record on the anchor. What it could not do is TELL the
   * region, so the region went on believing those instances mounted: measured, the next `reconcile`
   * adopted a destroyed component, RMD008 reported a write after unmount, and the block carried that
   * dead markup into the live DOM, where it could never update again.
   *
   * Released rather than DISPOSED, and that is the decision worth naming: the owner of this region is
   * still alive, and its target may come back — the same `<section>` re-rendered, or a different one.
   * So the region forgets what it held and is placed afresh on its next reconcile, exactly as it was
   * before it was ever placed. Disposing it instead would leave a live hook rendering nowhere for
   * good.
   */
  hostRemoved(): void {
    if (this.disposed || this.open === undefined) return;

    const held = this.order;
    if (held.length > 0) unmountChildrenNodes(held as EnhancedChildNode[], false);
    // The engines are reachable only from the record — the nodes going is not enough, or every item
    // that read an ancestor's signal stays subscribed.
    disposeRegions(this.record);
    this.record = [];

    /**
     * The anchors are dropped rather than removed: they are children of the element being taken out,
     * so the host removes them. Clearing what they published matters all the same — the teardown walk
     * may still be holding them, and a stale record on a detached comment is exactly what a later
     * reader would take for the truth.
     */
    const open = this.open as unknown as EnhancedChildNode;
    open[CHILD_RECORD] = undefined;
    (open as unknown as { [BLOCK_CLOSE]?: ChildNode })[BLOCK_CLOSE] = undefined;
    (open as unknown as { [BLOCK_OWNER]?: unknown })[BLOCK_OWNER] = undefined;

    this.open = undefined;
    this.close = undefined;
    this.parent = undefined;
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

    // Read before the record is replaced: this is where the nodes ARE, and the reorder needs it to
    // tell a node that has not moved from one that has.
    const before = this.order;

    const unclaimed: (EnhancedChildNode | DONE)[] = [];
    const result = reconcileEntries(normalized, this.record, undefined, this.owner, parent, unclaimed, this.listHost);
    this.record = result.entries;
    this.publish();

    // Before the reorder, for the reason the render path has: stale nodes still
    // in the DOM make correctly-placed ones look misplaced and cause moves.
    unmountChildrenNodes(unclaimed, false);

    reorderChildren(parent, this.order, this.close!, before);
  }

  /**
   * Adopts the block a server render left behind, starting at `open`.
   *
   * This is the ordinary hydration walk — `hydrateLevel`, the same one an
   * element's children go through — pointed at a run of siblings instead of at
   * everything under a parent. That is the whole reason it exists: a portalled
   * COMPONENT is only restored if `hydrateComponent` runs on it, reading the
   * state blob off its host and adopting it as the instance's own. Reusing the
   * element and reconciling against it is not the same thing — no node says a component is here, so
   * the diff builds a fresh one, the server's `@created` never happened on this side, and its state
   * is gone.
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

    /**
     * Marked HERE as well as in `place`, because a served block never goes through `place` at all.
     *
     * `Portal.adopt` hands a block the server wrote straight to this method — no placement happens,
     * since the anchors are already in the document. So the two ways a block reaches a parent are
     * two pieces of code, and anything the diff learns about a host on one has to be learned on the
     * other.
     *
     * **No failing case was found for it, and that is written down rather than dressed up.** Every
     * shape tried came out marked anyway: a portal aimed at an element in the owner's own render
     * cannot resolve that target while `adopt` runs — the field still holds the detached placeholder
     * — so it falls through to `reconcile`, which places, which marks. The targets that ARE resolved
     * by then, `document.head` and the like, are not elements the diff reorders. Planting this line
     * out leaves all 1413 tests green.
     *
     * It stays because the asymmetry is real whether or not today's code walks into it: a host that
     * looks empty while it holds a guest is the fault `firstHostedBlock` exists to prevent, and the
     * note further down this very method is that fault from the last time it happened.
     */
    markAsHost(parent);

    const normalized = normalizeChildren(Array.isArray(children) ? children : [children], this.id);
    const walk: HydrationWalk = { cursor: open.nextSibling as EnhancedChildNode | null, count: 0 };
    this.record = hydrateLevel(normalized, this.owner, parent, walk, this.listHost).entries;

    /**
     * Where the walk stopped IS the closing anchor, when the server wrote as many nodes as this
     * render wants — and also when it wrote FEWER, because those extra children were built and
     * inserted in front of the anchor and the walk stopped on it all the same.
     *
     * **Every exit publishes, and it publishes AFTER `this.close` is known.** This used to publish
     * once up here, while the close was still `undefined`, and only the two divergence exits below
     * published again — so the ordinary exit, which is every correct SSR page, left
     * `open[BLOCK_CLOSE]` unset until the region's first `reconcile()`. Both readers of it then took
     * their fallback: an empty portalled component's first node was placed at the END OF THE TARGET
     * rather than inside its own anchors, and a host element read the block's nodes as its own
     * because the run had no end to skip to.
     */
    const stop = walk.cursor;
    if (stop !== null && isCloseAnchor(stop)) {
      this.close = stop as unknown as Comment;
      this.publish();
      return;
    }

    /**
     * The walk stopped on a leftover SERVER node, still inside this block: the client rendered
     * FEWER children than the server did.
     *
     * Minting a close in front of it is what this used to do, and it put every remaining server node
     * — and the server's own close — OUTSIDE the region. Measured on a two-`<meta>` block hydrated by
     * a one-`<meta>` render: the head kept `<!--r7--><meta a><!--/r14--><meta b><!--/r7-->`, so the
     * stale tag stayed on screen and `dispose()` could never reclaim it, because the teardown only
     * ever removes what the record holds plus its two anchors.
     *
     * The server's own close is the answer, and the run in front of it is what this render did not
     * ask for. Depth is counted because a block may hold another block, whose close comes first.
     */
    let depth = 0;
    const extra: ChildNode[] = [];
    for (let node: ChildNode | null = stop; node !== null; node = node.nextSibling) {
      if (isOpenAnchor(node)) depth++;
      else if (isCloseAnchor(node)) {
        if (depth === 0) {
          // What is REPORTED is what the server sent and this render did not want. A split tail is
          // the second half of a text divergence already reported, and counting it said "your block
          // is one node shorter" about a node this hydration made — the same distinction
          // `closeBlock` draws one level up.
          let fromServer = 0;
          for (const spare of extra) {
            if (!isSplitRemainder(spare)) fromServer++;
            spare.remove();
          }
          this.close = node as Comment;
          if (__DEV__ && fromServer > 0) reportBlockLengthMismatch(this.owner, fromServer);
          this.publish();
          return;
        }
        depth--;
      }
      extra.push(node);
    }

    /**
     * No close anywhere after the cursor: the server never closed this block. Nothing before it can
     * be trusted as an end, so the region writes its own — without one, `reconcile` and `dispose`
     * have no boundary to work against and the next render inserts past every other block in a
     * shared target.
     */
    this.close = document.createComment(closeAnchor(this.id));
    parent.insertBefore(this.close, stop);
    this.publish();
  }

  /**
   * Tears the block down: `@destroyed` for every component in it, the list
   * engines released, and the anchor taken out.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const held = this.order;
    if (held.length > 0) unmountChildrenNodes(held as EnhancedChildNode[], false);
    // The engines are reachable only from the record — the nodes going is not
    // enough, or every item that read an ancestor's signal stays subscribed.
    disposeRegions(this.record);
    this.record = [];
    this.publish();
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
    markAsHost(parent);

    if (this.close === undefined) {
      this.open = document.createComment(openAnchor(this.id));
      this.close = document.createComment(closeAnchor(this.id));
      parent.appendChild(this.open);
      parent.appendChild(this.close);
      this.parent = parent;
      this.publish();
      return;
    }
    if (this.parent === parent) return;

    parent.appendChild(this.open!);
    for (const node of this.order) parent.appendChild(node);
    parent.appendChild(this.close);
    this.parent = parent;
    reparentRegions(this.record, parent);
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
