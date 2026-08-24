import { COMPONENT_TYPE, CHILD_RECORD, ORIGIN_SYM, REQUEST_ATTR } from "../helpers/constants";
import { installClientRequestScope } from "./requestContext";
import { applyChangesOnAttributes, formatAttributes } from "../core/Attribute";
import { generateRenderOutput } from "../helpers/generateRenderOutput";
import { seedWatchProps } from "../helpers/watchProps";
import { runComponentEffects } from "../reactivity/effect";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME, INTERNAL_HOOKS } from "../core/runtime";
import {
  buildComponentRegion,
  componentRegionOwner,
  diffAndMerge,
  filterVirtualChild,
  flattenEntries,
  listHostFor,
} from "../core/DiffAndMerge";
import { isComponentClose, isComponentOpen, markerBlob } from "../core/componentMarker";
import { isListNode, isVNode } from "../vdom/guards";
import { buildLazyList, isLazyList, type ListEngine, type LazyListNode, type ListHost } from "../helpers/listEngine";
import { restoreComponentTree } from "./restore";
import { queuePostCommit, flushPostCommit } from "../core/commit";
import { diagnose } from "../debug/diagnostics";
import { reportFault } from "../debug/fault";
import { isThenable } from "../core/serverWork";
import {
  reportTextMismatch,
  reportStructureMismatch,
  reportChildCountMismatch,
  reportAttributeMismatches,
} from "../debug/hydrationMismatch";
import type {
  BaseComponent,
  RecordEntry,
  ComponentChild,
  MaybeComponent,
  VNode,
  VNodeComponent,
  VNodeString,
  EnhancedChildNode,
  ComponentRegion,
} from "../types/vdom";
import type { Context } from "../types/commonTypes";

/**
 * Hydrates a server-rendered subtree: instead of creating DOM, it ADOPTS the
 * existing server nodes, restores each component's state from the marker the server wrote in front
 * of its block, wires up the client-only bits (refs, effects, timers), and runs only the
 * `env: "client"` lifecycle (create/mount are considered already fired on the
 * server; their state is restored).
 *
 * Hydrating IS the server/client comparison: this renders on the client and
 * walks the result against the server's DOM, so divergence is detected at
 * comparisons the adopt path has to make anyway — that is why RMD007 needs no
 * second render. Where the two disagree the client wins (the DOM is patched)
 * and DEV reports it; a node of the wrong type falls back to building fresh.
 *
 * The one place the server DOM is NOT shaped like the vnode tree is text: HTML
 * has no way to record where one text node ends and the next begins, so an
 * adjacent run arrives fused. See hydrateText.
 */
export function hydrateRoot(vnode: ComponentChild, container: HTMLElement): void {
  // Before anything renders: whatever the server EXPOSED travels on the root element, and the
  // tree may read it through `requestContext()` while hydrating. Installed even when the page
  // carries no blob, so a read returns nothing and reports (RMD025) instead of throwing.
  installClientRequestScope(readExposedRequest(container));

  const vchild = filterVirtualChild(vnode);
  if (vchild === undefined) return;

  /**
   * The root goes through the ordinary level walk, so the container ends up with a record.
   *
   * That record is what a re-render of the root reconciles against — the same thing
   * `mountRootComponent` leaves behind on the client path. Adopting the root as a bare node was
   * enough while a component WAS a node; a region has to be recorded somewhere, and the container
   * is where.
   */
  const walk: HydrationWalk = { cursor: container.firstChild as EnhancedChildNode | null, count: 0 };
  const level = hydrateLevel([vchild], undefined, container, walk);
  if (level.hasRegion) (container as EnhancedChildNode)[CHILD_RECORD] = level.entries;
  flushPostCommit();
}

/**
 * Reads the exposed request blob the server stamped on the root element.
 *
 * A corrupt one is ignored rather than fatal — the same stance the state blob takes: a page that
 * renders with a value missing beats a page that does not render. **And it is REPORTED, which is
 * the other half of that stance and was missing.** The state blob has `RMD036` for exactly this;
 * this one used to return `undefined` in silence.
 *
 * Silence was expensive here, because two other diagnostics fire in its place and both point the
 * wrong way. Measured on a page whose blob was mangled after it was served: the reader gets
 * `RMD025`, which says a key was not exposed — it was — and `RMD007`, a hydration mismatch, whose
 * advice is about clocks and random numbers. Neither mentions the blob, and the page looks correct
 * because the server's markup is still on screen.
 */
