import { Hook } from "./Hook";
import { ownerRuntime } from "../core/renderEnv";
import { GLOBAL_RUNTIME } from "../core/runtime";
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
 * first reconcile; `@watchProp` on `children` does every later one. Because the
 * props factory is cached on the signals it read, `children` only gets a new
 * identity when something it depends on actually moved — so an unrelated render
 * of the owner does not re-reconcile. When the head DID change, the owner's
 * render is the cost, and that is accepted: a portal is a portal.
 *
 * ## A reactive `target`, and "inline"
 *
 * `target` may change: point it at `document.body` on desktop and a local element
 * on mobile, and the nodes MOVE — the same DOM node, keeping its state, not a
 * second copy. That is also how "inline" is done: there is no `disabled` flag,
 * because a hook has no position of its own to fall back to, so instead you aim
 * `target` at an element in your own render. A `target` absent at mount and
 * supplied later is placed then, not lost. (A target change is noticed through the
 * same `children` signal, which a props factory rebuilds each run; a factory
 * returning a genuinely STABLE `children` while only `target` moves would not
 * re-reconcile — the uncommon case, worth knowing.)
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
  private placed = false;

  /**
   * The last token this resolved, and what it resolved to.
   *
   * Cached because resolving a token on the client is a document query and, when
   * nothing has emitted the container, an append — repeating that on every
   * reconcile would search the document for a node it already holds, and a
   * container removed from under it would be replaced by a second one rather
   * than reported.
   */
  private resolvedFrom: PortalTarget | undefined;
  private resolvedTo: Element | undefined;

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
    return (this.area ??= new ChildrenRegion(this[GLOBAL_RUNTIME].owner, "Portal"));
  }

  @created({ env: "shared" })
  place(): void {
    this.placed = true;
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
   * `placed` is set and this does nothing.
   *
   * Several portals may share one target. Each takes the first UNCLAIMED block —
   * adopts run in the same tree order the server placed in, so the first portal
   * to ask gets the first block — and claiming it is the region taking ownership
   * of those anchors, which puts them out of the next portal's reach.
   */
  @created({ env: "client" })
  adopt(): void {
    if (this.placed) return;
    this.placed = true;
    const target = this.element;
    if (!target) return;

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

  @watchProp((props: PortalProps) => props.children)
  replace(): void {
    this.reconcile();
  }

  @destroyed
  clear(): void {
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
    const target = this.element;
    if (!target) return;

    this.region.reconcile(this.props.children, target);
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
