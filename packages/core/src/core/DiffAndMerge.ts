import { resolveStable } from "../helpers/common";
import { applyChangesOnAttributes } from "./Attribute";
import type {
  BaseComponent,
  ComponentChild,
  EnhancedHTMLNode,
  EnhancedNode,
  MaybeEnhancedNode,
  ComponentClassKind,
  VNode,
  VNodeComponent,
  EnhancedChildNode,
  MaybeComponent,
  VNodeString,
  EnhancedSVGElement,
  ListRegion,
  ComponentRegion,
  RecordEntry,
} from "../types/vdom";
import { addTaskToQueue } from "./Task";
import { errorHandler } from "./errorHandler";
import { arePropsBagsEqual } from "../helpers/arePropsBagsEqual";
import {
  DONE,
  TEXT_TYPE,
  svgNamespaceUri,
  IS_SVG,
  KEY_SYM,
  SLOT_SYM,
  BLOCK_CLOSE,
  HAS_REGION,
  COMPONENT_TYPE,
  CHILD_RECORD,
  ORIGIN_SYM,
  REF_SYM,
  PROPS_GATE,
  STABLE_PROPS,
} from "../helpers/constants";
import { generateRenderOutput } from "../helpers/generateRenderOutput";
import { isListNode, isVNode } from "../vdom/guards";
import { queuePostCommit, flushAfterCommit } from "./commit";
import { lifecycleCleanupManagement } from "../helpers/lifecycleMenagement";
import { checkNesting } from "../debug/domNesting";
import { seedWatchProps } from "../helpers/watchProps";
import type { Context } from "../types/commonTypes";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME } from "./runtime";
import { runComponentEffects } from "../reactivity/effect";
import { getRenderEnv } from "./renderEnv";
import { getServerWorkCollector } from "./serverWork";
import { ListEngine, isLazyList, buildLazyList, type LazyListNode, type ListHost } from "../helpers/listEngine";
import { snapshotOwnProps, lintUnpersistedState } from "../hydration/lint";
import { lintChildKeys } from "../debug/lintChildren";
import { timerOwner } from "../debug/timerGuard";
import type { Runtime } from "./runtime";

type PropsGate = (self: unknown, previous: unknown, next: unknown) => boolean;

/**
 * Brings one ELEMENT into line with its vnode. Components do not come through here.
 *
 * A component owns a range rather than a node, so it is reconciled where ranges live —
 * `reconcileEntries`, beside a list — and it never has a node for this to be handed. What is left
 * here is exactly what it always did for markup: attributes, then children.
 */
export function diffAndMerge(
  vnode: VNode,
  placeholderComponent: MaybeComponent,
  maybeenhancedNode: MaybeEnhancedNode | EnhancedChildNode,
): EnhancedNode | EnhancedChildNode {
  if (vnode.type === TEXT_TYPE) {
    return executeChangesOnStringNode(vnode, placeholderComponent, maybeenhancedNode);
  }

  /**
   * A component reached the node path, which means a children array lost its `HAS_REGION` mark.
   *
   * Loud rather than silent: without the mark the parent keeps no record, so the component would be
   * built with nowhere to say which nodes are its own — and the failure would surface much later, as
   * a sibling adopting its nodes. Every producer of a children array stamps the flag
   * (`normalizeChildren`, `generateRenderOutput`), so reaching this is a framework bug.
   */
  throw new Error(
    `[Ramonda] <${(vnode.name as { name?: string })?.name ?? "component"}> reached the element diff. ` +
      "A component is a region and is reconciled by reconcileEntries; the children array it arrived " +
      "in was not marked as holding one.",
  );
}

/**
 * Mounts a root into a container, and leaves the record that describes it.
 *
 * The ordinary level reconcile, given one child and an empty history — so a root may be a component,
 * an element, a list or a string, exactly as any child may. A component is a range, so what a root
 * leaves behind is a record rather than the one node it used to be.
 *
 * `bootstrap`, `renderToString` and the test harness all enter here.
 */
export function mountRoot(vnode: ComponentChild, container: ChildNode): void {
  const unclaimed: (EnhancedChildNode | DONE)[] = [];
  const result = reconcileEntries([vnode], [], undefined, undefined, container, unclaimed);
  (container as EnhancedChildNode)[CHILD_RECORD] = result.entries;

  // Appended rather than reordered: a root mount has an empty container and nothing to move, so
  // there is no teardown for an insertion to race with.
  const ordered: ChildNode[] = [];
  flattenEntries(result.entries, ordered);
  for (const child of ordered) container.appendChild(child);
}

/**
 * The component whose block a node sits in — the innermost one, when they nest.
 *
 * The reverse of the record, and it has to be computed rather than read: a node no longer carries a
 * back-reference to a component, because a component is not a node. Nothing in the render path needs
 * this — the diff walks the record forwards — so it is deliberately a search rather than a map
 * maintained on every mount. Its callers are the devtools inspector and the test harness, both of
 * which start from "the user clicked this node".
 *
 * The search stops at the FIRST record that answers, and that is what makes the answer the deepest
 * one. Records are met innermost-first while climbing, and the component that owns a node has its
 * region in the record of that node's own DOM parent — so the first hit is already the innermost
 * component. Carrying on would find every ancestor component too and overwrite the real answer with
 * the root: measured, `componentAt(span)` said `Two` where `Counter` owns the span.
 */
export function componentAt(node: Node): BaseComponent | undefined {
  let found: BaseComponent | undefined;

  const search = (entries: RecordEntry[]): void => {
    for (const entry of entries) {
      if (!isRegion(entry)) continue;

      const nodes: ChildNode[] = [];
      flattenEntries([entry], nodes);
      if (!nodes.some((one) => one === node || one.contains(node))) continue;

      if (isComponentRegion(entry)) found = entry.instance;
      search(entry.entries);
    }
  };

  for (let at: Node | null = node; at !== null; at = at.parentNode) {
    const record = (at as EnhancedChildNode)[CHILD_RECORD];
    if (record === undefined) continue;
    search(record);
    if (found !== undefined) return found;
  }

  /**
   * The MOUNT CONTAINER, which no component's range covers — it is the thing the root was rendered
   * into, not part of what anything rendered. Asking about it means asking for the root, which is
   * what a test harness and a devtools panel both want, so the record it holds is read directly
   * rather than answering `undefined` for the one node a caller is most likely to start from.
   */
  if (found === undefined) {
    for (const entry of (node as EnhancedChildNode)[CHILD_RECORD] ?? []) {
      if (isRegion(entry) && isComponentRegion(entry)) return entry.instance;
    }
  }

  return found;
}

/**
 * Every component under a node, outermost first, in document order.
 *
 * The record read as a tree, which is the only way to see a component that owns NO nodes: a render
 * that returned `null` is a live component with state and a lifecycle, and `componentAt` can never
 * answer for it because there is no node to ask about. Nothing in the render path needs this either —
 * it is for the devtools tree and for a harness that wants to name a component rather than point at
 * a node.
 */
export function componentsIn(node: Node): BaseComponent[] {
  const found: BaseComponent[] = [];

  const walk = (entries: RecordEntry[]): void => {
    for (const entry of entries) {
      if (!isRegion(entry)) {
        // A plain element, which may hold components deeper down. It keeps a record only when a
        // component is among its OWN children — an element in between keeps none, so descending has
        // to go through the DOM until the next record turns up. Reading only the record here missed
        // every component under an intermediate element: measured on `<div><section><Child/>`.
        found.push(...componentsIn(entry));
        continue;
      }
      if (isComponentRegion(entry)) found.push(entry.instance);
      walk(entry.entries);
    }
  };

  const record = (node as EnhancedChildNode)[CHILD_RECORD];
  if (record === undefined) {
    // No record of its own: the walk goes through the DOM, and a comment child is descended into
    // like any other — the block published on it is read by the branch below, one level down.
    for (const child of Array.from(node.childNodes)) found.push(...componentsIn(child));
    return found;
  }

  walk(record);

  /**
   * A `ChildrenRegion`'s block, published on its opening anchor.
   *
   * Its record is the region's own, so this node's record does not describe it — a portal writes
   * into a target it SHARES, and a walk that read only the parent's record lost the portalled
   * component entirely, where the old DOM walk found it through the back-reference on a node.
   *
   * Only on this branch. Where the node has no record the loop above already descends into the
   * comment, and doing both visited every block twice: the harness reported one portalled component
   * as two, and the devtools tree drew it twice.
   */
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 8) continue;
    const block = (child as EnhancedChildNode)[CHILD_RECORD];
    if (block !== undefined) walk(block);
  }

  return found;
}

/**
 * Reconciles a root that is already mounted, against the record its container holds.
 *
 * What `rerenderRoot` needs, and it cannot be the ordinary element path: the container is not
 * something a render produced, so there is no vnode for it — only the one entry inside it.
 */