function readExposedRequest(container: HTMLElement): Record<string, unknown> | undefined {
  const raw = container.firstElementChild?.getAttribute(REQUEST_ATTR);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    if (__DEV__) {
      diagnose("RMD058", "request-blob", "The request blob on the root element could not be parsed.", {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
    return undefined;
  }
}

/**
 * Adopts `cursor` (and possibly nodes after it) for `vchild`, and returns the
 * cursor the next sibling vnode should start from. Returning the position keeps
 * the walk correct even when a step inserts, replaces, or splits a node — an
 * index into a snapshot cannot survive any of those.
 */
function hydrateNode(
  vchild: ComponentChild,
  placeholder: MaybeComponent,
  cursor: EnhancedChildNode | null,
  parent: Node,
): EnhancedChildNode | null {
  if (typeof vchild === "string") {
    return hydrateText(vchild, placeholder, cursor, parent);
  }

  // A component is a region, and a region is adopted by `hydrateLevel` — it owns a RUN of siblings
  // rather than the one node this function is shaped around, and it has to produce a record entry.
  return hydrateElement(vchild as VNodeString, placeholder, cursor, parent);
}

function nextOf(node: EnhancedChildNode | null): EnhancedChildNode | null {
  return (node?.nextSibling ?? null) as EnhancedChildNode | null;
}

/**
 * Text is the one case where the server DOM is not shaped like the vnode tree:
 * `<span>Hello {name}!</span>` renders three text nodes, but serializing to HTML
 * drops the boundaries between them and parsing gives ONE node back. So an
 * adjacent run of text children all arrive fused into `cursor`.
 *
 * We take our own slice off the front with splitText, which restores the exact
 * boundary this vnode child expects and leaves the remainder for the next one.
 * That also makes the mismatch check precise: the server node must *start with*
 * the text we rendered, and anything else is real divergence (RMD007).
 */
function hydrateText(
  text: string,
  placeholder: MaybeComponent,
  cursor: EnhancedChildNode | null,
  parent: Node,
): EnhancedChildNode | null {
  if (cursor && cursor.nodeType === 3) {
    const found = (cursor as Text).data;

    if (found === text) return nextOf(cursor);

    if (found.startsWith(text)) {
      // Fused with the following text children — split our part off the front.
      (cursor as Text).splitText(text.length);
      return nextOf(cursor);
    }

    if (__DEV__) reportTextMismatch(placeholder, text, found);

    // Real divergence, so the boundary is unknowable — but the fused remainder
    // still belongs to the children after us. Cut our slice to the length we
    // rendered and leave the rest for them, or replacing this node would eat
    // their text and report them as missing too: one fault, one diagnostic.
    if (found.length > text.length) (cursor as Text).splitText(text.length);
    cursor.textContent = text;
    return nextOf(cursor);
  }

  if (__DEV__) {
    reportStructureMismatch(
      placeholder,
      `the text "${text}"`,
      cursor ? `<${cursor.nodeName.toLowerCase()}>` : "nothing",
    );
  }
  parent.insertBefore(document.createTextNode(text), cursor);
  return cursor;
}

function hydrateElement(
  vnode: VNodeString,
  placeholder: MaybeComponent,
  cursor: EnhancedChildNode | null,
  parent: Node,
): EnhancedChildNode | null {
  if (!cursor || cursor.nodeName !== vnode.name) {
    return hydrationFallback(vnode, placeholder, cursor, parent);
  }

  if (__DEV__) {
    // Before applyChangesOnAttributes, which silently overwrites the server's.
    reportAttributeMismatches(placeholder, cursor as unknown as Element, formatAttributes(vnode.attributes));
  }

  // Reconciling attributes attaches on* listeners and refs onto the server node.
  applyChangesOnAttributes(cursor, vnode.attributes);
  // Adopted nodes come from parsed HTML, so they carry no origin. Without this
  // the first client update finds every node "built by someone else" and
  // rebuilds the page it just adopted.
  cursor[ORIGIN_SYM] = vnode[ORIGIN_SYM];
  hydrateChildren(vnode.children, placeholder, cursor);
  return nextOf(cursor);
}

/**
 * Where a deferred block's markers are, until it resumes.
 *
 * A WeakMap rather than a field on the region: this is a hydration concern with a life measured in
 * one promise, and the region is a runtime type that every other path reads. Nothing outside this
 * file has any business knowing a component is waiting on markup.
 */
const deferredBlocks = new WeakMap<BaseComponent, { open: Comment; close: Comment | undefined; parent: Node }>();

/**
 * Adopts one component: the markers the server wrote around its nodes, the state on the opening
 * one, and then the ordinary walk over the children inside.
 *
 * The markers are what a record would have said if markup could carry one. The client re-renders
 * while it walks, so it already knows the SHAPE of the tree — what it cannot know is where one
 * component's run of siblings ends and the next begins, and that is the only question these answer.
 * Both are removed as soon as this component is adopted, so the page ends up holding exactly what a
 * client-side render would have produced.
 */
function hydrateComponentRegion(
  vnode: VNodeComponent,
  placeholder: MaybeComponent,
  parent: Node,
  walk: HydrationWalk,
  owner: unknown,
): ComponentRegion | undefined {
  const open = walk.cursor;

  /**
   * No marker where one belongs, so the server did not write this component.
   *
   * Building it is the only honest answer, and it is the same decision the element path makes when
   * a tag disagrees. Reported, because a client rendering a component the server did not is a real
   * divergence and the rest of this level is likely to be off by a block.
   */
  if (open === null || !isComponentOpen(open)) {
    if (__DEV__) {
      reportStructureMismatch(
        placeholder,
        `<${vnode.name.name}>`,
        open ? `<${open.nodeName.toLowerCase()}>` : "nothing",
      );
    }
    const region = buildComponentRegion(vnode, placeholder, owner, parent as ChildNode);
    for (const node of region.order) parent.insertBefore(node, open);
    return region;
  }

  const parentContext = placeholder?.[GLOBAL_RUNTIME].context;
  const context = Object.create(parentContext || null) as Context;
  const component = new vnode.name(vnode.attributes, context);
  const runtime = component[GLOBAL_RUNTIME];
  const componentRuntime = component[COMPONENT_RUNTIME];

  const placeholderRuntime = placeholder?.[COMPONENT_RUNTIME];
  if (placeholderRuntime) {
    componentRuntime.depth = placeholderRuntime.depth + 1;
    componentRuntime.parent = placeholder;
  }

  // Restore server state before any client lifecycle/render sees it. Note:
  // isInitialized is still falsy here, so the @state setters below don't enqueue
  // a spurious re-render — we're adopting, not re-rendering.
  const blob = markerBlob(open);
  if (blob) {
    try {
      restoreComponentTree(component, JSON.parse(blob));
    } catch (e) {
      if (__DEV__) {
        diagnose("RMD036", vnode.name.name, `The blob on <${vnode.name.name}> could not be parsed.`, {
          component: vnode.name.name,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // create/mount ran on the server (shared/server env) → skip; run client only.
  for (const create of runtime.creates) {
    if (create.env === "client") create.cb(componentRuntime.env);
  }

  // Re-evaluate every hook's options — AFTER the restore and AFTER @created.
  //
  // `useCommon` calls the options callback IMMEDIATELY, during construction — so
  // a hook's options were captured from the component's field initializers,
  // before the blob above replaced them. Restoring `@state` therefore leaves
  // every hook holding the pre-restore values, and nothing else on the hydration
  // path ever refreshes them: the build path does it at the top of `updateBuild`,
  // and hydration had no equivalent.
  //
  // The sharpest case is a list. Its identity is the ITEM — an object reference
  // — and a restored array is a JSON round trip, so those are new objects. It was
  // still holding the initializer's array, minted ids for those, and adopted the
  // server's DOM with them. The first reorder then handed it the restored
  // objects, which it had never seen, so it minted fresh ids (`f2`, `f3` against
  // the nodes' `f0`, `f1`), every key missed, and the entire list was rebuilt —
  // per-item state lost, @destroyed and @created run again.
  //
  // It also fixes the POSITION of this block. Refreshing before @created made
  // `RouterHydration.test.tsx` fail: `init()` is an @created that corrects the
  // restored route back to the client's URL, so hooks refreshed before it would
  // publish the SERVER's route and hold it until the next render. Hooks have to
  // see the final state — after the blob, and after any @created that corrects it.
  if (component[INTERNAL_HOOKS]) {
    for (const update of component[INTERNAL_HOOKS]) update();
  }

  seedWatchProps(component);

  const region: ComponentRegion = {
    owner,
    definition: vnode.name,
    instance: component,
    entries: [],
    order: [],
    parent: parent as ChildNode,
  };
  componentRuntime.region = region;

  // The component may not be able to hydrate yet — see the `@deferHydration`
  // decorator. Asked AFTER the restore, the client @created and the hook refresh,
  // so it decides with its final state; and BEFORE the render below, which is
  // the step that would produce output disagreeing with the server's markup.
  const deferred = collectDeferrals(runtime.deferHydrations);
  if (deferred) {
    /**
     * The block is left exactly as the server wrote it, markers included.
     *
     * They cannot be removed yet: until this subtree resumes, nobody has learnt where its
     * components are, and the record for it is still empty. `resumeHydration` reads them and takes
     * them out then. Its nodes are collected into the region's order so the parent's own record
     * describes what is really on screen in the meantime.
     */
    const close = skipToClose(open as unknown as Comment, region.order);
    deferredBlocks.set(component, { open: open as unknown as Comment, close, parent });
    componentRuntime.hydrationPending = true;

    // Armed in development always, and in production only when the app installed a collector — so
    // an app with no sink pays nothing for this, not even the timer. A subtree that never resumes
    // is one of the few faults that cannot be found before shipping: it needs a dynamic import
    // that neither settles nor rejects, which is a network, not a mistake in the code.
    if (__DEV__ || globalThis.__RAMONDA_DIAGNOSTICS__) watchForStalledHydration(component);

    // `finally`, not `then`: a rejected promise still has to release the
    // subtree. `AsyncLoad` renders its own error fallback in that case, and a
    // component left frozen because its load failed would be a worse outcome
    // than one that renders the failure.
    void deferred.finally(() => resumeHydration(component));

    // The walk continues past this subtree without looking inside it. That is
    // the whole feature: the server's nodes are left exactly as they are.
    walk.cursor = nextOf((close ?? open) as unknown as EnhancedChildNode);
    return region;
  }

  // This is the client render. The server's output for the same component is sitting between the
  // markers, so hydrating IS the comparison — no second render is needed to detect divergence.
  const children = generateRenderOutput(component);

  walk.cursor = nextOf(open);
  const inner = hydrateLevel(children, component, parent, walk);
  region.entries = inner.entries;
  flattenEntries(region.entries, region.order);

  closeBlock(open as unknown as Comment, walk, component);
  componentRuntime.isInitialized = true;

  // Deferred like the client build path, so @mounted means one thing everywhere.
  // `env !== "server"`, matching the build path — NOT `=== "client"`, which
  // silently dropped every default (`"shared"`) @mounted on a hydrated page.
  // @mounted exists to touch the REAL DOM and the server's DOM is thrown away,
  // so skipping it on the client means the work simply never happens for any
  // prerendered page. `AsyncLoad` is the proof: its `@mounted` is what calls
  // `load()`, so with that filter a prerendered page never fetched its module.
  for (const mount of runtime.mounts) {
    if (mount.env !== "server") queuePostCommit(component, () => mount.cb(componentRuntime.env));
  }

  // Queued, not called inline — hydration walks top-down, so an inline call ran a parent's effects
  // before its children existed, while the build path defers everything to one flush and therefore
  // runs children first. Pages MIX the two: anything hydration cannot adopt is built instead.
  // Measured on a hydrated parent whose child was newly built — `["parent", "child"]`, exactly
  // inverted — which meant a parent effect could not see what a child effect had done.
  queuePostCommit(component, () => runComponentEffects(component));

  return region;
}

/**
 * Where a deferred block ends, and the nodes inside it.
 *
 * Nesting is why this counts rather than taking the first close it meets: a deferred component's
 * markup holds its children's markers, and the first `/c…` down there is not this one's.
 */
function skipToClose(open: Comment, out: ChildNode[]): Comment | undefined {
  let depth = 0;
  for (let node = open.nextSibling; node !== null; node = node.nextSibling) {
    if (isComponentOpen(node)) depth++;
    else if (isComponentClose(node)) {
      if (depth === 0) return node as Comment;
      depth--;
    }
    out.push(node as ChildNode);
  }
  return undefined;
}

/**
 * Takes the pair out, once the block between them has been adopted.
 *
 * Where the walk stopped IS the closing marker, when the server wrote what this render wants. It is
 * not when the client rendered MORE children than the server did: those were built and inserted
 * before the marker, and the walk stopped on it all the same. Either way the marker is the node the
 * walk ran into — so the only case left is a block the server never closed, which is a divergence
 * worth reporting rather than a shape to repair.
 */
function closeBlock(open: Comment, walk: HydrationWalk, component: BaseComponent): void {
  const stop = walk.cursor;
  if (stop !== null && isComponentClose(stop)) {
    walk.cursor = nextOf(stop);
    stop.remove();
  } else if (__DEV__) {
    const name = component.constructor.name;
    diagnose(
      "RMD007",
      `${name}:unclosed`,
      `<${name} />'s block in the server markup has no closing marker, so the walk cannot tell where it ends.`,
    );
  }
  open.remove();
}

function hydrateChildren(
  vnodeChildren: unknown[] | undefined,
  placeholder: MaybeComponent,
  existingParent: Node,
): void {
  if (!vnodeChildren) return;

  // A cursor, not an index: steps below split, insert and replace nodes, and
  // childNodes is live, so any position captured up front goes stale.
  const walk: HydrationWalk = {
    cursor: existingParent.firstChild as EnhancedChildNode | null,
    count: 0,
  };

  const level = hydrateLevel(vnodeChildren, placeholder, existingParent, walk);

  // Built from the nodes the server produced, not from the render output —
  // hydration ADOPTS, so the record has to describe what was adopted.
  if (level.hasRegion) {
    (existingParent as EnhancedChildNode)[CHILD_RECORD] = level.entries;
  }

  if (__DEV__ && walk.cursor) {
    let extra = 0;
    for (let node: ChildNode | null = walk.cursor; node; node = node.nextSibling) {
      extra++;
    }
    reportChildCountMismatch(
      placeholder,
      (existingParent as Element).nodeName.toLowerCase(),
      walk.count,
      walk.count + extra,
    );
  }
}

/** The position the walk has reached, shared across nesting levels. */
export interface HydrationWalk {
  cursor: EnhancedChildNode | null;
  count: number;
}

/**
 * Hydrates one level of children and returns the record entries for it,
 * recursing for a list so the record nests exactly the way the diff expects.
 *
 * The walk is shared: a list's items are adjacent siblings in the server markup
 * like any other children, so nesting changes what is RECORDED, not the order
 * things are visited in. Getting this wrong crashed — `hydrateNode` was handed a
 * list where it expected a vnode.
 *
 * Exported because the walk is not only an element's: a `ChildrenRegion` adopts a
 * RUN of siblings inside a target it shares, and it has to be this walk, not
 * something adjacent to it. Reusing a server element and reconciling against it
 * looks like adoption and is not — a component is only restored when
 * `hydrateComponent` runs on its host and reads the blob.
 */
export function hydrateLevel(
  children: unknown[],
  placeholder: MaybeComponent,
  parent: Node,
  walk: HydrationWalk,
  /** See `reconcileEntries` — a region's items report to the region, not a render. */
  listHost?: ListHost,
): { entries: RecordEntry[]; hasRegion: boolean } {
  const entries: RecordEntry[] = [];
  let hasRegion = false;

  for (let i = 0; i < children.length; i++) {
    const rawVchild = children[i];

    if (isListNode(rawVchild)) {
      // A `list()` descriptor has no `vnodes` yet — building them is what the
      // diff does when it reconciles the region, and hydration has to do the
      // same before it can walk them. The engine it produces MUST be stored on
      // the entry: without it the first render after hydration finds no state
      // and rebuilds the whole list, which is the same class of bug as "Hook
      // options were never refreshed after a state restore".
      let listNode = rawVchild;
      let engine: ListEngine<unknown> | undefined;

      if (isLazyList(rawVchild)) {
        const materialized = buildLazyList(
          rawVchild as unknown as LazyListNode,
          undefined,
          listHost ?? listHostFor(placeholder),
        );
        listNode = materialized.node as typeof rawVchild;
        engine = materialized.engine;
      }

      const inner = hydrateLevel(listNode.vnodes, placeholder, parent, walk, listHost);
      entries.push({
        owner: listNode.owner,
        entries: inner.entries,
        source: listNode,
        engine,
      });
      hasRegion = true;
      continue;
    }

    /**
     * A component is adopted as a REGION, exactly as it is reconciled as one — same identity, same
     * place in the record. Ahead of `filterVirtualChild` for the same reason the diff's branch is:
     * it owns a run of siblings, not the single node `hydrateNode` is shaped around.
     */
    if (isVNode(rawVchild) && rawVchild.type === COMPONENT_TYPE) {
      const region = hydrateComponentRegion(rawVchild, placeholder, parent, walk, componentRegionOwner(rawVchild, i));
      if (region !== undefined) {
        entries.push(region);
        hasRegion = true;
        walk.count++;
      }
      continue;
    }

    const vchild = filterVirtualChild(rawVchild);
    if (vchild === undefined) continue;

    const before = walk.cursor;
    walk.cursor = hydrateNode(vchild, placeholder, walk.cursor, parent);
    walk.count++;

    // The node this child ended up on: whatever now sits where `before` was.
    // Reading it back from the parent survives the replace and insert paths,
    // where `before` is detached and useless.
    const placed = walk.cursor ? walk.cursor.previousSibling : parent.lastChild;
    if (placed) entries.push(placed as EnhancedChildNode);
    else if (before) entries.push(before);
  }

  return { entries, hasRegion };
}

/**
 * Runs every `@deferHydration` method and returns one promise to wait on, or
 * `undefined` when none of them asked to wait.
 *
 * A method returning something that is not a promise means "hydrate now" —
 * that is the ordinary case, and it must cost nothing.
 */
function collectDeferrals(deferrals: (() => unknown)[]): Promise<unknown> | undefined {
  if (deferrals.length === 0) return undefined;

  let waiting: Promise<unknown>[] | undefined;
  for (const deferral of deferrals) {
    const result = deferral();
    if (isThenable(result)) (waiting ??= []).push(result);
  }

  if (waiting === undefined) return undefined;
  // allSettled: one failed deferral must still release the subtree, or a
  // component whose load failed would stay frozen instead of rendering the
  // failure it knows how to render.
  return waiting.length === 1 ? waiting[0] : Promise.allSettled(waiting);
}

/**
 * Hydrates a subtree that was deferred, once its promise settled.
 *
 * This is the ordinary hydration path run late, against children nobody touched in the meantime —
 * which is exactly why the deferral had to skip them rather than render a placeholder over them.
 * The markers are still where the server put them, which is what makes resuming possible at all:
 * they are the only record of where this component's block starts and ends.
 */
function resumeHydration(component: BaseComponent): void {
  const componentRuntime = component[COMPONENT_RUNTIME];

  // The watch is over the moment the promise settles, whichever way it settled —
  // so this is cleared ABOVE the early returns below rather than beside the
  // successful path. A subtree that resumed into a destroyed component has
  // answered the question the timer was asking just as much as one that
  // rendered.
  clearStalledHydrationWatch(component);

  // Torn down while its promise was in flight. The nodes are already gone; the
  // promise resolving must not write into a dead component.
  if (componentRuntime.isDestroyed) return;
  if (!componentRuntime.hydrationPending) return;

  const block = deferredBlocks.get(component);
  const region = componentRuntime.region;
  if (block === undefined || region === undefined) return;
  deferredBlocks.delete(component);
  if (block.open.parentNode === null) return;

  // Cleared BEFORE the render: `generateRenderOutput` may read state whose
  // signals would otherwise refuse to schedule anything, and from here on the
  // component is an ordinary live component.
  componentRuntime.hydrationPending = false;
  componentRuntime.isInitialized = true;

  const runtime = component[GLOBAL_RUNTIME];
  const children = generateRenderOutput(component);

  /**
   * The walk starts on the first node the server wrote inside this block.
   *
   * The nodes collected at defer time are NOT reused as a record: they were never diffed, so what
   * belongs to which child is exactly the question this walk answers. They were kept so the parent
   * could report the truth about its own children in the meantime.
   */
  const walk: HydrationWalk = { cursor: block.open.nextSibling as EnhancedChildNode | null, count: 0 };
  const inner = hydrateLevel(children, component, block.parent, walk);
  region.entries = inner.entries;
  region.order = [];
  flattenEntries(region.entries, region.order);

  closeBlock(block.open, walk, component);

  for (const mount of runtime.mounts) {
    if (mount.env !== "server") queuePostCommit(component, () => mount.cb(componentRuntime.env));
  }
  queuePostCommit(component, () => runComponentEffects(component));

  // This subtree is its own commit — the page's flush finished long ago.
  flushPostCommit();
}

/**
 * Reports a deferred subtree that never resumed (RMD017).
 *
 * The failure is invisible: the server's content is on screen and looks
 * finished, it is simply not interactive. Nothing throws, nothing is missing,
 * and a reader clicking it gets silence. So it needs a diagnostic more than most
 * things do.
 *
 * A timer rather than a promise rejection, because the case being caught is a
 * promise that never settles AT ALL — there is nothing to attach to.
 */
const STALLED_HYDRATION_MS = 10_000;

/**
 * The armed timers, so a subtree that resumes can put its own out.
 *
 * A WeakMap rather than a field on the component runtime, and the reason is
 * size: every component would carry the field, while only a deferred subtree
 * ever arms a timer. Nothing has to be removed on teardown either — the entry
 * dies with the component it is keyed by.
 */
const stalledWatches = new WeakMap<object, ReturnType<typeof setTimeout>>();

/** Puts out the watch armed for this subtree, if there was one. */
function clearStalledHydrationWatch(component: BaseComponent): void {
  const timer = stalledWatches.get(component);
  if (timer === undefined) return;
  clearTimeout(timer);
  stalledWatches.delete(component);
}

function watchForStalledHydration(component: BaseComponent): void {
  const timer = setTimeout(() => {
    const componentRuntime = component[COMPONENT_RUNTIME];
    if (!componentRuntime.hydrationPending) return;
    if (componentRuntime.isDestroyed) return;

    const dedupKey = `stalled-hydration:${component.constructor.name}`;

    if (__DEV__) {
      diagnose(
        "RMD017",
        dedupKey,
        `<${component.constructor.name} /> deferred its hydration and never resumed. ` +
          `The server's markup is still on screen, so the page looks finished — but this subtree ` +
          `has no listeners and no state, and nothing in it responds. The promise returned by ` +
          `deferHydration() has not settled after ${STALLED_HYDRATION_MS / 1000}s; a failed dynamic ` +
          `import that never rejects is the usual cause.`,
      );
    } else {
      // The same fault without the advice: what happened is machine data and can ship, while what
      // to do about it is prose for whoever is holding the keyboard. No component name — a
      // production build has minified it, so it would name something that is not in the source.
      reportFault("RMD017", dedupKey, "A subtree deferred its hydration and never resumed.");
    }
  }, STALLED_HYDRATION_MS);

  /**
   * Two different things, and the second is why the first is not enough.
   *
   * `unref` keeps a Node process (or a test run) from being held open — and it
   * is Node-only. In a browser there is no `unref`, so an armed timer holds its
   * closure, and the closure holds the component, for the full ten seconds after
   * the subtree is finished with. Recording it is what lets `resumeHydration`
   * put it out at once.
   */
  (timer as unknown as { unref?: () => void }).unref?.();
  stalledWatches.set(component, timer);
}

/** Element vnodes carry an uppercased tag (it matches nodeName); components carry a class. */
function vnodeName(vnode: VNode): string {
  return typeof vnode.name === "string" ? vnode.name.toLowerCase() : vnode.name.name;
}

function hydrationFallback(
  vnode: VNode,
  placeholder: MaybeComponent,
  existingNode: EnhancedChildNode | null,
  parent: Node,
): EnhancedChildNode | null {
  if (__DEV__) {
    reportStructureMismatch(
      placeholder,
      `<${vnodeName(vnode)}>`,
      existingNode ? `<${existingNode.nodeName.toLowerCase()}>` : "nothing",
    );
  }
  const fresh = diffAndMerge(vnode, placeholder, undefined);
  if (existingNode) {
    parent.replaceChild(fresh, existingNode);
  } else {
    parent.appendChild(fresh);
  }
  return nextOf(fresh as EnhancedChildNode);
}
