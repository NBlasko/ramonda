import { Hook } from "./Hook";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { created, destroyed, watchProp } from "./decorators";
import { filterVirtualChild } from "../core/DiffAndMerge";
import { ChildrenRegion } from "../core/childrenRegion";
import { PORTAL_ATTR, KEY_SYM, ORIGIN_SYM } from "../helpers/constants";
import type { ComponentChild, RamondaNode } from "../types/vdom";

export interface PortalProps {
  /**
   * What to render into `target`. A single vnode, a string, or an array of them
   * — whatever an expression slot already accepts, because that is where a
   * caller builds it: `this.use(Portal, () => ({ children: <title>{t}</title>, target }))`.
   */
  children: RamondaNode;
  /** The element the children are rendered INTO, rather than where the hook sits. */
  target: Element;
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
 * without adopting the shell's tags and every other portal's. Instead this keeps
 * its own ordered list of the nodes it built and reconciles only those. Two
 * portals into one target therefore coexist, and neither touches what was there
 * before them — which is the property `Head` needs and the registry used to fake.
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
 * There is no synthetic event layer — `@onElement` attaches a real listener to a
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
   * So this seeds `nodes` from the tags the server left in the target — found by
   * `PORTAL_ATTR`, which `renderPage` emitted — and reconciles against them, which
   * reuses each in place. On a NORMAL client build the `shared` create already
   * filled `nodes`, so this finds them present and does nothing: the reconcile
   * that matters has happened, and adopting on top would be a second one.
   *
   * Several portals may share one target: this takes only its OWN block — the first
   * `children.length` still-marked nodes — and CLAIMS them by removing the marker,
   * so the next portal (adopts run in the same tree order the server placed in)
   * finds its own block at the front. See the loop for the detail.
   */
  @created({ env: "client" })
  adopt(): void {
    if (this.placed) return;
    this.placed = true;
    const target = this.props.target;
    if (!target) return;

    // Take only THIS portal's own server nodes — the first `children.length` marked
    // nodes still unclaimed — not every marked node in the target. Seeding from all
    // of them let the first portal into a shared target sweep a sibling's tags away
    // and the sibling rebuild onto what was left. Claimed by removing the marker, so
    // the next portal (adopts run in the same tree order the server placed in) skips
    // this block and finds its own at the front. Keys are stamped from the matching
    // child so a keyed reconcile finds each node instead of building a duplicate.
    // One marked node per ELEMENT child, in order — NOT one per child. A string
    // child is an unmarked text node the server never emitted, so counting it would
    // claim a node too many and eat the next portal's block. Skip it here; the
    // client rebuilds it in `reconcile`.
    const children = this.childList();
    const marked = target.querySelectorAll(`[${PORTAL_ATTR}]`);
    const mine: ChildNode[] = [];
    let m = 0;
    for (const child of children) {
      if (typeof child === "string") continue;
      if (m >= marked.length) break;
      const element = marked[m++];
      element.removeAttribute(PORTAL_ATTR);
      if (child.attributes?.key != null) (element as unknown as KeyedNode)[KEY_SYM] = child.attributes.key;
      // Whose render built it. A node parsed from server markup carries no
      // origin, and the reconciler refuses to match a vnode against a node
      // somebody else built — so without this the reconcile rebuilds every tag
      // it just adopted and leaves the server's beside it. `hydrateNode` stamps
      // it for the same reason on the main walk, which this is the portal's twin
      // of; the value has to be the CHILD's, not the owner's, because that is
      // what the vnode about to be matched carries.
      (element as unknown as OriginNode)[ORIGIN_SYM] = (child as unknown as OriginNode)[ORIGIN_SYM];
      mine.push(element as unknown as ChildNode);
    }

    this.region.seed(mine, target);
    this.reconcile();
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
    const target = this.props.target;
    if (!target) return;

    // Which nodes the block already held, so only the ones this pass BUILT get
    // marked below. Reasserting the marker on every node instead is wrong in a
    // way that only shows up with two portals in one target: `adopt` claims a
    // server node by REMOVING its marker, so re-adding it puts the node back in
    // the pool and the next portal to adopt takes it. Measured — the second
    // portal adopted the first's <meta> and both rendered the same tag.
    const held = this.region.nodes.length === 0 ? undefined : new Set(this.region.nodes);

    this.region.reconcile(this.props.children, target);

    // Marked so the server renderer collects it and the client finds it to adopt.
    // Elements only; text has no attributes.
    for (const node of this.region.nodes) {
      if (node.nodeType === 1 && held?.has(node) !== true) (node as Element).setAttribute(PORTAL_ATTR, "");
    }
  }

  /**
   * The children as a flat run of real nodes-to-be — arrays flattened, holes
   * dropped. Only `adopt` needs it now, for how many server nodes are its own and
   * what key each carries; `reconcile` hands the children over untouched, so the
   * region normalizes them exactly as a render would.
   */
  private childList(): ComponentChild[] {
    const flat: unknown[] = [];
    flattenChildren(this.props.children, flat);

    const out: ComponentChild[] = [];
    for (const raw of flat) {
      const child = filterVirtualChild(raw);
      if (child !== undefined) out.push(child);
    }
    return out;
  }
}

/** A portal node carrying the key it was matched by, so the next render can find it. */
type KeyedNode = ChildNode & { [KEY_SYM]?: unknown };

/** Either side of the match: the vnode knows its origin, the adopted node is told it. */
type OriginNode = { [ORIGIN_SYM]?: number };

/**
 * Flattens `children` into a single run of atoms, so a nested array — `{[a, [b,
 * c]]}` — is counted as the atoms it contains.
 */
function flattenChildren(raw: unknown, out: unknown[]): void {
  if (Array.isArray(raw)) {
    for (const child of raw) flattenChildren(child, out);
  } else {
    out.push(raw);
  }
}