export function rerenderRoot(vnode: ComponentChild, container: ChildNode): void {
  const node = container as EnhancedChildNode;
  const previous = node[CHILD_RECORD] ?? [];
  const unclaimed: (EnhancedChildNode | DONE)[] = [];
  const result = reconcileEntries([vnode], previous, undefined, undefined, container, unclaimed);
  node[CHILD_RECORD] = result.entries;

  unmountChildrenNodes(unclaimed, false);

  if (result.changed || unclaimed.length > 0) {
    const ordered: ChildNode[] = [];
    flattenEntries(result.entries, ordered);
    reorderChildren(container, ordered);
  }
}

/**
 * Brings a component's own block into line, for a render nobody else asked for.
 *
 * A component re-rendering itself is not reached through its parent, so it reconciles its own
 * entries and restores the order of its own run of nodes inside a parent it shares with its
 * siblings. `reorderChildren` takes both halves of what that needs: the trailing anchor, so
 * insertions land inside the block, and the previous order as the position map.
 */
export function refreshComponentRegion(component: BaseComponent): void {
  const region = component[COMPONENT_RUNTIME].region;
  if (region === undefined) return;
  const parent = region.parent;
  if (parent === undefined) return;

  /**
   * What this block holds right now, DERIVED rather than remembered, and read before anything moves.
   *
   * `entries` still describe the previous pass at this point — the reconcile below replaces them —
   * and every region keeps its own entries current, so flattening walks into a descendant that
   * re-rendered on its own and gets what is really in the document. That is the whole reason there is
   * no cached order: a cache is correct only for the region that last wrote it.
   */
  const before: ChildNode[] = [];
  flattenEntries(region.entries, before);

  /**
   * And the anchor comes from that same reading, BEFORE anything is unmounted, because the answer is
   * a NEIGHBOUR of the nodes about to go. Asked afterwards it saw a detached node, whose
   * `nextSibling` is `null` — which reads as "the end of the parent", so fresh markup was appended
   * past every later sibling. Measured on two `AsyncLoad`s side by side: they came back `[two][one]`.
   */
  const anchor = anchorAfterRegion(region, parent, before);

  const children = generateRenderOutput(component);
  const unclaimed: (EnhancedChildNode | DONE)[] = [];
  const result = reconcileEntries(children, region.entries, undefined, component, parent, unclaimed);
  region.entries = result.entries;

  // Before the reorder, for the reason the element path has: stale nodes still in the DOM make
  // correctly-placed ones look misplaced and cause pointless moves.
  unmountChildrenNodes(unclaimed, false);

  const ordered: ChildNode[] = [];
  flattenEntries(region.entries, ordered);

  if (result.changed || unclaimed.length > 0) {
    reorderChildren(parent, ordered, anchor, before);
  }
}

/**
 * The node a fresh child of this region has to land in front of.
 *
 * Cheap in the case that happens: the block owns nodes, so the node after its last one is the
 * answer and one property read finds it.
 *
 * The EMPTY block is the one that cannot be answered from the DOM — a component whose render
 * returned nothing owns no node, so there is nothing to read a `nextSibling` from, and its position
 * exists only in its parent's record. So the record is walked, in order, and the first node past
 * this region is taken. `null` means the end of the parent, which is what `insertBefore` wants for
 * an append. This is the only place the framework searches for a position rather than carrying one,
 * and it is reached only on the render where an empty component starts producing markup.
 */
function anchorAfterRegion(region: ComponentRegion, parent: ChildNode, held: readonly ChildNode[]): ChildNode | null {
  const last = held[held.length - 1];
  if (last !== undefined) return last.nextSibling;

  const own = (parent as EnhancedChildNode)[CHILD_RECORD];
  if (own !== undefined) {
    const found = nextNodeAfter(own, region);
    if (found !== NOT_IN_RECORD) return found;
  }

  /**
   * A `ChildrenRegion`'s block, whose record is its own rather than the parent's.
   *
   * A portalled component is not in the target's record at all, so the search above cannot find it —
   * and answering `null` means "the end of the parent", which put the node PAST every other block in
   * a shared target. It escaped its own anchors, so `dispose()` did not take it away with the rest.
   *
   * The block publishes its record on its opening anchor, and the answer inside a block that has
   * nothing after this region is the block's CLOSE: that is what keeps the node inside its own
   * anchors, and it is the same node `ChildrenRegion` reorders against.
   */
  for (const child of parent.childNodes) {
    if (child.nodeType !== 8) continue;
    const block = (child as EnhancedChildNode)[CHILD_RECORD];
    if (block === undefined) continue;
    const found = nextNodeAfter(block, region);
    if (found !== NOT_IN_RECORD) return found ?? blockCloseOf(child) ?? null;
  }

  return null;
}

/** The closing anchor of the block published on this opening one. See `BLOCK_CLOSE`. */
export function blockCloseOf(open: Node): ChildNode | undefined {
  return (open as unknown as { [BLOCK_CLOSE]?: ChildNode })[BLOCK_CLOSE];
}

/** Says the region is not in this record at all, which is not the same as "nothing follows it". */
const NOT_IN_RECORD = Symbol("notInRecord");

/**
 * The first node after `region` within `entries`, `null` when it is there with nothing after it, and
 * `NOT_IN_RECORD` when it is not in this record.
 *
 * The three answers have to be told apart. Collapsing the last two into `null` is what let a
 * portalled component — absent from the parent's record — be read as "found, and last", which is an
 * append at the end of the parent.
 *
 * The search is over the record in DOCUMENT order, and it does not stop at the level the region sits
 * on: a nested region that holds the region and nothing after it answers nothing, and the answer is
 * then the next entry of the level ABOVE. Reading that "nothing" as the final answer is what made an
 * empty component one level down append past its owner's later siblings — measured on
 * `<div><Wrapper /><u>after</u></div>`, where `Wrapper` renders the empty component and its first
 * markup landed as `<u>after</u><b>here</b>`.
 *
 * So `walk` returns a NODE or nothing, and whether the region was seen at all is `passed`, which is
 * shared across the levels — the same flag that keeps a node BEFORE the region from being returned by
 * a recursion into an earlier sibling region.
 */
function nextNodeAfter(entries: RecordEntry[], region: ComponentRegion): ChildNode | null | typeof NOT_IN_RECORD {
  let passed = false;

  const walk = (level: RecordEntry[]): ChildNode | null => {
    for (const entry of level) {
      if (entry === (region as RecordEntry)) {
        passed = true;
        continue;
      }
      if (isRegion(entry)) {
        const found = walk(entry.entries);
        if (found !== null) return found;
        continue;
      }
      if (passed) return entry;
    }
    return null;
  };

  const answer = walk(entries);
  return passed ? answer : NOT_IN_RECORD;
}

/**
 * Builds a child WITHOUT putting it in the document.
 *
 * Used by the children diff, where insertion is deliberately left to
 * `reorderChildren` — which runs after the unclaimed nodes have been unmounted.
 * Appending here instead meant a replacement was in the document while the node
 * it replaces was still being torn down, so `@destroyed` saw both: measured as
 * `document: 1|2` where it must see only `1`.
 *
 * `parent` is taken but not written to: the DEV placement check needs to know
 * where the node is going, and this is the only moment both are in hand.
 */
function buildDetachedNode(
  vchild: ComponentChild,
  placeholderComponent: MaybeComponent,
  parent: ChildNode,
): ChildNode | undefined {
  try {
    if (typeof vchild === "string") {
      return document.createTextNode(vchild);
    }

    const diff = diffAndMerge(vchild, placeholderComponent, undefined);
    if (__DEV__) checkNesting(parent, diff);
    return diff;
  } catch (e) {
    errorHandler(e, placeholderComponent);
  }
}

function executeChangesOnStringNode(
  vnode: VNodeString,
  placeholderComponent: MaybeComponent,
  maybeenhancedNode: MaybeEnhancedNode | EnhancedChildNode,
) {
  const enhancedNode = maybeenhancedNode?.nodeName === vnode.name ? maybeenhancedNode : createElement(vnode);

  // The side this element is being built for, taken from the component that owns it rather than
  // from the module-level flag: `renderEnv` is restored before the first `await`, so a re-render
  // drained later would read "client" whichever side it is really on. The runtime's `env` is
  // inherited down the tree and survives the drain — see `createComponent`.
  const onServer = placeholderComponent?.[COMPONENT_RUNTIME]?.env === "server";

  applyChangesOnAttributes(enhancedNode, vnode.attributes, onServer);

  const vnodeChildren = vnode.children;

  const { cloneChildren, orderedNodes } = applyDiffOnChildren(vnodeChildren, placeholderComponent, enhancedNode);

  // Unmount before reordering: stale nodes still in the DOM would make
  // correctly-placed nodes look misplaced and cause pointless moves.
  unmountChildrenNodes(cloneChildren, false);
  if (orderedNodes !== null) reorderChildren(enhancedNode, orderedNodes);

  return enhancedNode;
}

