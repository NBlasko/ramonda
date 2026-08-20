import type { VNode, ListNode } from "../types/vdom";
import { IS_LIST, attach, detach } from "../helpers/constants";
import { isListNode } from "../vdom/guards";
import { trackerContainer } from "../reactivity/tracker";
import type { State } from "../reactivity/State";
import { diagnose } from "../debug/diagnostics";
import { checkRowStability, isStrictRender } from "../debug/renderStability";
import { identityOf, stampIdentity, carryIdentity } from "./itemIdentity";
import { createId } from "./createId";
import type { Each, ItemRender } from "../base/list";

/** Listener ids must be unique across every signal, not just within one list. */
let scopeSequence = 0;

/**
 * DEV-only: builds the row a SECOND time and reports what came out different — RMD020, for the one
 * position its double render cannot reach.
 *
 * `list()` is lazy on purpose: the second render rebuilds the descriptor, and the builder is called
 * from here instead. So an inline handler or a rebuilt object inside a row was silent, while the
 * same thing written outside a list was reported. This is the same check, in the only place that has
 * two builds of a row to compare.
 *
 * ## Why HERE and not in `render()`
 *
 * Two reasons, and the second is the expensive one. A row built during `render()` would be built
 * outside its item scope, so its signal reads would register against whatever tracker the render
 * has — changing which dependencies exist, in development only. And it would build every row on
 * every render, including the ones the engine was about to REUSE. Here, only a row that is actually
 * being built is built twice, so a list whose rows are all reused pays nothing at all.
 *
 * ## The tracker is detached for the second build
 *
 * `null` — not the item scope, and not the enclosing one. The second vnode is thrown away, so its reads
 * must not add dependencies that would invalidate rows nothing read, and must not land in an enclosing
 * `@compute` either.
 */
function checkRow<T>(host: ListHost, item: T, render: ItemRender<T>, first: VNode | null | undefined): void {
  if (!isStrictRender() || first === null || first === undefined) return;

  const previous = trackerContainer.current;
  trackerContainer.current = null;
  let second: VNode | null | undefined;
  try {
    second = render(item);
  } finally {
    trackerContainer.current = previous;
  }

  if (second === null || second === undefined) return;
  checkRowStability(host.name, "row", first, second);
}

/**
 * Names what came back instead of an element, in the words the writer would use.
 *
 * "an object" for a nested `list()` would send someone looking for a stray object
 * literal; the nested list is the mistake worth naming, because it is the one a
 * reasonable person makes.
 */
function describe(value: unknown): string {
  if (Array.isArray(value)) return "an array";
  if (isListNode(value)) return "a nested `list()`";
  return `a ${typeof value}`;
}

/**
 * One item's reactive scope: the vnode it produced, and the signals reading it
 * touched. While none of those changed and the item is the same object, the
 * mapper does not run again and the diff does not walk into its subtree.
 *
 * This is what Solid gets from never re-running the component body. Ramonda does
 * re-render, so the equivalent has to be per item and explicit — but the effect
 * is the same: work is proportional to what changed, not to the list length.
 */
interface ItemScope<T> {
  listenerId: number;
  item: T;
  /**
   * The position the vnode was built at.
   *
   * Not part of the item, and not a signal — it is where the item sat in `each`
   * last pass. A reorder changes it while changing nothing else the skip looks
   * at, so it is checked separately, and only for a mapper that can see it.
   */
  index: number;
  vnode: VNode;
  deps: Set<State<unknown>>;
  dirty: boolean;
  addDep(state: State<unknown>): void;
}

/** What the engine needs from whoever owns the list. */
export interface ListHost {
  /**
   * Schedules a re-render of the component the list belongs to.
   *
   * A signal an item read usually re-renders that component by itself, but not
   * when it belongs to something else. Asking explicitly makes an item's
   * staleness impossible to sit on; the queue de-duplicates.
   */
  reBuild(): void;
  /** Names the owner in a diagnostic. */
  name: string;
}

/**
 * The whole list algorithm: minted identity, per-item reactive scopes, and the
 * whole-list skip.
 *
 * Extracted when the `For` hook and `list()` briefly coexisted, so the subtlety
 * lived in one place. `For` is gone; the split is kept because the engine holds
 * only STATE, and the diff owning where that state lives is what makes a region
 * per parent and per position for free.
 */
