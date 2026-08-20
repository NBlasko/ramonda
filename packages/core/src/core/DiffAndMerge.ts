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
  HAS_LIST,
  CHILD_RECORD,
  ORIGIN_SYM,
  REF_SYM,
  PROPS_GATE,
  STABLE_PROPS,
} from "../helpers/constants";
import { generateRenderOutput } from "../helpers/generateRenderOutput";
import { isListNode } from "../vdom/guards";
import { hostTagMatches } from "../helpers/hostTag";
import { queuePostCommit, flushAfterCommit } from "./commit";
import { lifecycleCleanupManagement } from "../helpers/lifecycleMenagement";
import { checkHostPlacement } from "../debug/hostPlacement";
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

export function diffAndMerge(
  vnode: VNode,
  placeholderComponent: MaybeComponent,
  maybeenhancedNode: MaybeEnhancedNode | EnhancedChildNode,
): EnhancedNode | EnhancedChildNode {
  if (vnode.type === TEXT_TYPE) {
    return executeChangesOnStringNode(vnode, placeholderComponent, maybeenhancedNode);
  }

  return createOrUpdateComponent(vnode, placeholderComponent, maybeenhancedNode);
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
    if (__DEV__) {
      checkHostPlacement(parent, diff);
      checkNesting(parent, diff);
    }
    return diff;
  } catch (e) {
    errorHandler(e, placeholderComponent);
  }
}

/**
 * Builds a child and appends it. The ROOT mounts use this — `bootstrap` and
 * `renderToString` have an empty container and nothing to reorder, so there is
 * no teardown for the insertion to race with.
 */