function createElement(vnodeString: VNodeString): SVGElement | HTMLElement {
  // Stamped at CREATION only. A component re-rendering itself produces a fresh
  // host vnode carrying its OWN id, and writing that on every update would erase
  // the origin buildComponent set — the caller's id, which is the one that
  // matters for matching.
  if (vnodeString.attributes[IS_SVG]) {
    const node: EnhancedSVGElement = document.createElementNS(svgNamespaceUri, vnodeString.name);
    node[IS_SVG] = true;
    node[ORIGIN_SYM] = vnodeString[ORIGIN_SYM];
    return node;
  }

  /**
   * Lowercased HERE, at creation, rather than left uppercase on the vnode.
   *
   * `h` uppercases an HTML tag on purpose: a real node reports `nodeName` in uppercase, the diff
   * compares against it on every pass, and doing the conversion once at construction beats doing it
   * on every comparison. So the vnode keeps its uppercase name and the hot path is untouched.
   *
   * But `createElement` is not the hot path — an element is built once and diffed many times — and
   * what it is given is what a partial DOM will serialize. A browser and jsdom lowercase a created
   * element's local name in an HTML document, so we have been leaning on them to normalise; linkedom
   * keeps what it is handed, and served `<DIV id="page">`. Valid HTML, and identical once parsed
   * (measured), but nobody should open view-source on a page we served and find it shouting.
   *
   * The SVG branch above must NOT get this: SVG names are case-sensitive — `linearGradient`,
   * `clipPath`, `foreignObject` — and `h` never uppercases them for exactly that reason.
   */
  const node = document.createElement(vnodeString.name.toLowerCase()) as EnhancedHTMLNode;
  node[ORIGIN_SYM] = vnodeString[ORIGIN_SYM];
  return node;
}

export function filterVirtualChild(rawChild: unknown): ComponentChild | undefined {
  const typeofChild = typeof rawChild;
  if (
    // Loose on purpose: one check for both null and undefined.
    rawChild == null ||
    typeofChild === "boolean" ||
    typeofChild === "function"
  )
    return;
  if (typeofChild !== "string" && typeofChild !== "object") {
    // A number, a bigint or a symbol: everything left here has a `toString`, which the
    // `typeof` above is what establishes.
    return String(rawChild) as ComponentChild;
  }
  return rawChild as ComponentChild;
}

function applyDiffOnChildren(vnodeChildren: unknown[], placeholderComponent: MaybeComponent, enhancedNode: ChildNode) {
  if (__DEV__) {
    lintChildKeys(vnodeChildren, placeholderComponent);
  }

  const owner = enhancedNode as EnhancedChildNode;
  // O(1): `flattenMixedArray` marked the array when it kept a region in it — a list, or a
  // component. The record check catches the render where the last one just disappeared.
  const hasRegion = (vnodeChildren as { [HAS_REGION]?: boolean })[HAS_REGION] === true;

  if (hasRegion || owner[CHILD_RECORD] !== undefined) {
    return applyDiffWithRegions(vnodeChildren, placeholderComponent, owner, hasRegion);
  }

  /**
   * The pool to claim from: this element's children, MINUS the ones it does not own.
   *
   * An element may hold a `ChildrenRegion`'s block — a `Portal` aimed at a node in the owner's own
   * render, which is how "inline" is done, and the `Head` hook's tags in a head that also holds the
   * shell's. A block keeps its record on its opening anchor rather than on the element, because a
   * target is SHARED and cannot be any one region's, so this element's record says nothing about it.
   *
   * Read as ordinary children, the whole block is this render's leftovers: its anchors and nodes are
   * unmounted, and `releaseChildRecord` on the anchor runs `@destroyed` for every component inside
   * it while the portal still believes them mounted. Measured on a portal aimed at a `<section>` the
   * owner renders: the block was gone on the render that placed it. A node inside it can also be
   * CLAIMED rather than removed, when it happens to match a tag this element renders — the same
   * origin, because the same component built both.
   *
   * The block publishes where it ends (`BLOCK_CLOSE`) on the anchor a walk finds first, so the run
   * is skippable in one pass. A comment is left out either way: nothing in a vnode list can claim
   * one, and removing one is never this element's business.
   */
  const enhancedChildNodes = enhancedNode.childNodes as unknown as EnhancedChildNode[];
  const cloneChildren: (EnhancedChildNode | DONE)[] = [];
  let skipUntil: ChildNode | undefined;
  for (let i = 0; i < enhancedChildNodes.length; i++) {
    const child = enhancedChildNodes[i];
    if (skipUntil !== undefined) {
      if (child === skipUntil) skipUntil = undefined;
      continue;
    }
    if (child.nodeType === 8) {
      skipUntil = blockCloseOf(child);
      continue;
    }
    cloneChildren.push(child);
  }
  const keyIndex: KeyIndex = { map: null, source: cloneChildren, firstFree: 0 };

  // The nodes the vnode list wants, in its order. Feeds the reorder pass.
  const orderedNodes: ChildNode[] = [];

  /**
   * Where in the POOL to look first — the count of children that actually became nodes.
   *
   * `filterVirtualChild` drops `null`, `undefined` and booleans, and none of them leaves a
   * node behind, so the pool is shorter than the vnode list by however many holes precede a
   * child. This is only the guess, though; `i` is the identity. The two agree on every render
   * where no conditional sibling changed, which is what keeps the common path free.
   */
  let position = 0;

  for (let i = 0; i < vnodeChildren.length; i++) {
    const vchild = filterVirtualChild(vnodeChildren[i]);
    if (vchild === undefined) continue;

    const placed = claimOrMount(vchild, position++, i, placeholderComponent, enhancedNode, cloneChildren, keyIndex);
    if (placed) orderedNodes.push(placed);
  }

  return { cloneChildren, orderedNodes };
}

/**
 * The key -> position index, built the first time something actually needs it.
 *
 * Most renders never do: a list that has not reordered finds every child at the
 * position it was already in. Building the index up front cost a `String()` and
 * a `Map.set` per child on every render, which made a KEYED list measurably
 * SLOWER to update than the same list unkeyed — 20-30ms against 16-18ms on 3000
 * items — because the unkeyed path hits its preferred position with no
 * allocation at all.
 */
interface KeyIndex {
  map: Map<string, number> | null;
  source: (EnhancedChildNode | DONE)[];
  /**
   * Everything below this is claimed, so the backward slot search stops here.
   *
   * A claimed entry can never be matched again, and children are walked in ascending order, so
   * the run of `DONE` at the front of the pool only grows. Without this, appending 100 rows to
   * a list of 2900 walked all 2900 claimed entries for each of them — 290k steps to find
   * nothing, and 20% on that benchmark. The cursor only ever moves forward, so advancing it
   * costs one pass over the pool across the whole render, not one per child.
   */
  firstFree: number;
}

function keyIndexOf(index: KeyIndex): Map<string, number> {
  let map = index.map;
  if (map === null) {
    map = new Map<string, number>();
    const source = index.source;
    for (let i = 0; i < source.length; i++) {
      const entry = source[i];
      // Already claimed this pass: it cannot be matched again, and leaving it
      // out is what keeps a late lookup from pointing at a taken node.
      if (entry === DONE) continue;
      const key = entry[KEY_SYM];
      if (key != null) map.set(String(key), i);
    }
    index.map = map;
  }
  return map;
}

/**
 * Claims one child from `cloneChildren` — by position, then by key, then by
 * shape — or mounts it. Shared by both paths, so a list's items are reconciled
 * by exactly the same rules as any other child; the ONLY difference is which
 * pool and which key index they are handed, and that is what keeps lists apart.
 */
