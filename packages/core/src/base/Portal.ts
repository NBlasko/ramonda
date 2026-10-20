import { Hook } from "./Hook";
import { ownerRuntime } from "../core/renderEnv";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "../core/runtime";
import type { EnclosingBlock, NestedBlock } from "../core/enclosingBlock";
import { created, destroyed, watchProp } from "./decorators";
import { ChildrenRegion, isOpenAnchor } from "../core/childrenRegion";
import { isPortalTarget, resolvePortalTarget, type PortalTarget } from "./portalTarget";
import type { RamondaNode } from "../types/vdom";

export interface PortalProps {
  /**
   * What to render into `target`. A single vnode, a string, or an array of them
   * — whatever an expression slot already accepts, because that is where a
   * caller builds it: `this.use(Portal, () => ({ children: <title>{t}</title>, target }))`.
   */
  children: RamondaNode;
  /**
   * Where the children are rendered, rather than where the hook sits.
   *
   * An `Element` when you have the node — a target inside your own render, which
   * is also how "inline" is done. A `portalTarget("name")` token for a container
   * OUTSIDE the app's root, which is the only form that can exist on the server:
   * the shell is assembled after the render, so there is no element to point at
   * while the tree is being built. See `portalTarget`.
   */
  target: Element | PortalTarget;
}

/**
 * Renders a subtree into a DOM `target` elsewhere, while the subtree stays part
 * of the owner's lifecycle tree.
 *
 * ## Why a hook, not a tag
 *
 * A tag would add a host element where it is written, and the whole point of a
 * portal is to render NOTHING there. As a hook it renders in place exactly like
 * `Head` does today — `this.use(Portal, …)` — and its children land in `target`.
 *
 * ## Full lifecycle, borrowed from the reconciler
 *
 * It drives the same `diffAndMerge` `bootstrap` drives, under the OWNER as the
 * placeholder component — so a component inside a portal inherits the owner's
 * context and render side, and gets `@created`, `@mounted`, signals and `@destroyed`
 * like any other subtree. Nothing here re-implements the diff; it reuses it per
 * child, and only owns the placement.
 *
 * ## It owns only its own nodes
 *
 * The children diff (`applyDiffOnChildren` / `reorderChildren`) works over ALL of
 * a parent's children, so it cannot be pointed at a shared `document.head`
 * without adopting the shell's tags and every other portal's. So a portal owns a
 * `ChildrenRegion` instead: a contiguous BLOCK inside the target, with a record
 * of its own and anchor comments delimiting it. Two portals into one target
 * therefore coexist, and neither touches what was there before them — which is
 * the property `Head` needs and the registry used to fake.
 *
 * Everything else follows from the region being reconciled by the real
 * reconciler: `list()` works here, a component restores its server state on
 * hydration, and a keyed reorder costs the moves it has to and no more.
 *
 * ## Reactivity — it rides the render cycle, on purpose
 *
 * `@created` (env `shared`, so a server render places the children too) does the
 * first reconcile; `@watchProp` on `children` and `target` together does every
 * later one. Because the props factory is cached on the signals it read, and
 * markup that says the same keeps its old object, `children` only changes when
 * something it shows actually moved — so an unrelated render of the owner does
 * not re-reconcile. When the head DID change, the owner's
 * render is the cost, and that is accepted: a portal is a portal.
 *
 * ## A reactive `target`, and "inline"
 *
 * `target` may change: point it at `document.body` on desktop and a local element
 * on mobile, and the nodes MOVE — the same DOM node, keeping its state, not a
 * second copy. That is also how "inline" is done: there is no `disabled` flag,
 * because a hook has no position of its own to fall back to, so instead you aim
 * `target` at an element in your own render. A `target` absent at mount and
 * supplied later is placed then, not lost. A target that goes away takes the
 * block off the page and brings the same nodes back with it — see `leave` — and
 * closes the portals inside its block with it, see `Nesting`. A
 * target change is watched on its own, so it moves the nodes whether or not
 * `children` changed with it.
 *
 * ## Events follow the DOM, not the logical tree
 *
 * There is no synthetic event layer — a handler in the markup is a real listener on a
 * real node — so a portal's events bubble through the DOM, from the TARGET's
 * ancestors, not from the owner that declared the portal. A handler on an ancestor
 * of the `Portal`'s owner will NOT see events from the portalled subtree: put it on
 * the portalled content, or on an ancestor of the target.
 */