export class ListEngine<T> {
  /**
   * item → the ids minted for it, one per occurrence.
   *
   * An array rather than a single id so a list may legitimately contain the same
   * item twice (`[tag, tag]`): the 2nd occurrence gets its own id and both rows
   * stay stable. Reference identity cannot tell two occurrences apart, and
   * neither could a hand-written key.
   */
  private ids = new Map<T, string[]>();
  /** key → the scope that produced its vnode last render. */
  private scopes = new Map<string, ItemScope<T>>();

  /** The array and the result of the last full pass, for the whole-list skip. */
  private lastEach: readonly T[] | undefined;
  /**
   * The row callback from last pass, and the whole of how a stale capture is refused.
   *
   * ## What it decides
   *
   * A row is reused when nothing it READ has moved. That is exact for what the callback reads inside
   * itself — the tracker records every such read, at any call depth, in any module. It is blind to a
   * value read OUTSIDE and closed over:
   *
   * ```tsx
   * const label = this.label;                                  // read here
   * list(rows, () => <li>{label}</li>)                          // row tracks nothing
   * ```
   *
   * The row then depends on nothing, is never invalidated, and serves the first `label` for the life
   * of the list. Measured before this existed: `"old"` where the same field outside the list read
   * `"new"`.
   *
   * ## Why the reference answers it
   *
   * Nothing can look inside a closure and enumerate what it captured. But a closure that could have
   * captured a render's locals is, by construction, CREATED in that render — so its reference is new.
   * A callback that cannot capture is written where a render cannot reach it, and its reference is
   * stable. Measured over three renders: a class method gives 1 distinct reference, a module-level
   * function 1, an inline arrow 3.
   *
   * So one identity check classifies every form correctly, with no form detection and nothing static:
   * a method or a module-level function keeps the fast path, and a fresh closure rebuilds.
   *
   * ## What rebuilding costs, measured
   *
   * 10 000 rows, five re-renders from an unrelated signal: the stable form does 0 row builds, the
   * inline form does 50 000 — and **both do 5 DOM writes.** The diff finds the rows equal and touches
   * nothing. So the cost is JS only, closures and small objects, and the expensive half of a render is
   * untouched. That is what a framework without this cache does for every list, every render.
   *
   * Wall clock cannot measure it here — jsdom swings wider than the effect, and one attempt was
   * outright invalid — so the operation counts above are the claim.
   */
  private lastBuilder: ItemRender<T> | undefined;
  private lastNode: ListNode | undefined;
  /** Set by any scope's invalidation; cleared when a full pass runs. */
  private anyDirty = false;
  /** Set by `buildItem` so the caller can store the scope it just refreshed. */
  private lastScope: ItemScope<T> | undefined;
  /** Whether last pass's rows carried keys of their own. See `keyed`. */
  private wasKeyed = false;