function claimOrMount(
  vchild: ComponentChild,
  preferredIndex: number,
  slot: number,
  placeholderComponent: MaybeComponent,
  parent: ChildNode,
  cloneChildren: (EnhancedChildNode | DONE)[],
  keyIndex: KeyIndex,
): ChildNode | undefined {
  let matchedIndex = -1;
  /** The matched node already records this slot, so there is nothing to write back. */
  let slotIsCurrent = false;

  const key = typeof vchild === "string" ? undefined : vchild.attributes?.key;
  const keyed = key != null;

  // 1. The position this child already occupied. `areSimilarNodes` enforces key
  //    equality, so this is safe for keyed children too — and it is the case
  //    that actually happens, so it must cost nothing.
  //
  //    For an UNKEYED child the position is only a guess at where its slot went, so the
  //    node has to agree that the slot is its own. One property read, and it is true on
  //    every render where no conditional sibling appeared or disappeared — which is
  //    almost all of them. A keyed child skips the question: the key is a stronger
  //    identity than the slot, and it is allowed to move.
  //
  //    The slot is read ONCE here and the answer carried to the write-back below. Reading
  //    it again there would be a second property read per child on the hottest path in the
  //    diff, to re-derive something already known.
  if (preferredIndex < cloneChildren.length) {
    const candidate = cloneChildren[preferredIndex];
    if (candidate !== DONE && areSimilarNodes(candidate, vchild)) {
      if (keyed) {
        matchedIndex = preferredIndex;
      } else {
        const recorded = candidate[SLOT_SYM];
        if (recorded === slot) {
          matchedIndex = preferredIndex;
          slotIsCurrent = true;
        } else if (recorded === undefined) {
          // Never diffed: a node the client adopted from server-rendered markup. Positional
          // matching is all there is, exactly as before, and claiming it is what stamps it.
          matchedIndex = preferredIndex;
        }
      }
    }
  }

  // 2. It moved: now the index is worth building.
  if (matchedIndex === -1 && keyed) {
    const asString = String(key);
    const map = keyIndexOf(keyIndex);
    const childIndex = map.get(asString);
    if (childIndex !== undefined) {
      matchedIndex = childIndex;
      map.delete(asString);
    }
  }

  // 3. Unkeyed only. A key is an identity the developer asserted, so no key
  //    match means no match — falling back to shape would let a keyed element
  //    adopt a differently-keyed node's state. `areSimilarNodes` rejects those
  //    anyway, so for a keyed child the scan could only ever come back empty,
  //    after walking the whole list to find that out.
  if (matchedIndex === -1 && !keyed) {
    matchedIndex = findIndexOfSlot(vchild, cloneChildren, slot, preferredIndex, keyIndex);
  }

  const matched = matchedIndex > -1 ? cloneChildren[matchedIndex] : DONE;

  if (matched !== DONE) {
    if (typeof vchild === "string") {
      applyDiffOnTextNode(vchild, matched);
      if (!slotIsCurrent) stampSlot(matched, slot, keyed);
      cloneChildren[matchedIndex] = DONE;
      return matched;
    }

    // diffAndMerge can hand back a DIFFERENT node — a keyed match only proves
    // the key is the same, so the component definition may have changed. When
    // it does, the old node stays unclaimed and gets unmounted below.
    const next = diffAndMerge(vchild, placeholderComponent, matched);
    // A replacement is a different node and knows nothing, so what was read off the old one
    // does not carry over to it.
    if (!slotIsCurrent || next !== matched) stampSlot(next as EnhancedChildNode, slot, keyed);
    if (next === matched) cloneChildren[matchedIndex] = DONE;
    return next;
  }

  // Built, not inserted: `reorderChildren` places it, after the nodes this
  // render drops have been unmounted. See buildDetachedNode.
  const mounted = buildDetachedNode(vchild, placeholderComponent, parent);
  // A node built this instant carries no slot, so there is nothing to read and nothing to
  // clear — only an unkeyed child has anything to write.
  if (mounted && !keyed) (mounted as EnhancedChildNode)[SLOT_SYM] = slot;
  cloneChildren.push(DONE);
  return mounted;
}

/**
 * Records the slot — for an unkeyed child, and only when it is news.
 *
 * **Only when it is news**, because a slot changes when a conditional sibling above this child
 * appears or disappears, and on every other render the node already knows its own. Storing it
 * anyway is a write to an expando on a DOM object for every child of every element on every
 * render, and writing one is far dearer than comparing one — the unconditional version was the
 * single largest cost this change added, and eliding it took the static-tree case back to where
 * it started. The read is the cheap half of the pair, so the read is what runs every time.
 *
 * **Unkeyed only**, because nothing ever asks a keyed node what slot it is in — a key is a
 * stronger identity, and a keyed child is allowed to move between slots. Stamping them meant
 * 3000 real writes on every rotation of a keyed list, for an answer no one reads. A keyed node
 * therefore carries no slot, and `findIndexOfSlot` walks past it rather than stopping.
 *
 * Exported for HYDRATION, which adopts nodes without going through the claim above and so used to
 * leave a whole page unstamped. The first update then matched those nodes by POSITION, and a child
 * appearing above them handed each one its neighbour's node: measured on a hydrated
 * `<span id="one">`/`<span id="two">` pair, where inserting a `<b>` in front left the text right and
 * the two nodes swapped — which is what carries focus, scroll and an uncontrolled input's value to
 * the wrong row.
 */
export function stampSlot(node: EnhancedChildNode, slot: number, keyed: boolean): void {
  if (keyed) {
    // It was unkeyed on an earlier render and a key has since been added: the old slot would
    // be a lie to any sibling scanning past it.
    if (node[SLOT_SYM] !== undefined) node[SLOT_SYM] = undefined;
    return;
  }
  if (node[SLOT_SYM] !== slot) node[SLOT_SYM] = slot;
}

/**
 * The node built for this slot last render, wherever it has ended up.
 *
 * Slots rise with position — a child later in the JSX is always later in the DOM — so the
 * search walks outward from the guess and stops the moment it passes the slot it wants. When
 * one conditional sibling appeared, that is one step. It does not scan the list.
 *
 * An unstamped node is stepped over rather than stopped at: keyed siblings carry no slot, and
 * a keyed child standing between two unkeyed ones must not hide them from each other.
 *
 * Returning -1 means no node was built for this slot, and the caller mounts a fresh one. That
 * is the whole point of the slot: a child appearing in the MIDDLE of same-shape siblings used
 * to find a neighbour's node by shape and take it, and neither the diff nor any diagnostic
 * could tell that apart from a legitimate move.
 *
 * The shape scan is still the answer when NOTHING in the pool is stamped — the first diff
 * after the client adopts a server-rendered tree, where positional matching is all there is.
 */
function findIndexOfSlot(
  vchild: ComponentChild,
  cloneChildren: (EnhancedChildNode | DONE)[],
  slot: number,
  preferredIndex: number,
  keyIndex: KeyIndex,
): number {
  const length = cloneChildren.length;
  let sawStamp = false;

  // Claimed entries at the front of the pool are behind us for good.
  let low = keyIndex.firstFree;
  while (low < length && cloneChildren[low] === DONE) low++;
  keyIndex.firstFree = low;

  for (let j = preferredIndex > low ? preferredIndex : low; j < length; j++) {
    const candidate = cloneChildren[j];
    if (candidate === DONE) continue;
    const recorded = candidate[SLOT_SYM];
    if (recorded === undefined) continue;
    sawStamp = true;
    if (recorded === slot) return areSimilarNodes(candidate, vchild) ? j : -1;
    if (recorded > slot) break;
  }

  for (let j = Math.min(preferredIndex, length) - 1; j >= low; j--) {
    const candidate = cloneChildren[j];
    if (candidate === DONE) continue;
    const recorded = candidate[SLOT_SYM];
    if (recorded === undefined) continue;
    sawStamp = true;
    if (recorded === slot) return areSimilarNodes(candidate, vchild) ? j : -1;
    if (recorded < slot) break;
  }

  // A stamped pool has answered: nothing here was built for this slot.
  if (sawStamp) return -1;

  return findIndexOfSimilarNodes(vchild, cloneChildren, preferredIndex, low);
}

/**
 * A record entry is either a DOM node or a region; only a region has `owner`.
 *
 * Deliberately blind to WHICH kind of region. A list and a component both own a contiguous run of
 * nodes and nest the same way, and every caller here — `flattenEntries`, `collectRegionNodes`,
 * `disposeRegions`, the previous-region map — asks only that one question. Two of them would be two
 * walks over the same tree answering it twice.
 */
export function isRegion(entry: RecordEntry): entry is ListRegion | ComponentRegion {
  return (entry as ListRegion).owner !== undefined;
}

/** Which kind. A component region carries the instance; a list carries its `source`. */
export function isComponentRegion(entry: ListRegion | ComponentRegion): entry is ComponentRegion {
  return (entry as ComponentRegion).instance !== undefined;
}
/**
 * The path for an element that owns at least one region — a list, or a component.
 *
 * Previous state comes from the element's record rather than from `childNodes`,
 * because the DOM has nowhere to say "these three nodes are that list".
 */
function applyDiffWithRegions(
  vnodeChildren: unknown[],
  placeholderComponent: MaybeComponent,
  enhancedNode: EnhancedChildNode,
  hasRegion: boolean,
) {
  const previous = enhancedNode[CHILD_RECORD] ?? (Array.from(enhancedNode.childNodes) as unknown as RecordEntry[]);

  const unclaimed: (EnhancedChildNode | DONE)[] = [];
  const result = reconcileEntries(vnodeChildren, previous, undefined, placeholderComponent, enhancedNode, unclaimed);

  // Kept only while this element still owns a region — every other element pays nothing and keeps
  // reading childNodes exactly as before.
  enhancedNode[CHILD_RECORD] = hasRegion ? result.entries : undefined;

  // Nothing moved, mounted or unmounted, and every region reported itself
  // unchanged — so there is no order to restore and no reason to flatten.
  if (!result.changed && unclaimed.length === 0) {
    return { cloneChildren: unclaimed, orderedNodes: null };
  }

  const orderedNodes: ChildNode[] = [];
  flattenEntries(result.entries, orderedNodes);
  return { cloneChildren: unclaimed, orderedNodes };
}

/**
 * Reconciles one level of children against the entries that level held last
 * render, and **recurses for a list**, so a list inside a list inside a slot is
 * reconciled the same way at every depth.
 *
 * Plain children share one pool and one key index; each list gets its own,
 * scoped to itself. That scoping is what keeps two lists that both mint `f0`
 * from seeing each other, and what keeps a component's chrome out of reach of
 * content passed into it.
 */