export class Portal extends Hook<PortalProps> {
  /**
   * The block this portal owns in the target, and everything that makes it behave
   * like ordinary children: the record, the list regions, the reorder.
   *
   * Built lazily rather than in a field initializer, because the owner is read
   * off the runtime and a hook's fields run before the runtime is settled.
   */
  private area: ChildrenRegion | undefined;
  /**
   * Whether the first reconcile has run. NOT the block's length, which cannot
   * tell "placed, and it came to nothing" from "never placed": a portal whose
   * children resolve to an empty list still ran, and on a client build must NOT
   * then take the hydration `adopt` path and sweep up every other portal's
   * marked nodes.
   */
  private ranOnce = false;

  /**
   * The last token this resolved, and what it resolved to.
   *
   * Cached because resolving a token on the client is a document query and, when
   * nothing has emitted the container, an append — repeating that on every
   * reconcile would search the document for a node it already holds. Keyed by the
   * token itself: `portalTarget("modal")` written in the props factory is a new
   * token on every run, and each one looks the container up again, which is how a
   * container a layout has mounted again is found. A token kept in a field is
   * resolved once.
   */
  private resolvedFrom: PortalTarget | undefined;
  private resolvedTo: Element | undefined;

  /** Where the block waits while it has no target — see `leave`. */
  private waiting: DocumentFragment | undefined;

  /** How this portal closes and opens with the ones around it and inside it — see `Nesting`. */
  private readonly nesting = new Nesting(() => this.reconcile());

  /** The real element to render into, whichever form `target` took. */
  private get element(): Element | undefined {
    const target = this.props.target;
    if (!target) return undefined;
    if (!isPortalTarget(target)) return target;

    if (this.resolvedFrom === target && this.resolvedTo !== undefined) return this.resolvedTo;

    // The side this render is for. `ownerRuntime` holds the reason it is read off the OWNER rather
    // than off a module flag, and there is no missing-owner case to decide: the field is required.
    const onServer = ownerRuntime(this).env === "server";
    this.resolvedFrom = target;
    this.resolvedTo = resolvePortalTarget(target, onServer);
    return this.resolvedTo;
  }

  private get region(): ChildrenRegion {
    return (this.area ??= new ChildrenRegion(this[GLOBAL_RUNTIME].owner, "Portal", this.nesting));
  }

  @created({ env: "shared" })
  place(): void {
    this.ranOnce = true;
    this.nesting.enter(this[GLOBAL_RUNTIME].owner);
    this.reconcile();
  }

  /**
   * The client-only twin of `place`, for the one path where the `shared` create
   * above never runs: HYDRATION.
   *
   * Hydrating runs only the `env === "client"` creates — create and mount already
   * ran on the server. That is right for a component, whose DOM the client adopts
   * on the walk down. It is wrong for a portal, whose nodes are in a target the
   * main walk never visits: nothing would adopt them, so the first client update
   * would build a second copy of everything the server already wrote.
   *
   * So this finds the block the server wrote — delimited by the region's anchor
   * COMMENTS, which `renderPage` emits around it — and hands it to the region's
   * hydration, which is the ordinary `hydrateLevel` walk. That is what makes a
   * portalled COMPONENT restore rather than rebuild: only `hydrateComponent`
   * reads the state blob off a host and adopts it as the instance's own.
   *
   * On a NORMAL client build the `shared` create already placed the block, so
   * `ranOnce` is set and this does nothing.
   *
   * Several portals may share one target. Each takes the first UNCLAIMED block —
   * adopts run in the same tree order the server placed in, so the first portal
   * to ask gets the first block — and claiming it is the region taking ownership
   * of those anchors, which puts them out of the next portal's reach.
   */
  @created({ env: "client" })
  adopt(): void {
    if (this.ranOnce) return;
    this.ranOnce = true;
    // An enclosing block is always open while it hydrates its own children, so this starts open.
    this.nesting.enter(this[GLOBAL_RUNTIME].owner);
    const target = this.element;
    // No target: off the page from the start, as a client build of it is — see `leave`.
    if (!target) {
      this.leave();
      return;
    }

    const open = firstUnclaimedBlock(target);
    // No block: the server rendered nothing here (or this page was never server
    // rendered at all). Building is then exactly right, and it is what `place`
    // would have done.
    if (open === undefined) {
      this.reconcile();
      return;
    }

    claimed.add(open);
    this.region.hydrate(this.props.children, target, open);
  }