  build(descriptor: ListDescriptor<T>, host: ListHost, owner: unknown): ListNode {
    const each = descriptor.each;
    const render = descriptor.builder;

    /**
     * No array at all — `undefined` while data is loading, or a conditional that has gone away.
     *
     * The remembered pass has to be FORGOTTEN here, and not remembering it was a bug that predates
     * `lastBuilder`: `wrap` below sets `lastNode` to this empty node while `lastEach` still holds the
     * array from before, so handing the SAME array back later matched the whole-list skip against an
     * empty node and rendered nothing, for ever. Measured on `main` as well as here —
     * `rows → undefined → the same rows` gave 2 rows, then 0, then 0.
     */
    if (!each) {
      this.lastEach = undefined;
      this.lastBuilder = undefined;
      return this.wrap(owner, []);
    }

    // A callback this pass did not have last pass may have closed over anything, so neither skip
    // below is safe for it. See `lastBuilder`.
    const builderChanged = render !== this.lastBuilder;
    this.lastBuilder = render;

    // Whole-list skip. The array is replaced on every change (mutating it in
    // place is reported as RMD005), so the SAME reference plus no invalidated
    // scope means nothing about this list can differ from last render — not one
    // item, not the order, not the length. Handing back the identical ListNode
    // object tells the diff the same thing, and it leaves the region untouched.
    //
    // Measured 30ms → 0.06ms on 10000 items.
    //
    // `builderChanged` belongs HERE as much as on the per-row check, and forgetting it here is the
    // subtle half: this returns the cached node without calling the callback at all, so a fresh
    // closure would never run and the stale capture would survive every render.
    if (each === this.lastEach && !this.anyDirty && !builderChanged && this.lastNode !== undefined) {
      return this.lastNode;
    }

    this.anyDirty = false;
    const before = this.lastEach;
    this.lastEach = each;

    /**
     * Whether identity has already been carried from last pass's array to this
     * one, done ONCE and only when something needs it.
     *
     * The trigger is a reference that missed, which is precisely the signal that
     * an array came from outside — a refetch, a deserialize. An update that kept
     * its references never misses, so it never runs this: measured at 10 000 rows,
     * 1.02 ms for an untouched array and 2.12 ms for a local edit, against 14.94 ms
     * for a refetch that replaced every object. The list only pays where the
     * alternative was destroying and rebuilding every row.
     */
    let aligned = false;

    /**
     * How many rows carried a key of their own, out of how many there were.
     *
     * Remembered for the NEXT pass, where it decides whether aligning the two
     * arrays is worth starting: a list whose every row answers "which row is
     * this" from a key would never read the result.
     *
     * **Every row, not any row.** Counting "any" made a list where only some rows
     * are keyed WORSE than one with none: the alignment was skipped for all of
     * them, so the unkeyed rows had nothing left to be recognised by. Measured on
     * three rows with a key on the first — one row survived a refetch instead of
     * three, and the marked row was lost. A list that is only partly keyed is
     * unusual and is exactly the shape a half-finished migration leaves behind,
     * which is when it must not silently get worse.
     */
    let rows = 0;
    let keyedRows = 0;
    /** The keys rows wrote for themselves this pass, for the collision check. */
    let yours: Set<unknown> | undefined;

    const seen = new Map<T, number>();
    const next = new Map<T, string[]>();
    const out: VNode[] = [];
    const clean: boolean[] = [];
    const nextScopes = new Map<string, ItemScope<T>>();

    for (let i = 0; i < each.length; i++) {
      const item = each[i];

      // The key is settled BEFORE anything is built — it is what finds the
      // item's scope, and the whole point is to decide without calling the
      // mapper at all.
      //
      // Which occurrence of this exact item is this?
      const occurrence = seen.get(item) ?? 0;
      seen.set(item, occurrence + 1);

      let carried = next.get(item);
      if (!carried) {
        carried = [];
        next.set(item, carried);
      }
      // Reuse the id this occurrence had last render, or mint a new one.
      // Dropping the rest of `this.ids` is the pruning: an item that left the
      // list is simply not carried over, so the map cannot grow forever.
      const previous = this.ids.get(item);
      let id: string | undefined = carried[occurrence] ?? previous?.[occurrence];

      // The reference missed, so this object is new HERE — but it may be a row
      // that already exists, handed over as a fresh object by a refetch. Align
      // the two arrays once, and then the identity is on the item to be read.
      // Only the first occurrence: a second one is a second row and mints its own.
      if (id === undefined && occurrence === 0 && !this.wasKeyed) {
        if (!aligned && before !== undefined) {
          carryIdentity(before, each, host.name);
          aligned = true;
        }
        id = identityOf(item);
      }

      if (id === undefined) {
        // From the process-wide counter, not a per-list one. A per-list counter
        // was right while identity lived in the region: two lists both starting
        // at `f0` could not see each other, because neither id ever left. It
        // travels with the ITEM now, so the same object shown in a second list
        // carries `f0` into a list that has already minted `f0` for a different
        // row — one key on two rows, and the diff hands one row's node to the
        // other. A global id cannot collide with one carried in from anywhere.
        id = `f${createId()}`;
        // Written onto the item, so the array that replaces this one can carry
        // it across — see `carryIdentity`.
        stampIdentity(item, id);
      }
      carried[occurrence] = id;
      const key = id;

      const scopeKey = key;
      const existing = this.scopes.get(scopeKey);

      // Nothing this item's output depends on has changed, it is still the same
      // object, it has not moved out from under a mapper that reads the position,
      // and the callback is one that cannot have captured anything new: reuse last
      // render's vnode untouched. `clean` tells the diff it may skip the subtree
      // entirely.
      if (existing && existing.item === item && !existing.dirty && !builderChanged) {
        rows++;
        if (existing.vnode.attributes?.key != null) keyedRows++;
        out.push(existing.vnode);
        clean.push(true);
        this.claimScope(nextScopes, scopeKey, existing);
        continue;
      }

      const vnode = this.buildItem(item, i, existing, render, host);

      // Guards production too: skipping a null keeps the list intact instead of
      // crashing on `.attributes` below.
      if (vnode === null || vnode === undefined) {
        if (__DEV__) {
          diagnose("RMD013", `${host.name}:empty`, `The render callback produced nothing for item ${i}.`);
        }
        continue;
      }

      // One item is one element, because the key is written onto it below and the
      // key is what the diff matches rows on. Anything else — a string, a number,
      // an array, a nested `list()` — has no `attributes`, and the assignment used
      // to throw "Cannot set properties of undefined", which named the line rather
      // than the mistake. Guards production too: skipping keeps the list rendering.
      if (typeof vnode !== "object" || (vnode as { attributes?: unknown }).attributes === undefined) {
        if (__DEV__) {
          diagnose(
            "RMD031",
            `${host.name}:not-an-element`,
            `The render callback returned ${describe(vnode)} for item ${i}.`,
          );
        }
        continue;
      }

      // YOUR key wins, and this only fills in when there is none.
      //
      // That order is the whole rule. While the row is the same OBJECT it is
      // recognised without either — the scope was found by the item itself, up
      // there. A key matters exactly when the object is new (a refetch, a `for`
      // and `push` in a `@compute`), and then it is the one thing that still
      // says which row this is. Overwriting it, which is what this used to do,
      // threw away the only reliable answer and left the guessing below to
      // reconstruct it.
      //
      // With no key the minted id goes on instead, so a list that declares
      // nothing behaves exactly as it did.
      rows++;
      if (vnode.attributes.key == null) {
        vnode.attributes.key = key;
      } else {
        keyedRows++;
        if (__DEV__) {
          // Two rows answering the same key. Free to notice — the rows are being
          // walked anyway — and worth saying loudly, because the field you chose
          // is not unique and the DOM match it drives will hand one row's node to
          // another. The row itself is not lost: its scope was found by the OBJECT
          // above, and the fallback below still has something to say. See RMD002.
          const already = (yours ??= new Set()).size;
          yours.add(vnode.attributes.key);
          if (yours.size === already) {
            diagnose(
              "RMD002",
              `${host.name}:${String(vnode.attributes.key)}`,
              `Two rows rendered by ${host.name} carry the key "${String(vnode.attributes.key)}".`,
              { owner: host.name, key: String(vnode.attributes.key) },
            );
          }
        }
      }

      out.push(vnode);
      clean.push(false);
      this.claimScope(nextScopes, scopeKey, this.lastScope!);
    }

    this.ids = next;
    // Every row, or none of it counts — see the note on `keyedRows`.
    this.wasKeyed = rows > 0 && keyedRows === rows;

    // Scopes for items that left: unsubscribe, or their signals keep a live
    // reference to a list entry that no longer exists.
    for (const [scopeKey, scope] of this.scopes) {
      if (nextScopes.get(scopeKey) === scope) continue;
      this.releaseScope(scope);
    }
    this.scopes = nextScopes;

    return this.wrap(owner, out, clean);
  }

