import { COMPONENT_TYPE, STATE_ATTR, CHILD_RECORD, ORIGIN_SYM } from "../helpers/constants";
import { applyChangesOnAttributes, formatAttributes } from "../core/Attribute";
import { generateRenderOutput } from "../helpers/generateRenderOutput";
import { seedWatchProps } from "../helpers/watchProps";
import { runComponentEffects } from "../reactivity/effect";
import { COMPONENT_RUNTIME, GLOBAL_RUNTIME, INTERNAL_HOOKS } from "../core/runtime";
import { diffAndMerge, filterVirtualChild, isListNode, listHostFor } from "../core/DiffAndMerge";
import { buildLazyList, isLazyList, type ListEngine, type LazyListNode } from "../helpers/listEngine";
import { restoreComponentTree } from "./restore";
import { queuePostCommit, flushPostCommit } from "../core/commit";
import { ramondaLog } from "../debug/logger";
import { diagnose } from "../debug/diagnostics";
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
  EnhancedHTMLNode,
} from "../types/vdom";
import type { Context } from "../types/commonTypes";

/**
 * Hydrates a server-rendered subtree: instead of creating DOM, it ADOPTS the
 * existing server nodes, restores state from each carrier's blob, wires up the
 * client-only bits (event listeners, refs, effects, timers), and runs only the
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
  const vchild = filterVirtualChild(vnode);
  if (vchild === undefined) return;
  hydrateNode(vchild, undefined, container.firstChild as EnhancedChildNode | null, container);
  flushPostCommit();
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

  if (vchild.type === COMPONENT_TYPE) {
    return hydrateComponent(vchild, placeholder, cursor, parent);
  }
  return hydrateElement(vchild, placeholder, cursor, parent);
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

function hydrateComponent(
  vnode: VNodeComponent,
  placeholder: MaybeComponent,
  existingHostNode: EnhancedChildNode | null,
  parent: Node,
): EnhancedChildNode | null {
  if (!existingHostNode || existingHostNode.nodeType === 3) {
    return hydrationFallback(vnode, placeholder, existingHostNode, parent);
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
  const host = existingHostNode as EnhancedHTMLNode;
  const blob = host.getAttribute?.(STATE_ATTR);
  if (blob) {
    try {
      restoreComponentTree(component, JSON.parse(blob));
    } catch (e) {
      if (__DEV__) {
        ramondaLog("error", `[hydration] failed to parse state blob on <${vnode.name.name}>`, e);
      }
    }
  }

  // create/mount ran on the server (shared/server env) → skip; run client only.
  for (const create of runtime.creates) {
    if (create.env === "client") create.cb();
  }

  // Re-evaluate every hook's options — AFTER the restore and AFTER @create.
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
  // per-item state lost, @destroy and @create run again.
  //
  // `RouterHydration.test.tsx` documented the same root cause from the other
  // end: RouteProvider's options were captured before the restore, which is why
  // `Router.init()` has to re-read the URL.
  //
  // It also fixes the POSITION of this block. Refreshing before @create made
  // that router test fail: `init()` is an @create that corrects the restored
  // route back to the client's URL, so hooks refreshed before it would publish
  // the SERVER's route and hold it until the next render. Hooks have to see the
  // final state — after the blob, and after any @create that corrects it.
  if (component[INTERNAL_HOOKS]) {
    for (const update of component[INTERNAL_HOOKS]) update();
  }

  seedWatchProps(component);

  // The component may not be able to hydrate yet — see the `@deferHydration`
  // decorator. Asked AFTER the restore, the client @create and the hook refresh,
  // so it decides with its final state; and BEFORE the render below, which is
  // the step that would produce output disagreeing with the server's markup.
  const deferred = collectDeferrals(runtime.deferHydrations);
  if (deferred) {
    adoptHost(component, existingHostNode, vnode);
    component[COMPONENT_RUNTIME].hydrationPending = true;

    if (__DEV__) watchForStalledHydration(component);

    // `finally`, not `then`: a rejected promise still has to release the
    // subtree. `AsyncLoad` renders its own error fallback in that case, and a
    // component left frozen because its load failed would be a worse outcome
    // than one that renders the failure.
    void deferred.finally(() => resumeHydration(component, vnode));

    // The walk continues past this subtree without looking inside it. That is
    // the whole feature: the server's nodes are left exactly as they are.
    return nextOf(existingHostNode);
  }

  // This is the client render. The server's output for the same component is
  // sitting in existingHostNode, so hydrating IS the comparison — no second
  // render is needed to detect divergence, only reporting before we patch.
  const rendered = generateRenderOutput(component) as VNodeString;

  if (existingHostNode.nodeName !== rendered.name) {
    return hydrationFallback(vnode, placeholder, existingHostNode, parent);
  }

  if (__DEV__) {
    reportAttributeMismatches(component, existingHostNode as unknown as Element, formatAttributes(rendered.attributes));
  }

  applyChangesOnAttributes(existingHostNode, rendered.attributes);
  hydrateChildren(rendered.children, component, existingHostNode);

  adoptHost(component, existingHostNode, vnode);
  componentRuntime.isInitialized = true;

  // Deferred like the client build path, so @mount means one thing everywhere.
  // The server's DOM is already in the document here, so this is about keeping a
  // single rule rather than fixing a hydration-specific bug.
  // `env !== "server"`, matching the build path — NOT `=== "client"`, which is
  // what this was and which silently dropped every default (`"shared"`) @mount
  // on a hydrated page.
  //
  // The argument for skipping them was that a shared @mount already ran during
  // the server render. But @mount exists to touch the REAL DOM, and the server's
  // DOM is thrown away — so skipping it on the client means the work simply
  // never happens for any prerendered page.
  //
  // `AsyncLoad` is the proof. Its `@mount afterCreate()` is what calls `load()`,
  // so with this filter a prerendered page never fetched its module: measured
  // `loading: false`, the load never started, and the page sat on its loading
  // fallback forever with the server's real content already destroyed beneath it.
  //
  // Anything that genuinely must run once, on the server only, says so with
  // `env: "server"`. That is what the option is for.
  for (const mount of runtime.mounts) {
    if (mount.env !== "server") queuePostCommit(component, mount.cb);
  }

  // Effects are always client-only: this attaches @onElement/@onWindow/@onDocument
  // listeners, starts @interval/@timeout, and runs @effect against the live DOM.
  //
  // Queued, not called inline — for the same reason the mounts above are, and it
  // was a real bug that only these were left behind. Hydration walks top-down,
  // so an inline call ran a parent's effects before its children existed, while
  // the build path defers everything to one flush and therefore runs children
  // first. Both orders were self-consistent, so a fully-hydrated page and a
  // fully-built page each looked correct in isolation.
  //
  // Pages MIX the two: anything hydration cannot adopt is built instead. Measured
  // on a hydrated parent whose child was newly built — `["parent", "child"]`,
  // exactly inverted — which meant a parent effect could not see what a child
  // effect had done. Found by a docs demo counting a store's subscribers and
  // reading zero on the live site while every core test said one.
  queuePostCommit(component, () => runComponentEffects(component));

  return nextOf(existingHostNode);
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
  if (level.hasList) {
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
interface HydrationWalk {
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
 */