  /**
   * A new `children` or a new `target`, watched together so a change to both reconciles once.
   *
   * The target needs its own selector: markup that says the same keeps its old object
   * (`helpers/settleMarkup.ts`), so `children` alone would stay quiet when only the target moved —
   * an inline portal aimed at an element the owner's first render produced, or a modal moving to
   * `document.body`.
   */
  @watchProp(
    (props: PortalProps) => props.children,
    (props: PortalProps) => props.target,
  )
  replace(): void {
    this.reconcile();
  }

  @destroyed
  clear(): void {
    this.nesting.detach();
    // Unmounts the block, releases the list regions' scopes, and takes the anchor
    // out. No flush here: a portal clearing itself is part of a larger teardown,
    // whose enclosing flush drains commit-level work once.
    this.area?.dispose();
  }

  /**
   * Brings `target` into line with `children`, touching only the nodes this
   * portal owns.
   *
   * All of it is the region's: the real `reconcileEntries`, so `list()` gets its
   * regions, keyed identity and per-item scopes; the LIS reorder, so a rotation
   * costs the moves it has to and no more; and a target change moving the SAME
   * nodes across, which is how a portal follows a reactive `target` — a modal
   * moving from an inline anchor to `document.body`, or "inline" being nothing
   * more than a target that points at a local element.
   *
   * This used to be hand-rolled here — its own key map, its own positional
   * matching, its own reorder loop — precisely to avoid reaching into the
   * reconciler. That is what made a `ListNode` child crash: it fell into the
   * component branch with no `.name`. The region is that reach, done once and
   * scoped to a block, so nothing here re-implements the diff any more.
   */
  private reconcile(): void {
    const target = this.nesting.suspended ? undefined : this.element;
    if (target) {
      // The children are reconciled while this still counts as closed, and only then is it opened
      // with the portals inside. A portal whose owner the reconcile removes is gone before it would
      // have built what it gained while closed, and one the reconcile builds starts closed and opens
      // after the ones already there, in the order they joined.
      // Opened even when the reconcile throws — the block is back on the page whatever it built — and
      // the reconcile's error is the one that goes on: it is the real failure.
      try {
        this.region.reconcile(this.props.children, target);
      } catch (error) {
        try {
          this.nesting.open();
        } catch (inner) {
          throw new AggregateError([error, inner], "A portal's children and a portal inside it both failed to open");
        }
        throw error;
      }
      this.nesting.open();
      return;
    }
    this.leave();
  }

  /**
   * With no target, the block waits OFF the page, in a fragment of its own.
   *
   * A target that goes away is how a portal is closed — `target: open ? document.body : undefined` —
   * so the block must leave the page with it. It moves, the same nodes, into a fragment, and moves
   * back when a target returns: a component in it keeps its state and is not destroyed. A fragment
   * rather than nowhere, because the nodes keep a parent: a component in the block re-renders on its
   * own state while it waits.
   *
   * The CHILDREN are not reconciled while it waits, only when a target returns — so a component the
   * children gain meanwhile is created on the page, where its `@mounted` can measure and focus. A
   * block whose target is absent from the start is likewise built only when one arrives. A component
   * already IN the block still renders on its own state while it waits, off the page, as every
   * component does — one rule, rather than a paused state to know about.
   */
  private leave(): void {
    if (this.area?.placed) {
      // A fragment of the block's own document: one of this document would adopt every node of a
      // block that lives in an iframe, and adopt them back when it opens.
      const home = this.area.ownerDocument ?? document;
      if (this.waiting?.ownerDocument !== home) this.waiting = home.createDocumentFragment();
      this.area.park(this.waiting as unknown as ChildNode);
    }
    this.nesting.close();
  }
}