  /**
   * Stores this pass's scope for a key, releasing whatever it displaces.
   *
   * Two items answering the same key is user error, reported in DEV as RMD002 twenty lines above,
   * but the map only holds one scope per key — so the first item's scope was
   * overwritten here after it had already subscribed to everything its mapper
   * read. It was then in neither map: gone from this pass's, never in the
   * previous pass's, so the cleanup loop that detaches the scopes which did not
   * carry over could not reach it. A live subscription with no owner, calling
   * `host.reBuild()` for an item that does not exist for the life of the page,
   * and marking the engine dirty each time, which defeats the whole-list skip.
   */
  private claimScope(nextScopes: Map<string, ItemScope<T>>, scopeKey: string, scope: ItemScope<T>): void {
    const shadowed = nextScopes.get(scopeKey);
    if (shadowed !== undefined && shadowed !== scope) this.releaseScope(shadowed);
    nextScopes.set(scopeKey, scope);
  }

  /** Unsubscribes a scope from every signal its mapper read. */
  private releaseScope(scope: ItemScope<T>): void {
    for (const dep of scope.deps) dep[detach](scope.listenerId);
    scope.deps.clear();
  }

  /**
   * Runs the mapper for one item inside its own tracker, so every signal it
   * reads is recorded against that item and nothing else.
   *
   * Reusing the scope object when the item is unchanged keeps the listener id
   * stable, which means the signals it is already attached to need no churn.
   */
  private buildItem(
    item: T,
    index: number,
    existing: ItemScope<T> | undefined,
    render: ItemRender<T>,
    host: ListHost,
  ): VNode | null | undefined {
    const scope: ItemScope<T> = existing ?? {
      listenerId: ++scopeSequence,
      item,
      index,
      vnode: undefined as unknown as VNode,
      deps: new Set(),
      dirty: false,
      addDep(state: State<unknown>) {
        this.deps.add(state);
      },
    };

    // Drop last run's subscriptions before recording this run's: a branch taken
    // last time may not be taken now, and a stale dep would keep invalidating.
    for (const dep of scope.deps) dep[detach](scope.listenerId);
    scope.deps.clear();

    const previousTracker = trackerContainer.current;
    trackerContainer.current = scope;

    let vnode: VNode | null | undefined;
    try {
      vnode = render(item);
    } finally {
      // Restored rather than nulled: a list may be built from inside a @compute,
      // and that tracker still has reads to collect after this returns.
      trackerContainer.current = previousTracker;
    }

    if (__DEV__) checkRow(host, item, render, vnode);

    for (const dep of scope.deps) {
      dep[attach]({
        id: scope.listenerId,
        onChange: () => {
          scope.dirty = true;
          this.anyDirty = true;
          host.reBuild();
        },
      });
    }

    scope.item = item;
    scope.index = index;
    scope.dirty = false;
    if (vnode !== null && vnode !== undefined) scope.vnode = vnode;
    this.lastScope = scope;

    return vnode;
  }

