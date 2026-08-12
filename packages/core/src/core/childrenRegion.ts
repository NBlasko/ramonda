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
import type { ListHost } from "../helpers/listEngine";
import type { EnhancedChildNode, MaybeComponent, RecordEntry } from "../types/vdom";
import type { DONE } from "../helpers/constants";

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
 * ## The anchor
 *
 * One comment node, appended to the parent, marking the END of the block.
 * Insertions go before it, so a fresh node lands inside this region rather than
 * past every other portal's nodes at the end of the target.
 *
 * A trailing anchor rather than "insert before the node after my last one",
 * because of the EMPTY block: a region whose children render to nothing owns no
 * nodes and would have no position left to come back to. It is also what
 * survives serialization, which is how a hydrating client finds its own block in
 * a shared target.
 *
 * ## Identity
 *
 * Regions mint their own id. The obvious choice — the owning hook's runtime id —
 * is wrong: `useCommon` hands a hook the OWNER's runtime, so that id is the
 * component's, and a region's `"7:g0"` would collide with the same component's
 * own `"7:g0"` from its JSX. Every id comes from one process-wide counter, so an
 * id minted here is one no component can also hold.
 */
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
  private anchor: Comment | undefined;
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
    reorderChildren(parent, ordered, this.anchor!, this.order);
    this.order = ordered;
  }

  /** The nodes this region owns, in order — what a caller needs to move or seed. */
  get nodes(): readonly ChildNode[] {
    return this.order;
  }

  /**
   * Starts the region off owning nodes it did not build — the ones a server
   * render left in the target.
   *
   * The record is the nodes themselves: entries are DOM nodes or regions, and a
   * plain node is a valid entry. That is enough for the reconcile that follows to
   * CLAIM them rather than build beside them — an adopted node carries no
   * `SLOT_SYM`, which the diff already reads as "positional matching is all there
   * is", and a key stamped by the caller is found the same way as any other.
   *
   * The anchor goes immediately after the last seeded node, not at the end of the
   * parent: several regions may share a target, and appending would put this
   * one's anchor past the next one's nodes.
   */
  seed(nodes: ChildNode[], parent: ChildNode): void {
    if (this.disposed || this.anchor !== undefined) return;
    this.order = nodes.slice();
    this.record = this.order as unknown as RecordEntry[];
    this.parent = parent;

    this.anchor = document.createComment(`r${this.id}`);
    const last = nodes[nodes.length - 1];
    if (last !== undefined && last.parentNode === parent) parent.insertBefore(this.anchor, last.nextSibling);
    else parent.appendChild(this.anchor);
  }

  /**
   * Tears the block down: `@destroyed` for every component in it, the list
   * engines released, and the anchor taken out.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.order.length > 0) unmountChildrenNodes(this.order as EnhancedChildNode[], false);
    // The engines are reachable only from the record — the nodes going is not
    // enough, or every item that read an ancestor's signal stays subscribed.
    disposeRegions(this.record);
    this.record = [];
    this.order = [];
    this.anchor?.remove();
    this.anchor = undefined;
    this.parent = undefined;
  }

  /**
   * Puts the anchor in `parent`, moving the whole block when the parent changed.
   *
   * A moved region takes the SAME nodes across, so component state relocates
   * rather than a second copy being built beside a stale one.
   */
  private place(parent: ChildNode): void {
    if (this.anchor === undefined) {
      this.anchor = document.createComment(`r${this.id}`);
      parent.appendChild(this.anchor);
      this.parent = parent;
      return;
    }
    if (this.parent === parent) return;

    parent.appendChild(this.anchor);
    for (const node of this.order) parent.insertBefore(node, this.anchor);
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