export function mountNode(
  vchild: ComponentChild,
  placeholderComponent: MaybeComponent,
  enhancedNode: ChildNode,
): ChildNode | undefined {
  const built = buildDetachedNode(vchild, placeholderComponent, enhancedNode);
  if (built) enhancedNode.appendChild(built);
  return built;
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

  if (!vnodeChildren) {
    // `childNodes` is a live NodeList and unmounting calls `.remove()` — snapshot
    // it first, otherwise the list shrinks mid-iteration and skips children.
    const EnhancedChildNodes = Array.from(enhancedNode.childNodes as unknown as EnhancedChildNode[]);
    unmountChildrenNodes(EnhancedChildNodes, false);
    // Everything under this element is gone, so any list record describes nodes
    // that no longer exist. Left behind, it would be read as truth next render —
    // and its regions would keep their items subscribed to whatever they read.
    releaseListRecord(enhancedNode as EnhancedChildNode);

    return enhancedNode;
  }

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
  // O(1): `flattenMixedArray` marked the array when it kept a list in it. The
  // record check catches the render where the last list just disappeared.
  const hasList = (vnodeChildren as { [HAS_LIST]?: boolean })[HAS_LIST] === true;

  if (hasList || owner[CHILD_RECORD] !== undefined) {
    return applyDiffWithRegions(vnodeChildren, placeholderComponent, owner, hasList);
  }

  const enhancedChildNodes = enhancedNode.childNodes as unknown as EnhancedChildNode[];
  const cloneChildren: (EnhancedChildNode | DONE)[] = [];
  for (let i = 0; i < enhancedChildNodes.length; i++) {
    cloneChildren[i] = enhancedChildNodes[i];
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
 */
function stampSlot(node: EnhancedChildNode, slot: number, keyed: boolean): void {
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

/** A record entry is either a DOM node or a region; only the region has `owner`. */
function isRegion(entry: RecordEntry): entry is ListRegion {
  return (entry as ListRegion).owner !== undefined;
}
/**
 * The path for an element that owns at least one list.
 *
 * Previous state comes from the element's record rather than from `childNodes`,
 * because the DOM has nowhere to say "these three nodes are that list".
 */
function applyDiffWithRegions(
  vnodeChildren: unknown[],
  placeholderComponent: MaybeComponent,
  enhancedNode: EnhancedChildNode,
  hasList: boolean,
) {
  const previous = enhancedNode[CHILD_RECORD] ?? (Array.from(enhancedNode.childNodes) as unknown as RecordEntry[]);

  const unclaimed: (EnhancedChildNode | DONE)[] = [];
  const result = reconcileEntries(vnodeChildren, previous, undefined, placeholderComponent, enhancedNode, unclaimed);

  // Kept only while this element still owns a list — every other element pays
  // nothing and keeps reading childNodes exactly as before.
  enhancedNode[CHILD_RECORD] = hasList ? result.entries : undefined;

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
  // Looked up by owner, never by position: a list keeps its nodes even when it
  // moves among its siblings.
  const previousRegions = new Map<unknown, ListRegion>();

  for (const entry of previous) {
    if (isRegion(entry)) previousRegions.set(entry.owner, entry);
    else cloneChildren.push(entry);
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
      const before = previousRegions.get(rawVchild.owner);
      previousRegions.delete(rawVchild.owner);

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

  // A list that is no longer rendered, and children that were not claimed.
  for (const region of previousRegions.values()) {
    collectRegionNodes(region, unclaimed);
    // The nodes go to `unclaimed` to be unmounted, but the engine is reachable
    // only from here — the region entry itself is about to be dropped.
    region.engine?.dispose();
    disposeRegions(region.entries);
    changed = true;
  }
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

export function flattenEntries(entries: RecordEntry[], out: ChildNode[]): void {
  for (const entry of entries) {
    if (isRegion(entry)) flattenEntries(entry.entries, out);
    else out.push(entry);
  }
}

function collectRegionNodes(region: ListRegion, out: (EnhancedChildNode | DONE)[]): void {
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
 * after me") cascades: `mountNode` appends new children at the END, so inserting
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

function createOrUpdateComponent(
  vnode: VNodeComponent,
  placeholderComponent: MaybeComponent,
  enhancedNode: MaybeEnhancedNode | EnhancedChildNode,
): EnhancedHTMLNode | EnhancedChildNode {
  if (!enhancedNode) return createComponent(vnode, placeholderComponent);
  if (enhancedNode._componentDefinition !== vnode.name) return createComponent(vnode, placeholderComponent);
  // Same class is not enough when @Host takes its tag from props: two <Card>s
  // with a different `as` would otherwise reuse each other's element and carry
  // the wrong tag. See helpers/hostTag.ts.
  if (!hostTagMatches(vnode, enhancedNode)) return createComponent(vnode, placeholderComponent);

  const component = enhancedNode._componentInstance;

  if (!component) return createComponent(vnode, placeholderComponent);

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

  // Before the props comparison, and independent of it: a ref is not data the
  // component renders from, so it is neither compared with the props nor gated
  // on them changing.
  applyRefFromProps(enhancedNode, nextProps.ref);
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

  return enhancedNode;
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
    if (!isRegion(entry)) continue;
    entry.engine?.dispose();
    // Regions nest, and only the outermost is reachable from the record.
    disposeRegions(entry.entries);
  }
}

function releaseListRecord(node: EnhancedChildNode): void {
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
  releaseListRecord(node);

  const component = node._componentInstance;
  if (component) {
    lifecycleCleanupManagement(component);
    node._componentInstance = undefined;
  }
}

function loopThroughSoonToBeRemovedNodes(childNodes: NodeListOf<EnhancedChildNode>) {
  for (const child of childNodes) {
    if (child.childNodes.length > 0) {
      loopThroughSoonToBeRemovedNodes(child.childNodes as NodeListOf<EnhancedChildNode>);
    }

    releaseRef(child);
    releaseListRecord(child);

    const component = child._componentInstance;

    if (component) {
      lifecycleCleanupManagement(component);
      child._componentInstance = undefined;
    }
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

  if (typeof virtualNode.name === "string") {
    // A component's HOST element has the same nodeName as a plain element of
    // that tag, so nodeName alone is not enough to tell them apart — and getting
    // it wrong is silent and expensive.
    //
    // `{on ? <Child /> : <span>gone</span>}`, where Child is @Host("span"),
    // used to claim Child's host for the plain <span>: the node was reused, the
    // component instance was dropped on the floor, and nothing tore it down. No
    // @destroyed, no effect cleanups — its subscriptions, intervals and listeners
    // ran for the life of the page. Not even RMD006 fired, because the timer
    // guard lives in the teardown that never happened.
    //
    // Measured: `{on ? <Child /> : null}` cleaned up correctly, the ternary with
    // an element did not. The reverse direction was always safe — a plain
    // element has no `_componentDefinition`, so it can never be claimed FOR a
    // component. Only this side was open.
    if (enhancedNode._componentDefinition !== undefined) return false;
    return enhancedNode.nodeName === virtualNode.name;
  }

  return enhancedNode._componentDefinition === virtualNode.name && hostTagMatches(virtualNode, enhancedNode);
}

function createComponent(
  vnode: VNodeComponent,
  placeholderComponent: MaybeComponent,
): EnhancedHTMLNode | EnhancedChildNode {
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
    return buildComponent(component, vnode, runtime, skipEnv, lintBefore);
  } catch (e) {
    // The build failed, but the component was already CONSTRUCTED and its
    // @created may already have run and taken something — a subscription, a
    // hand-written listener, an open connection.
    //
    // Nothing else would ever tear it down. Teardown is reached from
    // `unmountChildrenNodes`, which walks the DOM, and this component's host was
    // never inserted anywhere: `render()` threw before there was one, or
    // `@created` threw before `render()`. So it is unreachable and whatever it
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
): EnhancedHTMLNode | EnhancedChildNode {
  const componentRuntime = component[COMPONENT_RUNTIME];

  for (const create of runtime.creates) {
    if (create.env !== skipEnv) create.cb(componentRuntime.env);
  }

  // Record each watchProp selector's starting value; mount is not a change, so
  // no callback fires here.
  seedWatchProps(component);

  const rendered = generateRenderOutput(component);

  const enhancedNode = diffAndMerge(rendered, component, undefined);

  enhancedNode._componentInstance = component;
  enhancedNode._componentDefinition = vnode.name;
  enhancedNode[ORIGIN_SYM] = vnode[ORIGIN_SYM];
  // `<Child ref={r} />` — a component is exactly one element (1-1), so the ref
  // points at its host. It used to be accepted and silently do nothing, because
  // a component's props never reach applyChangesOnAttributes.
  applyRefFromProps(enhancedNode, vnode.attributes?.ref);
  componentRuntime.enhancedNode = enhancedNode;

  // Queued, not called: the host element is inserted by the CALLER after this
  // returns, so running any of this here meant running it before the element was
  // in the document. Queued in the order they used to run — mounts, lint, then
  // effects — so only the timing moved. See core/commit.ts.
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

  // Deferred with the rest, not left inline: this is what attaches @onElement
  // listeners and runs effects for the first time, and running it inline would
  // move it ahead of @mounted. No-op on the server.
  queuePostCommit(component, () => runComponentEffects(component));
  return enhancedNode;
}

/**
 * Points a component's ref at its host, and releases the one it replaces.
 *
 * Called on UPDATE as well as on creation, and that is the whole point. It used
 * to run from `createComponent` alone, so a component that stayed put while its
 * `ref` prop changed kept the ref it was born with: the new one never filled, and
 * the old one went on pointing at a host that no longer claimed it. Both silent,
 * and the opposite of what the same JSX does on a plain element — `Attribute.ts`
 * has released and re-pointed an element's ref all along.
 *
 * A ref is not a render input, so this is deliberately outside the props-changed
 * branch: pointing a ref somewhere else changes nothing the component renders,
 * and it must happen even when nothing schedules a render.
 */
export function applyRefFromProps(node: EnhancedChildNode, ref: unknown): void {
  type RefHandle = { current: unknown; setCurrent(current: unknown): void };

  const next = ref as RefHandle | undefined;
  const previous = node[REF_SYM];
  if (previous === next) return;

  node[REF_SYM] = next;

  // Cleared only if it still points HERE — the same guard `releaseRef` needs,
  // and for the same reason: another node may already have claimed it earlier in
  // this pass, and wiping it then would erase a value that is now correct.
  if (previous && previous.current === node) previous.setCurrent(null);
  next?.setCurrent(node);
}

function componentFactory(component: ComponentClassKind, props: Record<string, unknown>, ctx: Context): BaseComponent {
  return new component(props, ctx);
}