/**
 * Server blocks already taken by a portal on this page.
 *
 * A `WeakSet` on the anchor NODE rather than a counter or an attribute: a counter
 * would have to be reset per page and would be wrong the moment a portal mounts
 * later, and an attribute is what this whole change exists to stop relying on.
 * The entry dies with the node.
 */
const claimed = new WeakSet<Comment>();

/** The first block in `target` that no portal has adopted yet. */
function firstUnclaimedBlock(target: Element): Comment | undefined {
  for (let node = target.firstChild; node !== null; node = node.nextSibling) {
    if (!isOpenAnchor(node)) continue;
    const anchor = node as Comment;
    if (!claimed.has(anchor)) return anchor;
  }
  return undefined;
}

/**
 * Portals inside portals close and open together.
 *
 * A modal's dropdown is portalled to a layer of its own, so it is not in the modal's block: closing
 * the modal took the modal off the page and left the dropdown on it, open and clickable. So a portal
 * whose owner renders inside another portal's block joins that one, which closes it when it closes
 * and opens it when it opens — whatever its own target says. The owner knows its block from how it
 * was built (`ComponentRuntime.block`).
 *
 * Its own object rather than members of `Portal`, so none of it is part of the hook anybody can call:
 * `resume()` on a dropdown whose modal is closed would put it back on the page alone.
 */
class Nesting implements EnclosingBlock, NestedBlock {
  /** The block this portal's owner renders in, if any. */
  private outer: EnclosingBlock | undefined;
  /** The portals inside this one's block. */
  private readonly inner = new Set<NestedBlock>();
  /** Whether an enclosing portal is closed, which closes this one whatever its own target. */
  suspended = false;
  /** Whether this block is off the page: its target went away, or an enclosing portal closed. */
  private gone = false;

  constructor(private readonly reconcile: () => void) {}

  get away(): boolean {
    return this.gone;
  }

  join(inner: NestedBlock): void {
    this.inner.add(inner);
  }

  part(inner: NestedBlock): void {
    this.inner.delete(inner);
  }

  /** Leaves the block this one joined — the portal is going. */
  detach(): void {
    this.outer?.part(this);
    this.outer = undefined;
  }

  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.reconcile();
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.reconcile();
  }

  /** Joins the block the owner renders in, and starts closed if that one is. */
  enter(owner: unknown): void {
    const outer = (owner as { [COMPONENT_RUNTIME]?: { block?: EnclosingBlock } } | undefined)?.[COMPONENT_RUNTIME]
      ?.block;
    if (outer === undefined || outer === this) return;
    this.outer = outer;
    outer.join(this);
    this.suspended = outer.away;
  }

  /** On the page again, and the portals inside with it — every one, even past one that throws. */
  open(): void {
    this.gone = false;
    everyOne(this.inner, (inner) => inner.resume(), "open");
  }

  /** Off the page, and the portals inside with it — every one, even past one that throws. */
  close(): void {
    this.gone = true;
    everyOne(this.inner, (inner) => inner.suspend(), "close");
  }
}

/**
 * Runs `step` for every inner portal, and then throws what failed: the one error as it is, or every
 * one of them together — none is dropped, and no portal is skipped because one before it threw.
 */
function everyOne(inner: ReadonlySet<NestedBlock>, step: (one: NestedBlock) => void, doing: string): void {
  const failed: unknown[] = [];
  for (const one of [...inner]) {
    try {
      step(one);
    } catch (error) {
      failed.push(error);
    }
  }
  if (failed.length === 1) throw failed[0];
  if (failed.length > 1)
    throw new AggregateError(failed, `${failed.length} portals inside a portal failed to ${doing}`);
}