/**
 * What a `list()` region reports to when an item's signal changes.
 *
 * The owner is the component whose render produced the descriptor — a plain
 * function has no `this`, but the diff knows exactly whose children it is
 * walking.
 */
export function listHostFor(owner: MaybeComponent): ListHost {
  return {
    reBuild: () => {
      if (owner) addTaskToQueue(owner);
    },
    name: owner?.constructor.name ?? "list",
  };
}

export function reconcileEntries(
  children: unknown[],
  previous: RecordEntry[],
  clean: boolean[] | undefined,
  placeholderComponent: MaybeComponent,
  parent: ChildNode,
  unclaimed: (EnhancedChildNode | DONE)[],
  /**
   * Where an item's invalidation reports, when it is not the owner's next render
   * that will pick it up.
   *
   * A list in a render slot is rebuilt by the render that produced it, so asking
   * the owner to re-render is the whole answer. A list in a `ChildrenRegion` is
   * not: the children were built by a hook's props factory, which is cached on
   * the signals IT read — an item reading something deeper leaves that cache
   * clean, so the callback never reruns and nothing would reconcile. The region
   * supplies a host that refreshes the region itself.
   */
  listHost?: ListHost,
): { entries: RecordEntry[]; changed: boolean } {
  const cloneChildren: (EnhancedChildNode | DONE)[] = [];
  // Looked up by owner, never by position: a region keeps its nodes even when it
  // moves among its siblings.
  const previousRegions = new Map<unknown, ListRegion | ComponentRegion>();
  /**
   * Regions a LATER one with the same owner pushed out of the index.
   *
   * One entry per owner, and two siblings can answer the same one: a component's owner is its `key`
   * when the parent wrote one, so `<Row key="a" /><Row key="a" />` collides. That is user error and
   * `RMD002` says so — but the page has to survive it on every render, and the loser of the collision
   * is not in the index at all: nothing claims it and the teardown below only walks the index. Its
   * nodes stayed in the DOM and its `@destroyed` never ran, once per render, for as long as the
   * mistake was in the source. Measured: three `<li>` after the first re-render of two rows, four
   * after the second.
   *
   * The later one wins, which is what a plain node with a duplicate key already does — `keyIndexOf`
   * overwrites, and the displaced NODE ends up in `cloneChildren` and is unmounted as a leftover.
   * This is the same outcome for a region: retired with the ones this render no longer asks for.
   */
  let displacedRegions: (ListRegion | ComponentRegion)[] | undefined;

  for (const entry of previous) {
    if (!isRegion(entry)) {
      cloneChildren.push(entry);
      continue;
    }
    const clash = previousRegions.get(entry.owner);
    if (clash !== undefined) (displacedRegions ??= []).push(clash);
    previousRegions.set(entry.owner, entry);
  }

  /**
   * `cloneChildren` is the pool to claim from, and it GROWS as the loop runs: `claimOrMount`
   * appends every node it mounts. So its length is not "how many nodes were here before" at any
   * point after the first claim, and anything that wanted that number would have to read it up
   * here — which nothing does. It is written down because the shape invites the mistake: the
   * variable this note used to sit above was such a count, and it was gone before this line was
   * ever committed while the note stayed behind describing it.
   */
  const keyIndex: KeyIndex = { map: null, source: cloneChildren, firstFree: 0 };

  const entries: RecordEntry[] = [];
  let changed = false;
  let plainIndex = 0;

  for (let i = 0; i < children.length; i++) {
    const rawVchild = children[i];

    if (isListNode(rawVchild)) {
      const found = previousRegions.get(rawVchild.owner);
      previousRegions.delete(rawVchild.owner);
      // A list's owner and a component's owner are minted differently and cannot collide, so this
      // narrowing never actually discards a region — it is what tells the two kinds apart in types.
      const before = found !== undefined && !isComponentRegion(found) ? found : undefined;

      // The engine hands back the identical ListNode when nothing about the
      // list changed. Same object -> same items, same order, same length: the
      // region is left exactly as it is, without touching one of its nodes.
      if (before !== undefined && before.source === rawVchild) {
        entries.push(before);
        if (previous[entries.length - 1] !== before) changed = true;
        continue;
      }

      // A `list()` descriptor has not run its mapper yet. This is the moment to:
      // the previous region is in hand, and with it the engine holding the
      // minted ids, the per-item scopes and the whole-list skip.
      let listNode = rawVchild;
      let engine = before?.engine;

      if (isLazyList(rawVchild)) {
        const materialized = buildLazyList(
          rawVchild as unknown as LazyListNode,
          engine as ListEngine<unknown> | undefined,
          listHost ?? listHostFor(placeholderComponent),
        );
        listNode = materialized.node as typeof rawVchild;
        engine = materialized.engine;
      }

      const inner = reconcileEntries(
        listNode.vnodes,
        before?.entries ?? [],
        listNode.clean,
        placeholderComponent,
        parent,
        unclaimed,
        listHost,
      );
      entries.push({
        owner: listNode.owner,
        entries: inner.entries,
        // The BUILT node, not the descriptor: the whole-list skip below compares
        // this by identity, and the engine hands back the very same object when
        // nothing about the list changed.
        source: listNode,
        engine,
      });
      changed = true;
      continue;
    }

    /**
     * A COMPONENT is a region, so it never reaches `claimOrMount` and never takes a slot from the
     * node pool. It is looked up by its own identity instead — see `componentRegionOwner`.
     *
     * Ahead of the clean check on purpose: `claimByKey` looks for a NODE in the pool, and a
     * component has none there. A clean component is one whose vnode is the very object from last
     * render, so its props cannot have changed either and adopting the region is the whole job.
     */
    if (isVNode(rawVchild) && rawVchild.type === COMPONENT_TYPE) {
      const owner = componentRegionOwner(rawVchild, i);
      const found = previousRegions.get(owner);
      previousRegions.delete(owner);
      const before = found !== undefined && isComponentRegion(found) ? found : undefined;

      let region: ComponentRegion;
      if (clean !== undefined && clean[i] === true && before !== undefined && before.definition === rawVchild.name) {
        before.parent = parent;
        region = before;
      } else {
        try {
          region = reconcileComponentEntry(rawVchild, owner, before, placeholderComponent, parent, unclaimed);
        } catch (e) {
          /**
           * The same door a plain child's build goes through, and it has to be here now.
           *
           * `buildDetachedNode` wraps every node it builds, so a throwing render used to reach
           * `errorHandler` — which walks up to an `ErrorBoundary` — simply by being built there. A
           * component is built on this path instead, and without this the throw went straight out of
           * the drain: measured as every `ErrorBoundary` test failing with the child's own error.
           *
           * The child is dropped from this render, exactly as a failed node is. What was there
           * before it is torn down by hand, because it has already been taken out of
           * `previousRegions` and nothing downstream would find it again.
           */
          if (before !== undefined) {
            collectRegionNodes(before, unclaimed);
            disposeRegions([before]);
            changed = true;
          }
          errorHandler(e, placeholderComponent);
          continue;
        }
      }

      entries.push(region);
      if (previous[entries.length - 1] !== region) changed = true;
      continue;
    }

    // Clean item: same vnode object, and nothing it read has changed. Its DOM
    // subtree is therefore still correct, so it is claimed by key and left
    // alone — no attribute pass, no recursion, no work proportional to its size.
    if (clean !== undefined && clean[i] === true) {
      const claimedNode = claimByKey(rawVchild as VNode, cloneChildren, keyIndex);
      if (claimedNode !== undefined) {
        // `claimByKey` only ever answers for a KEYED item, so this clears rather than records.
        stampSlot(claimedNode, i, true);
        entries.push(claimedNode);
        if (previous[entries.length - 1] !== claimedNode) changed = true;
        plainIndex++;
        continue;
      }
      // No node to reuse (first render, or it was unmounted): build it normally.
    }

    const vchild = filterVirtualChild(rawVchild);
    if (vchild === undefined) continue;

    const placed = claimOrMount(vchild, plainIndex++, i, placeholderComponent, parent, cloneChildren, keyIndex);
    if (placed) {
      entries.push(placed as EnhancedChildNode);
      if (previous[entries.length - 1] !== placed) changed = true;
    }
  }

  // A region this render no longer asks for — a list that is gone, a component that is gone — and
  // children that were not claimed.
  const retire = (region: ListRegion | ComponentRegion): void => {
    collectRegionNodes(region, unclaimed);
    // The nodes go to `unclaimed` to be unmounted, but the instance and the list engine are
    // reachable only from here: the region entry itself is about to be dropped. `disposeRegions`
    // takes the entry rather than its children, so a component region's own `@destroyed` runs.
    disposeRegions([region]);
    changed = true;
  };
  for (const region of previousRegions.values()) retire(region);
  if (displacedRegions !== undefined) for (const region of displacedRegions) retire(region);
  for (const leftover of cloneChildren) {
    if (leftover !== DONE) unclaimed.push(leftover);
  }
  if (previous.length !== entries.length) changed = true;

  return { entries, changed };
}