  private wrap(owner: unknown, vnodes: VNode[], clean: boolean[] = []): ListNode {
    const node: ListNode = { [IS_LIST]: true, owner, vnodes, clean };
    this.lastNode = node;
    return node;
  }

  /**
   * Unsubscribes every scope. Without it, a signal an item read keeps a live
   * reference to a list entry that no longer exists — `For` called this from its own
   * `@destroyed`; a `list()` region is released by `disposeRegions` in
   * DiffAndMerge, which is the only thing that can reach it.
   */
  dispose(): void {
    for (const scope of this.scopes.values()) {
      for (const dep of scope.deps) dep[detach](scope.listenerId);
      scope.deps.clear();
    }
    this.scopes.clear();
    // The cached result would otherwise keep the last vnode tree alive too.
    this.lastNode = undefined;
    this.lastEach = undefined;
    this.lastBuilder = undefined;
  }
}

/** What `list()` puts on the descriptor: the items, and the one way to build one. */
export interface ListDescriptor<T> {
  readonly each: Each<T>;
  readonly builder: ItemRender<T>;
}

/** A descriptor `list()` produced, before its items have been built. */
export interface LazyListNode<T = unknown> extends ListDescriptor<T> {
  readonly [IS_LIST]: true;
  owner: unknown;
}

/**
 * Distinguishes a `list()` descriptor from a `ListNode` whose items are built.
 *
 * By the presence of `builder` and the absence of `vnodes`, because those are
 * exactly what differs: a built list arrives with its items, a descriptor
 * arrives with the instructions to build them.
 */
export function isLazyList(node: unknown): node is LazyListNode {
  return (
    node !== null &&
    typeof node === "object" &&
    (node as { [IS_LIST]?: true })[IS_LIST] === true &&
    (node as { builder?: unknown }).builder !== undefined &&
    (node as { vnodes?: unknown }).vnodes === undefined
  );
}

/**
 * Builds a descriptor's items, reusing the engine the region already had.
 *
 * Shared by the diff and by hydration, and it has to be: hydration reads
 * `vnodes` off the node, which a descriptor does not have until this runs. The
 * engine it returns must be stored on the region entry, or the FIRST render
 * after hydration finds no state and rebuilds the whole list — the same class of
 * bug as "hook options were never refreshed after a state restore".
 */
export function buildLazyList(
  descriptor: LazyListNode,
  engine: ListEngine<unknown> | undefined,
  host: ListHost,
): { node: ListNode; engine: ListEngine<unknown> } {
  const used = engine ?? new ListEngine<unknown>();
  return {
    node: used.build(descriptor, host, descriptor.owner),
    engine: used,
  };
}
