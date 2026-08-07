import { Hook } from "./Hook";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { create, destroy, watchProp } from "./decorators";
import { diffAndMerge, filterVirtualChild, unmountChildrenNodes } from "../core/DiffAndMerge";
import { PORTAL_ATTR } from "../helpers/constants";
import type { EnhancedChildNode, RamondaNode, VNode } from "../types/vdom";

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
 */
export class Portal extends Hook<PortalProps> {
  /** The nodes this portal built, in order — the only record of what it owns. */
  private nodes: ChildNode[] = [];

  @create({ env: "shared" })
  place(): void {
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
   * Single portal per target: the seed is every marked node in the target, so two
   * portals sharing one would each try to own the other's. `Head` resolves its
   * whole chain into ONE portal per document, which is the shape this serves.
   */
  @create({ env: "client" })
  adopt(): void {
    if (this.nodes.length > 0) return;
    const target = this.props.target;
    if (!target) return;

    this.nodes = Array.from(target.querySelectorAll(`[${PORTAL_ATTR}]`)) as ChildNode[];
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
   * Positional against the previous list: child `i` is diffed against the node
   * built for slot `i` last time, which reuses it in place when the shape agrees
   * (a `<meta>` staying a `<meta>` just has its attributes updated). A node the
   * reconciler hands back unchanged is already in `target`; a fresh or replaced
   * one is detached, so it is appended. Anything the new list no longer accounts
   * for is unmounted — `@destroy` and all — and removed.
   */
  private reconcile(): void {
    const owner = this[GLOBAL_RUNTIME].owner;
    const target = this.props.target;
    const raw = this.props.children;
    if (!target) return;

    const list = Array.isArray(raw) ? raw : [raw];
    const previous = this.nodes;
    const next: ChildNode[] = [];

    let slot = 0;
    for (const rawChild of list) {
      const vchild = filterVirtualChild(rawChild);
      if (vchild === undefined) continue;

      const existing = previous[slot];
      slot++;

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

      next.push(node);
    }

    // Whatever the new list did not reuse: torn down and taken out of the target.
    const kept = new Set(next);
    const stale: EnhancedChildNode[] = [];
    for (const node of previous) {
      if (!kept.has(node)) stale.push(node as EnhancedChildNode);
    }
    if (stale.length > 0) unmountChildrenNodes(stale);

    this.nodes = next;
  }
}
