import { Hook } from "./Hook";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { create, destroy, watchProp } from "./decorators";
import { diffAndMerge, filterVirtualChild, unmountChildrenNodes } from "../core/DiffAndMerge";
import { PORTAL_ATTR, KEY_SYM } from "../helpers/constants";
import type { ComponentChild, EnhancedChildNode, RamondaNode, VNode } from "../types/vdom";

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
 * context and render side, and gets `@create`, `@mount`, signals and `@destroy`
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
 * `@create` (env `shared`, so a server render places the children too) does the
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
  /** The nodes this portal built, in order — the only record of what it owns. */
  private nodes: ChildNode[] = [];
  /**
   * Whether the first reconcile has run. NOT `nodes.length`, which cannot tell
   * "placed, and it came to nothing" from "never placed": a portal whose children
   * resolve to an empty list still ran, and on a client build must NOT then take
   * the hydration `adopt` path and sweep up every other portal's marked nodes.
   */
  private placed = false;
  /**
   * The target the nodes are currently IN, so a change of `target` moves them
   * rather than leaving a copy behind. `undefined` until the first successful
   * placement, which also means a `target` that was missing at mount and appears
   * later is simply the first placement, not a move.
   */
  private currentTarget: Element | undefined;

  @create({ env: "shared" })
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
  @create({ env: "client" })
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
      mine.push(element as unknown as ChildNode);
    }

    this.nodes = mine;
    this.reconcile();
  }

  @watchProp((props: PortalProps) => props.children)
  replace(): void {
    this.reconcile();
  }

  @destroy
  clear(): void {
    if (this.nodes.length === 0) return;
    unmountChildrenNodes(this.nodes as EnhancedChildNode[]);
    this.nodes = [];
  }

  /**
   * Brings `target` into line with `children`, touching only the nodes this
   * portal owns.
   *
   * Matched by KEY where a child has one, and by position otherwise — the same
   * rule the main children diff uses, so a reordered list of keyed children keeps
   * each node (and its component state) with its key instead of a neighbour taking
   * its contents. A keyed node the render still asks for is reused wherever it was;
   * an unkeyed one is matched to the next unclaimed unkeyed node in order. What the
   * diff hands back unchanged is already in `target`; a fresh or replaced node is
   * detached, so it is appended and then moved into place. Anything the new list no
   * longer accounts for is unmounted — `@destroy` and all — and removed.
   */
  private reconcile(): void {
    const owner = this[GLOBAL_RUNTIME].owner;
    const target = this.props.target;
    if (!target) return;

    // The target moved: bring the nodes we already own across before reconciling,
    // so the SAME node (and its state) relocates instead of a stale copy staying
    // behind. This is how a portal follows a reactive `target` — a modal moving
    // from an inline anchor to `document.body`, or "inline" being nothing more than
    // a target that points at a local element. A target absent at mount and
    // supplied later is not a move: `currentTarget` is still undefined, so this is
    // the first placement.
    if (this.currentTarget !== undefined && this.currentTarget !== target) {
      for (const node of this.nodes) target.appendChild(node);
    }
    this.currentTarget = target;

    // Split the previous nodes into what a key can find and what only position can:
    // a keyed child looks its node up regardless of where it moved, an unkeyed one
    // takes the next unclaimed unkeyed node.
    const previous = this.nodes;
    const byKey = new Map<string, ChildNode>();
    const unkeyed: ChildNode[] = [];
    for (const node of previous) {
      const key = (node as KeyedNode)[KEY_SYM];
      if (key != null) byKey.set(String(key), node);
      else unkeyed.push(node);
    }
    let unkeyedCursor = 0;

    const children = this.childList();
    const next: ChildNode[] = [];

    for (const vchild of children) {
      const key = typeof vchild === "string" ? undefined : vchild.attributes?.key;
      const keyed = key != null;

      let existing: ChildNode | undefined;
      if (keyed) {
        existing = byKey.get(String(key));
        byKey.delete(String(key));
      } else if (typeof vchild === "string") {
        // A text child reuses only a text node. On a hydration seed made of adopted
        // ELEMENTS there is none at the cursor, so build fresh WITHOUT consuming the
        // element the following element child owns — otherwise the string strands it
        // and it is swept as stale.
        const candidate = unkeyed[unkeyedCursor];
        if (candidate !== undefined && candidate.nodeType === 3) {
          existing = candidate;
          unkeyedCursor++;
        }
      } else {
        existing = unkeyed[unkeyedCursor++];
      }

      let node: ChildNode;
      if (typeof vchild === "string") {
        if (existing !== undefined && existing.nodeType === 3) {
          if (existing.textContent !== vchild) existing.textContent = vchild;
          node = existing;
        } else {
          node = document.createTextNode(vchild);
          target.appendChild(node);
        }
      } else {
        node = diffAndMerge(vchild as VNode, owner, existing as EnhancedChildNode | undefined) as ChildNode;
        // Detached when it is fresh or a replacement — the reconciler builds
        // without inserting. An in-place reuse hands back `existing`, already here.
        if (node !== existing) {
          // Marked so the server renderer collects it and the client finds it to
          // adopt. Only a fresh node needs it — a reused one, or an adopted server
          // node, already carries it. Elements only; text has no attributes.
          if (node.nodeType === 1) (node as Element).setAttribute(PORTAL_ATTR, "");
          target.appendChild(node);
        }
      }

      // Remember the key ON the node, so the next render can find it wherever it
      // ends up — and clear a stale one if a child that was keyed no longer is.
      (node as KeyedNode)[KEY_SYM] = keyed ? key : undefined;
      next.push(node);
    }

    // Whatever the new list did not reuse: torn down and taken out of the target.
    const kept = new Set(next);
    const stale: EnhancedChildNode[] = [];
    for (const node of previous) {
      if (!kept.has(node)) stale.push(node as EnhancedChildNode);
    }
    if (stale.length > 0) unmountChildrenNodes(stale);

    // Line the DOM up with `next`. The last node anchors the block where it is; the
    // rest are moved before it only when out of place, so an unchanged order — the
    // common render — costs no moves at all.
    for (let i = next.length - 2; i >= 0; i--) {
      const node = next[i];
      const shouldPrecede = next[i + 1];
      if (node.nextSibling !== shouldPrecede) target.insertBefore(node, shouldPrecede);
    }

    this.nodes = next;
  }

  /**
   * The children as a flat run of real nodes-to-be — arrays flattened, holes
   * (`null`/`false`/`undefined`) dropped. Shared by `reconcile`, which walks it,
   * and `adopt`, which needs its length and each child's key.
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

/**
 * Flattens `children` into a single run of atoms, so a nested array — `{[a, [b,
 * c]]}` — is not handed to `diffAndMerge`, which expects one vnode and would
 * build `new Component(array)`. One flat list keeps the positional match simple
 * and matches what an expression slot already does with arrays.
 */
function flattenChildren(raw: unknown, out: unknown[]): void {
  if (Array.isArray(raw)) {
    for (const child of raw) flattenChildren(child, out);
  } else {
    out.push(raw);
  }
}