/** Claims the node a clean item already owns, without diffing into it. */
function claimByKey(
  vnode: VNode,
  cloneChildren: (EnhancedChildNode | DONE)[],
  keyIndex: KeyIndex,
): EnhancedChildNode | undefined {
  const key = vnode.attributes?.key;
  if (key == null) return undefined;

  const asString = String(key);
  const map = keyIndexOf(keyIndex);
  const index = map.get(asString);
  if (index === undefined) return undefined;

  const node = cloneChildren[index];
  if (node === DONE) return undefined;

  map.delete(asString);
  cloneChildren[index] = DONE;
  return node;
}

/**
 * The first node a record holds, without flattening the rest of it.
 *
 * For the callers that want "somewhere to point at" — a devtools highlight, the connectedness check
 * behind RMD016 — where building the whole list to read `[0]` is the wrong shape.
 */
export function firstNodeOf(entries: RecordEntry[]): ChildNode | undefined {
  for (const entry of entries) {
    if (!isRegion(entry)) return entry;
    const inner = firstNodeOf(entry.entries);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

export function flattenEntries(entries: RecordEntry[], out: ChildNode[]): void {
  for (const entry of entries) {
    if (isRegion(entry)) flattenEntries(entry.entries, out);
    else out.push(entry);
  }
}

function collectRegionNodes(region: ListRegion | ComponentRegion, out: (EnhancedChildNode | DONE)[]): void {
  for (const entry of region.entries) {
    if (isRegion(entry)) collectRegionNodes(entry, out);
    else out.push(entry);
  }
}

/**
 * Aligns the DOM child order with the order the vnode list asked for, moving as
 * few nodes as possible.
 *
 * The naive backwards walk ("move whenever `nextSibling` is not the node placed
 * after me") cascades: a child this render built arrives uninserted and is placed at the END, so
 * inserting
 * one row near the front made every node between the insertion point and the end
 * look misplaced, and each got its own `insertBefore`. Measured at 10000 items:
 * 38.9s for an insert at index 0, 20.5s at the middle — while the mapper and the
 * diff walk together cost ~80ms.
 *
 * Instead: take the longest run of nodes that are already in relative order and
 * leave them alone; move only the rest. One insertion then costs exactly one
 * move, whatever the list length.
 *
 * ## Scoped to a block — `anchor` and `previousOrder`
 *
 * A `ChildrenRegion` owns a contiguous RUN of children inside a parent it shares
 * (a portal's target holds the shell's own content and every other portal's).
 * Both defaults above are wrong for it: `reference = null` appends past the end
 * of the target rather than the end of the block, and a walk over
 * `parent.childNodes` reads nodes the region does not own.
 *
 * So a region passes its trailing `anchor` — insertions land before it, inside
 * the block — and the order it flattened LAST pass, from which the positions are
 * read directly. That is not merely a way around the parent walk, it is cheaper
 * than one: the region's nodes are contiguous and nothing else moves them, so the
 * previous flat order IS their DOM order, and a portal into `document.body` skips
 * walking every child of the body.
 */
export function reorderChildren(
  parent: ChildNode,
  orderedNodes: ChildNode[],
  anchor: ChildNode | null = null,
  previousOrder?: readonly ChildNode[],
): void {
  const length = orderedNodes.length;
  if (length === 0) return;

  // Fast path, no allocation: the DOM already reads exactly like the target.
  // This is the common render — a state change that moves nothing.
  if (previousOrder !== undefined) {
    // Element-wise equality is the whole check for a block: every node was
    // reused (a fresh one cannot appear in the previous order) and none moved,
    // so the DOM is already right.
    if (previousOrder.length === length) {
      let same = true;
      for (let n = 0; n < length; n++) {
        if (previousOrder[n] !== orderedNodes[n]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
  } else {
    let cursor = parent.firstChild;
    let i = 0;
    while (cursor !== null && i < length && cursor === orderedNodes[i]) {
      cursor = cursor.nextSibling;
      i++;
    }
    if (i === length && cursor === null) return;
  }

  // Current position of every child, so "already in relative order" is decidable.
  const positions = new Map<ChildNode, number>();
  let index = 0;
  if (previousOrder !== undefined) {
    for (const node of previousOrder) positions.set(node, index++);
  } else {
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
      positions.set(node, index++);
    }
  }

  // A node with no position is one this render just built: the children diff
  // hands them over uninserted on purpose, so that the nodes this render drops
  // are unmounted first. It used to be an unexpected case that bailed to the
  // naive walk; now it is the normal way a new child arrives.
  const current: number[] = new Array(length);
  let fresh = 0;
  for (let n = 0; n < length; n++) {
    const position = positions.get(orderedNodes[n]);
    if (position === undefined) {
      current[n] = NOT_PLACED;
      fresh++;
    } else {
      current[n] = position;
    }
  }

  const keep = keptInOrder(current, fresh);
  let keepIndex = keep.length - 1;
  // The block's trailing anchor for a region, `null` — the parent's end — for an
  // element whose children are the whole block.
  let reference: ChildNode | null = anchor;

  for (let n = length - 1; n >= 0; n--) {
    const node = orderedNodes[n];
    if (keepIndex >= 0 && keep[keepIndex] === n) {
      // Already in relative order: leave it, and let it anchor the ones before.
      keepIndex--;
    } else {
      parent.insertBefore(node, reference);
    }
    reference = node;
  }
}

/** Marks a node that is not in the parent yet, so it has no current position. */
const NOT_PLACED = -1;

/**
 * The indices of `orderedNodes` that may stay where they are.
 *
 * A freshly built node can never be one of them — it has to be inserted no
 * matter where it lands — so those entries are taken out before the longest
 * increasing subsequence is computed, and the result is mapped back to indices
 * in the original array.
 *
 * Splitting only when there IS a new node keeps the common render — a reorder
 * with nothing added — on exactly the path it was on before: one LIS over the
 * positions, no extra arrays.
 */
function keptInOrder(current: number[], fresh: number): number[] {
  if (fresh === 0) return longestIncreasingSubsequence(current);
  // Everything is new, so nothing can be kept. Also guards the LIS helper, which
  // assumes a non-empty input.
  if (fresh === current.length) return [];

  const placedIndex: number[] = [];
  const placedPosition: number[] = [];
  for (let n = 0; n < current.length; n++) {
    if (current[n] === NOT_PLACED) continue;
    placedIndex.push(n);
    placedPosition.push(current[n]);
  }

  const keptAmongPlaced = longestIncreasingSubsequence(placedPosition);
  const keep: number[] = new Array(keptAmongPlaced.length);
  for (let k = 0; k < keptAmongPlaced.length; k++) {
    keep[k] = placedIndex[keptAmongPlaced[k]];
  }
  return keep;
}

// `reorderChildrenNaive` lived here. It was the fallback for "a node that is not
// a child of this parent", which used to mean something had gone wrong. Since
// the children diff hands new nodes over uninserted, that case is now the normal
// one and the LIS path handles it — see keptInOrder. Nothing called this.

/**
 * Indices of a longest increasing subsequence of `values`, ascending.
 * Those are the nodes that may stay put; every other node has to move.
 * O(n log n) — patience sorting with predecessor links.
 */
function longestIncreasingSubsequence(values: number[]): number[] {
  const length = values.length;
  const predecessor = new Array<number>(length);
  // Indices of the current best subsequence, by length.
  const result: number[] = [0];

  for (let i = 1; i < length; i++) {
    const value = values[i];
    const last = result[result.length - 1];

    if (values[last] < value) {
      predecessor[i] = last;
      result.push(i);
      continue;
    }

    // Binary search for the first entry not smaller than `value`, and take its
    // place: a smaller tail leaves more room for what comes after.
    let low = 0;
    let high = result.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[result[middle]] < value) low = middle + 1;
      else high = middle;
    }

    if (value < values[result[low]]) {
      if (low > 0) predecessor[i] = result[low - 1];
      result[low] = i;
    }
  }

  // Walk the predecessor links back to turn the tails into the real sequence.
  let cursor = result.length;
  let node = result[cursor - 1];
  while (cursor-- > 0) {
    result[cursor] = node;
    node = predecessor[node];
  }

  return result;
}

function applyDiffOnTextNode(vnode: string, enhancedNode: ChildNode): void {
  if (enhancedNode.textContent !== vnode) enhancedNode.textContent = vnode;
}

/**
 * A component that is staying put takes the parent's new props, and nothing else happens here.
 *
 * Its DOM is not touched: taking props may schedule a render (`addTaskToQueue`), and that render is
 * what reconciles its own block later in the drain. The region — its entries, its node order — is
 * the same object throughout, so the parent's `flattenEntries` keeps reporting the nodes that are
 * really there.
 */
function updateComponentRegion(region: ComponentRegion, vnode: VNodeComponent): void {
  const component = region.instance;

  /**
   * `@StableProps` on a COMPONENT, applied here because here is where the parent's JSX arrives.
   *
   * An object literal in JSX is a fresh reference on every render, so `<Panel filter={{ q }} />`
   * hands the child a changed prop every time and re-renders it forever. A declared prop gets back
   * the identity it already had while its contents match — the same `resolveStable` a hook's props
   * go through, and the same reason: one declaration, one behaviour.
   *
   * Before every comparison below rather than inside one, so nothing downstream needs a special
   * case: once the reference is the previous one, the bag comparison, the signals and `@watchProp`
   * all see what they would see if the parent had never rebuilt it.
   */
  const componentRuntime = component[COMPONENT_RUNTIME];
  const declaredStable = (component.constructor as { [STABLE_PROPS]?: readonly string[] })[STABLE_PROPS];
  const nextProps = resolveStable(vnode.attributes ?? {}, componentRuntime.rawProps, declaredStable);

  // Read off the CLASS, so a subclass inherits its base's rule through the static
  // chain and shadows it by declaring its own. See @ShouldUpdateOnPropsChange.
  const decide = (component.constructor as { [PROPS_GATE]?: PropsGate })[PROPS_GATE];
  const takeProps = decide
    ? decide(component, componentRuntime.rawProps, nextProps)
    : !arePropsBagsEqual(componentRuntime.rawProps, nextProps);

  if (takeProps) {
    const prevRaw = componentRuntime.rawProps;
    const nextRaw = nextProps;

    componentRuntime.rawProps = nextRaw;

    for (const key in nextRaw) {
      const newValue = nextRaw[key];
      const oldValue = prevRaw[key];

      if (oldValue !== newValue) {
        const sig = componentRuntime.propsSignals.get(key);
        if (sig) sig.set(newValue);
      }
    }

    for (const key of Object.keys(prevRaw)) {
      if (!(key in nextRaw)) {
        const sig = componentRuntime.propsSignals.get(key);
        if (sig) sig.set(undefined);
      }
    }

    addTaskToQueue(component);
  }
}

/**
 * The component branch of `reconcileEntries` — adopt the region that was here, or build one.
 *
 * `owner` is what makes adoption possible across a render: the `key` the parent wrote, otherwise the
 * child slot. Those are the two channels a list row is matched on, and a component gets them for the
 * same reason — position holds until a conditional sibling appears, and then only a key can say what
 * moved where. `normalizeChildren` leaves a `false` hole where a conditional child renders nothing,
 * so a slot does not shift under its siblings and the unkeyed case is stable in practice.
 *
 * A DIFFERENT class in the same slot is not an adoption: the previous region is left in
 * `previousRegions` to be disposed, and a fresh component is built. The region names the class it was
 * built from, which is what makes that answerable without a node to read it off.
 */
function reconcileComponentEntry(
  vnode: VNodeComponent,
  owner: unknown,
  before: ComponentRegion | undefined,
  placeholderComponent: MaybeComponent,
  parent: ChildNode,
  unclaimed: (EnhancedChildNode | DONE)[],
): ComponentRegion {
  if (before !== undefined && before.definition === vnode.name) {
    updateComponentRegion(before, vnode);
    // A region that moved between parents takes its nodes with it, so state relocates rather than
    // being rebuilt beside a stale copy. The reorder does the moving; this only records where.
    before.parent = parent;
    return before;
  }

  /**
   * A DIFFERENT class in this slot, so the one that was here has to go — by hand.
   *
   * It has already been taken out of `previousRegions`, which is the map the loop's own teardown
   * pass walks at the end. Leaving it there would mean nothing ever unmounts its nodes or runs its
   * `@destroyed`: measured as `["alpha", "beta", "tail"]` where the replaced row must leave —
   * the old markup sitting beside the new, and a live component behind it.
   */
  if (before !== undefined) {
    collectRegionNodes(before, unclaimed);
    disposeRegions([before]);
  }

  return buildComponentRegion(vnode, placeholderComponent, owner, parent);
}

/** The identity a component region is found by next render: its key, or the slot it occupies. */
export function componentRegionOwner(vnode: VNodeComponent, slot: number): string {
  const key = vnode.attributes?.key;
  return key == null ? `c${slot}` : `k${String(key)}`;
}

/**
 * Searches for a similar node in the existing children list.
 * Optimization: It first checks the 'preferredIndex' (the current loop position).
 * In most UI updates, nodes stay in the same order, allowing O(1) lookup.
 * If that fails, it performs a linear search from `low`.
 *
 * `low` is the first pool entry that is not already claimed. Everything below it is `DONE` and
 * can never match, so starting at 0 re-walked the whole claimed prefix on every call: appending
 * 100 rows to a list of 2900 spent 290k steps proving there was nothing to find.
 */
function findIndexOfSimilarNodes(
  virtualNode: ComponentChild,
  cloneChildren: (EnhancedChildNode | DONE)[],
  preferredIndex: number,
  low: number,
): number {
  const cloneChildrenLength = cloneChildren.length;

  if (preferredIndex < cloneChildrenLength) {
    const candidateAtPosition = cloneChildren[preferredIndex];
    if (candidateAtPosition !== DONE && areSimilarNodes(candidateAtPosition, virtualNode)) {
      return preferredIndex;
    }
  }

  for (let j = low; j < cloneChildrenLength; j++) {
    const candidate = cloneChildren[j];

    if (candidate === DONE) continue;

    if (areSimilarNodes(candidate, virtualNode)) {
      return j;
    }
  }

  return -1;
}

/**
 * Releases the reactive scopes the regions under a record hold.
 *
 * `For` did this from its own `@destroyed`: the hook instance WAS the thing being
 * unmounted, so the teardown had somewhere to live. A `list()` region has no
 * instance — its state rides on the parent's record — so whoever destroys the
 * record has to release it. Without this, every item that read an ANCESTOR's
 * signal stays subscribed to it after the page stops showing the list.
 *
 * Measured on the old code: removing a list of three items left 1 live listener
 * on the provider's signal instead of 0, and the whole subtree stayed reachable
 * through it. See `ScopeCleanup.test.tsx`, which fails without this call.
 */
export function disposeRegions(entries: RecordEntry[]): void {
  for (const entry of entries) {
    if (!isRegion(entry)) {
      /**
       * A plain node, which may hold whole components deeper down — and they have to go FIRST.
       *
       * An element between two components is not a region: it is one node in this record, keeping a
       * record of its own for the components among ITS children, and an element with none keeps no
       * record at all, so the search goes through the DOM. Skipping it left every such component to
       * whatever removed the nodes afterwards, which runs after this — so a child's `@destroyed` ran
       * after its parent's. Measured on `<Middle><div><Leaf/></div></Middle>`: `["middle", "leaf"]`,
       * where a teardown can only be written against `["leaf", "middle"]`.
       *
       * Every caller of this is dropping the nodes it passes, so the node's own teardown belongs
       * here, and running it twice is harmless — the record is cleared as it goes.
       */
      unmountNodeInPlace(entry);
      continue;
    }
    // Regions nest, and only the outermost is reachable from the record. Inside-out: a child's
    // `@destroyed` must run while its parent is still standing, which is the order the DOM walk
    // gave when a component was an element and its children were under it.
    disposeRegions(entry.entries);

    if (isComponentRegion(entry)) {
      /**
       * This is where a component is torn down now — not the DOM walk.
       *
       * A component has no node of its own: it may own two, or none, so there is nothing to hang a
       * back-reference off and a DOM walk cannot find one. The record is the only thing that knows an
       * instance is here, so the record is what releases it. Reached from every path that drops nodes,
       * because each one already calls `releaseChildRecord` or `disposeRegions` on what it drops.
       */
      lifecycleCleanupManagement(entry.instance);
      continue;
    }

    entry.engine?.dispose();
  }
}

export function releaseChildRecord(node: EnhancedChildNode): void {
  const record = node[CHILD_RECORD];
  if (record === undefined) return;
  disposeRegions(record);
  node[CHILD_RECORD] = undefined;
}

export function unmountChildrenNodes(children: (EnhancedChildNode | DONE)[], flushCommitWork = true) {
  for (const child of children) {
    if (child === DONE) continue;

    unmountNodeInPlace(child);
    child.remove();
  }

  /**
   * Teardown is a commit too, and a STANDALONE one — unmounting a root, or a test
   * harness clearing a container — is not reached from a drain, so nothing else
   * would run the commit-level work (a `Head`/`Portal` recompute) the `@destroyed`s
   * just queued. Cheap when there is nothing: the queue is empty on every teardown
   * that did not touch it.
   *
   * But when this runs INSIDE a larger commit — the children diff dropping stale
   * nodes, a `Portal` clearing its own — the enclosing `flushPostCommit` drains that
   * work once, at the end. Flushing here as well would run it mid-diff against a
   * half-built tree, and again after, defeating the once-per-commit batching `Head`
   * is built on. So those callers pass `false`.
   */
  if (flushCommitWork) flushAfterCommit();
}

/**
 * The teardown above, WITHOUT taking the node out of the document.
 *
 * For the one caller that has to put something else in the node's place:
 * hydration replacing a subtree it could not adopt. `replaceChild` needs the old
 * node to still be a child, so removing it first is not an option — and skipping
 * the teardown is what used to happen instead, leaving a live component with no
 * DOM: no `@destroyed`, no effect cleanups, no signal detach, its timers still
 * firing and a later write scheduling a render into nodes nobody can see.
 */
export function unmountNodeInPlace(node: EnhancedChildNode): void {
  if (node.childNodes.length > 0) {
    loopThroughSoonToBeRemovedNodes(node.childNodes as NodeListOf<EnhancedChildNode>);
  }

  releaseRef(node);
  releaseChildRecord(node);
}

function loopThroughSoonToBeRemovedNodes(childNodes: NodeListOf<EnhancedChildNode>) {
  for (const child of childNodes) {
    if (child.childNodes.length > 0) {
      loopThroughSoonToBeRemovedNodes(child.childNodes as NodeListOf<EnhancedChildNode>);
    }

    releaseRef(child);
    releaseChildRecord(child);
  }
}

/**
 * A ref must not outlive the node it points at. Left set, `current` holds a
 * detached element: it reads as present, `focus()` and friends do nothing, and
 * the subtree stays reachable.
 */
function releaseRef(node: EnhancedChildNode): void {
  const ref = node[REF_SYM];
  if (!ref) return;
  node[REF_SYM] = undefined;

  // Only if it still points HERE. Mounting runs before unmounting, so when one
  // element replaces another that shared a ref, the new node has already
  // claimed it — clearing then would wipe the value that was just set.
  if (ref.current !== node) return;
  ref.setCurrent(null);
}

/**
 * Core reconciliation logic to determine if an enhanced node can be reused.
 * A node is reusable if it shares the same type, key, and definition.
 */
function areSimilarNodes(enhancedNode: EnhancedNode | EnhancedChildNode, virtualNode: ComponentChild): boolean {
  if (typeof virtualNode === "string") {
    return enhancedNode.nodeType === 3;
  }

  if (!enhancedNode || enhancedNode.nodeType === 3) return false;

  // Different builders, different things. A node Panel built for itself must
  // never be claimed for a vnode its caller passed in, however alike they look.
  // 0 is its own group, not a wildcard: a vnode built outside any render — a
  // module-level `const foo = <div/>`, a field initializer — matches only other
  // such vnodes. See core/origin.ts.
  const vOrigin = virtualNode[ORIGIN_SYM];
  const eOrigin = enhancedNode[ORIGIN_SYM];
  if (vOrigin !== eOrigin) return false;

  const vKey = virtualNode.attributes?.key;
  const eKey = enhancedNode[KEY_SYM];

  const hasVKey = vKey != null;
  const hasEKey = eKey != null;

  if (hasVKey || hasEKey) {
    if (String(vKey) !== String(eKey)) return false;
  }

  /**
   * Only markup reaches here, so the tag is the whole question.
   *
   * The pool this searches holds plain nodes; a component is a region and never enters it. That
   * closes a hole this function used to have to guard by hand: `{on ? <Child /> : <span>gone</span>}`
   * with `Child` hosted on a `<span>` claimed the component's element for the plain one, dropping a
   * live instance with no teardown. There is no host element to be confused for a `<span>` now, and
   * a component that stops being rendered loses its region — which is what runs its `@destroyed`.
   */
  return enhancedNode.nodeName === virtualNode.name;
}

export function buildComponentRegion(
  vnode: VNodeComponent,
  placeholderComponent: MaybeComponent,
  owner: unknown,
  parent: ChildNode,
): ComponentRegion {
  const placeholderComponentRuntime = placeholderComponent?.[COMPONENT_RUNTIME];
  const parentContext = placeholderComponent?.[GLOBAL_RUNTIME].context;
  const currentContext = Object.create(parentContext || null) as Context;

  const component = componentFactory(vnode.name, vnode.attributes, currentContext);
  const componentRuntime = component[COMPONENT_RUNTIME];
  const runtime = component[GLOBAL_RUNTIME];
  componentRuntime.isInitialized = true;

  if (placeholderComponentRuntime) {
    componentRuntime.depth = placeholderComponentRuntime.depth + 1;
    componentRuntime.parent = placeholderComponent;
  }

  // Inherit the side we're rendering on from the parent. The module-level env is
  // only consulted for a root mount (no parent), which always happens inside a
  // synchronous section — see renderEnv.ts for why that matters.
  const env = placeholderComponentRuntime ? placeholderComponentRuntime.env : getRenderEnv();
  componentRuntime.env = env;

  // Same inheritance rule as `env`, and for the same reason — a component created
  // during the server's drain loop, long after the module-level flag is clear,
  // still reaches the render it belongs to through its parent.
  componentRuntime.serverWork = placeholderComponentRuntime
    ? placeholderComponentRuntime.serverWork
    : getServerWorkCollector();

  // Client render skips server-only lifecycle; server render skips client-only.
  const onServer = env === "server";
  const skipEnv = onServer ? "client" : "server";

  // DEV lint: on the server, capture props post-construction so we can flag
  // state that create/mount sets but doesn't persist (undefined after hydration).
  // Kept in a plain `if (__DEV__)` block so prod builds strip it (and the import).
  let lintBefore: ReturnType<typeof snapshotOwnProps> | undefined;
  if (__DEV__) {
    if (onServer) lintBefore = snapshotOwnProps(component);
  }

  // Attribute timers started by this component's lifecycle to it (RMD006).
  // Saved and restored rather than just set: createComponent nests, because a
  // child is built from inside the parent's diff — and the parent still has
  // mounts and effects to run once that returns.
  let previousTimerOwner: BaseComponent | undefined;
  if (__DEV__) {
    previousTimerOwner = timerOwner.component;
    timerOwner.component = component;
  }

  try {
    return buildComponent(component, vnode, runtime, skipEnv, lintBefore, owner, parent);
  } catch (e) {
    // The build failed, but the component was already CONSTRUCTED and its
    // @created may already have run and taken something — a subscription, a
    // hand-written listener, an open connection.
    //
    // Nothing else would ever tear it down. Teardown is reached from `disposeRegions`, which walks
    // the child record, and this component never got an entry in one: `render()` threw before there
    // were children, or `@created` threw before `render()`. So it is unreachable and whatever it
    // took leaks for the life of the page.
    //
    // Runs unconditionally, not only when @created completed. @destroyed may
    // therefore see a half-initialised component and has to tolerate that —
    // `runCleanup` already isolates a throwing cleanup so one bad @destroyed
    // cannot take the rest with it. Leaking less was preferred to the more
    // predictable rule of skipping cleanup for a component that never finished
    // mounting.
    lifecycleCleanupManagement(component);
    throw e;
  } finally {
    if (__DEV__) {
      timerOwner.component = previousTimerOwner;
    }
  }
}

function buildComponent(
  component: BaseComponent,
  vnode: VNodeComponent,
  runtime: Runtime,
  skipEnv: "client" | "server",
  lintBefore: ReturnType<typeof snapshotOwnProps> | undefined,
  owner: unknown,
  parent: ChildNode,
): ComponentRegion {
  const componentRuntime = component[COMPONENT_RUNTIME];

  for (const create of runtime.creates) {
    if (create.env !== skipEnv) create.cb(componentRuntime.env);
  }

  // Record each watchProp selector's starting value; mount is not a change, so
  // no callback fires here.
  seedWatchProps(component);

  /**
   * The render's children go straight into the region — there is no element in between.
   *
   * Built detached, exactly as a plain child is: `reconcileEntries` hands its nodes over uninserted
   * and the CALLER's reorder places them, after the nodes this render drops have been unmounted.
   * `flattenEntries` walks into this region, so a fresh component's nodes are in the parent's
   * ordered list without the parent knowing there is a region there at all.
   */
  const children = generateRenderOutput(component);
  const unclaimed: (EnhancedChildNode | DONE)[] = [];
  const inner = reconcileEntries(children, [], undefined, component, parent, unclaimed);

  const region: ComponentRegion = {
    owner,
    definition: vnode.name,
    instance: component,
    entries: inner.entries,
    parent,
  };

  componentRuntime.region = region;

  // Queued, not called: the nodes are inserted by the CALLER after this returns, so running any of
  // this here meant running it before they were in the document. Queued in the order they used to
  // run — mounts, lint, then effects — so only the timing moved. See core/commit.ts.
  for (const mount of runtime.mounts) {
    if (mount.env !== skipEnv) queuePostCommit(component, () => mount.cb(componentRuntime.env));
  }

  if (__DEV__) {
    // After the mounts, as before: this lint is about fields @created AND @mounted
    // set, so it has to see both.
    if (lintBefore) {
      queuePostCommit(component, () => lintUnpersistedState(component, lintBefore));
    }
  }

  // Deferred with the rest, not left inline: this runs effects for the first time, and running it
  // inline would move it ahead of @mounted. No-op on the server.
  queuePostCommit(component, () => runComponentEffects(component));
  return region;
}

function componentFactory(component: ComponentClassKind, props: Record<string, unknown>, ctx: Context): BaseComponent {
  return new component(props, ctx);
}