function hydrateLevel(
  children: unknown[],
  placeholder: MaybeComponent,
  parent: Node,
  walk: HydrationWalk,
): { entries: RecordEntry[]; hasList: boolean } {
  const entries: RecordEntry[] = [];
  let hasList = false;

  for (let i = 0; i < children.length; i++) {
    const rawVchild = children[i];

    if (isListNode(rawVchild)) {
      // A `list()` descriptor has no `vnodes` yet — building them is what the
      // diff does when it reconciles the region, and hydration has to do the
      // same before it can walk them. The engine it produces MUST be stored on
      // the entry: without it the first render after hydration finds no state
      // and rebuilds the whole list, which is the same class of bug as "Hook
      // options were never refreshed after a state restore" in BUGS.md.
      let listNode = rawVchild;
      let engine: ListEngine<unknown> | undefined;

      if (isLazyList(rawVchild)) {
        const materialized = buildLazyList(rawVchild as unknown as LazyListNode, undefined, listHostFor(placeholder));
        listNode = materialized.node as typeof rawVchild;
        engine = materialized.engine;
      }

      const inner = hydrateLevel(listNode.vnodes, placeholder, parent, walk);
      entries.push({
        owner: listNode.owner,
        entries: inner.entries,
        source: listNode,
        engine,
      });
      hasList = true;
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

  return { entries, hasList };
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
 * The bookkeeping that makes a server node this component's host: the
 * back-references the diff and the devtools read, and the origin without which
 * the first client update would decide every adopted node was "built by someone
 * else" and rebuild the page it just adopted.
 *
 * Shared by the normal path and the deferred one, which is the point — a
 * deferred component owns its host immediately, and only its CHILDREN wait.
 */
function adoptHost(component: BaseComponent, host: EnhancedChildNode, vnode: VNodeComponent): void {
  host._componentInstance = component;
  host._componentDefinition = vnode.name;
  host[ORIGIN_SYM] = vnode[ORIGIN_SYM];
  component[COMPONENT_RUNTIME].enhancedNode = host;
}

/**
 * Hydrates a subtree that was deferred, once its promise settled.
 *
 * This is the ordinary hydration path run late, against children nobody touched
 * in the meantime — which is exactly why the deferral had to skip them rather
 * than render a placeholder over them.
 */
function resumeHydration(component: BaseComponent, vnode: VNodeComponent): void {
  const componentRuntime = component[COMPONENT_RUNTIME];

  // Torn down while its promise was in flight. The nodes are already gone; the
  // promise resolving must not write into a dead component.
  if (componentRuntime.isDestroyed) return;
  if (!componentRuntime.hydrationPending) return;

  const host = componentRuntime.enhancedNode as EnhancedChildNode;
  const parent = host.parentNode;
  if (!parent) return;

  // Cleared BEFORE the render: `generateRenderOutput` may read state whose
  // signals would otherwise refuse to schedule anything, and from here on the
  // component is an ordinary live component.
  componentRuntime.hydrationPending = false;
  componentRuntime.isInitialized = true;

  const runtime = component[GLOBAL_RUNTIME];
  const rendered = generateRenderOutput(component) as VNodeString;

  if (host.nodeName !== rendered.name) {
    // The client wants a different element than the server wrote. Nothing can be
    // adopted, so fall back to building — the same decision the synchronous path
    // makes, just reached later.
    hydrationFallback(vnode, componentRuntime.parent, host, parent);
    return;
  }

  if (__DEV__) {
    reportAttributeMismatches(component, host as unknown as Element, formatAttributes(rendered.attributes));
  }

  applyChangesOnAttributes(host, rendered.attributes);
  hydrateChildren(rendered.children, component, host);

  for (const mount of runtime.mounts) {
    if (mount.env !== "server") queuePostCommit(component, mount.cb);
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

function watchForStalledHydration(component: BaseComponent): void {
  const timer = setTimeout(() => {
    const componentRuntime = component[COMPONENT_RUNTIME];
    if (!componentRuntime.hydrationPending) return;
    if (componentRuntime.isDestroyed) return;

    diagnose(
      "RMD017",
      `stalled-hydration:${component.constructor.name}`,
      `<${component.constructor.name} /> deferred its hydration and never resumed. ` +
        `The server's markup is still on screen, so the page looks finished — but this subtree ` +
        `has no listeners and no state, and nothing in it responds. The promise returned by ` +
        `deferHydration() has not settled after ${STALLED_HYDRATION_MS / 1000}s; a failed dynamic ` +
        `import that never rejects is the usual cause.`,
    );
  }, STALLED_HYDRATION_MS);

  // Do not hold a Node process (or a test run) open waiting for a diagnostic.
  (timer as unknown as { unref?: () => void }).unref?.();
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
