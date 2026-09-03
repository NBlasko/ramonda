import { COMPONENT_TYPE, CHILD_RECORD, ORIGIN_SYM, REQUEST_ATTR } from "../helpers/constants";
import { displayName } from "../helpers/utils";
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
  stampSlot,
} from "../core/DiffAndMerge";
import { isComponentClose, isComponentOpen, markerBlob } from "../core/componentMarker";
import { errorHandler } from "../core/errorHandler";
import { lifecycleCleanupManagement } from "../helpers/lifecycleMenagement";
import { isListNode, isVNode } from "../vdom/guards";
import { buildLazyList, isLazyList, type ListEngine, type LazyListNode, type ListHost } from "../helpers/listEngine";
import { restoreComponentTree } from "./restore";
import { queuePostCommit, flushPostCommit } from "../core/commit";
import { addTaskToQueue } from "../core/Task";
import { diagnose } from "../debug/diagnostics";
import { reportFault } from "../debug/fault";
import { isThenable } from "../core/serverWork";
import {
  reportTextMismatch,
  reportStructureMismatch,
  reportChildCountMismatch,
  describeFound,
  reportBlockLengthMismatch,
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
  // This level ends here, so a tail no child claimed is nobody's — the same sweep `hydrateChildren`
  // does, and it belongs to whoever ENDS a level rather than to `hydrateLevel`, which is shared by
  // a list's recursion and must leave a tail for the outer level's next text child.
  walk.cursor = dropUnclaimedRemainders(walk.cursor);
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
/**
 * Text nodes that a split above produced and nobody has claimed yet.
 *
 * A fused server text node is cut to the length each child rendered, and the tail is left for the
 * children after it. When they take it, it stops being a remainder by being walked past. When there
 * are none — one text child whose value simply differs, and is SHORTER on the client — the tail is a
 * fragment of the server's text with no owner, and it stayed in the page: measured on a `<span>` that
 * read `waiting` on the server and `ready` on the client, which hydrated to `readyng`.
 *
 * Marked rather than removed on the spot, because at that moment the two cases are the same node.
 * The level knows the difference: what the walk never reached is unclaimed. A WeakSet keeps this out
 * of the way of the shell's own content, which is the one thing a leftover sweep must never touch.
 */
const splitRemainders = new WeakSet<Node>();

/**
 * Removes the split tails this level's repairs left behind, and nothing else — and answers with the
 * first node that is NOT one, which is where the walk really stopped.
 *
 * The cursor has to move: it points AT the tail when the tail is what is left, and a removed node
 * still reads as a node. Leaving it there made the level report one server child more than there
 * was, naming a fragment of its own repair as markup the server sent.
 */
/**
 * Steps the walk over a split tail no following child can claim.
 *
 * A tail belongs to the TEXT children after the one that made it — a fused server run arrives as a
 * single node and each of them takes its own slice. Anything else in that position cannot: a
 * component looks for its opening marker and finds a `Text`, so it builds itself from scratch, its
 * blob never read and the server's whole block left standing behind the fresh copy. Measured on a
 * `<div>{count}<Counter/></div>` whose count differed across the boundary: two `<button id="c">`,
 * the new one at `0`, the server's still there carrying `{"n":5}`.
 *
 * The end-of-level sweep cannot cover this — by then the tail has already displaced every sibling
 * that came after it.
 */
/**
 * Whether this node is the tail of a split THIS hydration made, rather than markup the server sent.
 *
 * Exported for `ChildrenRegion`, which ends a level of its own and has the same question to answer:
 * a tail is the second half of a divergence already reported, and counting it as a node the server
 * sent turns one fault into two diagnostics.
 */
export function isSplitRemainder(node: Node): boolean {
  return splitRemainders.has(node);
}

function skipUnclaimableRemainder(walk: HydrationWalk): void {
  const at = walk.cursor;
  if (at === null || !splitRemainders.has(at)) return;
  walk.cursor = nextOf(at);
  at.remove();
}

function dropUnclaimedRemainders(from: ChildNode | null): EnhancedChildNode | null {
  let node = from;
  while (node !== null && splitRemainders.has(node)) {
    const next: ChildNode | null = node.nextSibling;
    node.remove();
    node = next;
  }
  for (let after = node; after !== null; ) {
    const next: ChildNode | null = after.nextSibling;
    if (splitRemainders.has(after)) after.remove();
    after = next;
  }
  return node as EnhancedChildNode | null;
}

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
      splitRemainders.add((cursor as Text).splitText(text.length));
      return nextOf(cursor);
    }

    if (__DEV__) reportTextMismatch(placeholder, text, found);

    // Real divergence, so the boundary is unknowable — but the fused remainder
    // still belongs to the children after us. Cut our slice to the length we
    // rendered and leave the rest for them, or replacing this node would eat
    // their text and report them as missing too: one fault, one diagnostic.
    if (found.length > text.length) splitRemainders.add((cursor as Text).splitText(text.length));
    cursor.textContent = text;
    return nextOf(cursor);
  }

  if (__DEV__) {
    reportStructureMismatch(placeholder, `the text "${text}"`, describeFound(cursor));
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
      reportStructureMismatch(placeholder, `<${vnode.name.name}>`, describeFound(open));
    }
    const region = buildComponentRegion(vnode, placeholder, owner, parent as ChildNode);
    const built: ChildNode[] = [];
    flattenEntries(region.entries, built);
    for (const node of built) parent.insertBefore(node, open);
    return region;
  }

  /**
   * Everything from here on is THIS component's adoption, and a throw anywhere in it is handled
   * where its marker is in hand — see `adoptionFailed`.
   *
   * It cannot be handled by the level above: the walk is shared, so by the time a throw from deeper
   * in the adoption reaches the caller the cursor is a node inside this block and nothing up there
   * knows where the block began.
   */
  // A `const` taken from the narrowed `open`, because the adoption below reads it from inside a
  // closure and TypeScript does not carry a narrowing across one.
  const marker = open as unknown as Comment;

  const parentContext = placeholder?.[GLOBAL_RUNTIME].context;
  const context = Object.create(parentContext || null) as Context;
  const component = new vnode.name(vnode.attributes, context);
  const runtime = component[GLOBAL_RUNTIME];
  const componentRuntime = component[COMPONENT_RUNTIME];

  try {
    return adopt();
  } catch (e) {
    return adoptionFailed(e, marker, component, placeholder, walk);
  }

  function adopt(): ComponentRegion {
    const placeholderRuntime = placeholder?.[COMPONENT_RUNTIME];
    if (placeholderRuntime) {
      componentRuntime.depth = placeholderRuntime.depth + 1;
      componentRuntime.parent = placeholder;
    }

    // Restore server state before any client lifecycle/render sees it. Note:
    // isInitialized is still falsy here, so the @state setters below don't enqueue
    // a spurious re-render — we're adopting, not re-rendering.
    const blob = markerBlob(marker);
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
      /**
       * The block's nodes become the region's ENTRIES, not a cache beside them.
       *
       * They have not been diffed — that is what resuming does — but they are what this region holds
       * right now, and a record entry is exactly "a node this region holds". Kept anywhere else, the
       * parent's own reorder would not know these nodes are its children, and a teardown while the
       * promise is still in flight would not find them.
       *
       * **The MARKERS are entries too, and only while the block is pending.** They are the block's
       * boundary, and the whole point of deferring is that the rest of the page stays live — so the
       * ordinary case is a parent re-rendering while the promise is in flight. With the record saying
       * the block began at the first node INSIDE it, a freshly built preceding sibling was inserted
       * there, which is between the opening marker and the server's content. Measured on a page that
       * revealed a `<p>` while a subtree waited:
       * `<!--c1--><p id="top">top</p><div id="slow">…</div><!--/c1-->`. `resumeHydration` starts its
       * walk at `open.nextSibling`, so it then hydrated the deferred component's first child against
       * its sibling's node.
       *
       * They leave the record on resume, when `region.entries` is replaced by what the walk adopted
       * and `closeBlock` takes the pair out.
       */
      const held: ChildNode[] = [open as unknown as ChildNode];
      const close = skipToClose((open as unknown as Comment).nextSibling, held);
      if (close !== undefined) held.push(close);
      region.entries = held as EnhancedChildNode[];
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
}

/**
 * A component whose adoption threw: the block goes, the instance is released, and the error is put
 * where the build path puts it.
 *
 * The block first — stale content under a fallback is not a repair, and a walk left standing inside
 * it matches every later sibling against nodes that were never theirs.
 *
 * Then the instance. It was constructed, its blob restored and its client `@created` run, so it may
 * already hold a subscription or an open connection; nothing else can reach it, because no record
 * ever took its region. This is the same reasoning `buildComponentRegion`'s own catch writes down
 * for the build path.
 *
 * The boundary that takes the error is answered by `errorHandler` and queued rather than told to
 * render now: one caught mid-adoption is not initialized yet, so the state its handler wrote
 * schedules nothing, and post-commit is when this walk has finished with it.
 */
function adoptionFailed(
  e: unknown,
  open: Comment,
  component: BaseComponent,
  placeholder: MaybeComponent,
  walk: HydrationWalk,
): undefined {
  dropBlock(open, walk);

  /**
   * The region is emptied, not merely abandoned. Its entries are the nodes just removed, and an
   * ANCESTOR flattens them when it reorders — a detached node answers `null` to `nextSibling`, which
   * reads as the end of the parent. Measured on a deferred subtree that threw on resume: the
   * boundary's fallback was appended past every later sibling instead of landing where the child
   * had been.
   */
  const region = component[COMPONENT_RUNTIME].region;
  if (region !== undefined) region.entries = [];

  lifecycleCleanupManagement(component);

  const handler = errorHandler(e, placeholder);
  if (handler !== undefined) queuePostCommit(handler, () => addTaskToQueue(handler));
  return undefined;
}

/**
 * Where a block ends, and the nodes between `from` and there.
 *
 * Nesting is why this counts rather than taking the first close it meets: a deferred component's
 * markup holds its children's markers, and the first `/c…` down there is not this one's.
 */
function skipToClose(from: ChildNode | null, out: ChildNode[]): Comment | undefined {
  let depth = 0;
  for (let node = from; node !== null; node = node.nextSibling) {
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
 * Takes the pair out, once the block between them has been adopted — and puts the walk on the first
 * node that is NOT this component's.
 *
 * Where the walk stopped IS the closing marker, when the server wrote what this render wants. It is
 * also the marker when the client rendered MORE children than the server did: those were built and
 * inserted before it, and the walk stopped on it all the same.
 *
 * The case left is the client rendering FEWER, and it cannot be reported and walked past. The walk is
 * standing on a node that belongs to this component, in the middle of the parent's children, so
 * whatever the parent has left is matched one position too early: the sibling AFTER the component is
 * diffed against the component's leftover node and takes it over, and then rendered a second time in
 * its own place. Measured on a component that dropped its second child across the boundary — the page
 * came back holding two copies of the sibling and a stray marker between them.
 *
 * So the block is closed properly: its own closing marker is found by counting depth (a leftover run
 * may hold a whole nested component's markers), everything up to it goes, and the walk continues
 * after it. The nodes removed were never adopted — no instance, no listener and no record points at
 * one — so removing them is all there is to do.
 */
function closeBlock(open: Comment, walk: HydrationWalk, component: BaseComponent): void {
  const stop = walk.cursor;
  if (stop !== null && isComponentClose(stop)) {
    walk.cursor = nextOf(stop);
    stop.remove();
    open.remove();
    return;
  }

  const extra: ChildNode[] = [];
  const close = skipToClose(stop, extra);
  const name = displayName(component);

  if (close === undefined) {
    // No closing marker anywhere after the cursor: the server never closed this block, which is not a
    // shape to repair — the walk has no way to tell where the component ends, and guessing would
    // delete a sibling. Left alone, reported, and the cursor stays where it is.
    if (__DEV__) {
      diagnose(
        "RMD007",
        `${name}:unclosed`,
        `<${name} />'s block in the server markup has no closing marker, so the walk cannot tell where it ends.`,
      );
    }
    open.remove();
    return;
  }

  walk.cursor = nextOf(close);
  /**
   * What is reported is what the SERVER sent and this render did not want — not the tail of a split
   * this level made repairing a text child. That tail is the second half of a divergence already
   * reported, and counting it turned one fault into two diagnostics: `<Status />` rendering `ready`
   * against the server's `waiting` said both "the text differs" and "your block is one node
   * shorter", the second of which describes nothing a reader can act on.
   */
  let fromServer = 0;
  for (const node of extra) {
    if (!splitRemainders.has(node)) fromServer++;
    node.remove();
  }
  close.remove();
  open.remove();

  if (__DEV__ && fromServer > 0) reportBlockLengthMismatch(component, fromServer);
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

  // Before the count below, so a tail this level's own repair produced is not reported as content
  // the server sent: it is not content, it is the half of a split nobody claimed.
  walk.cursor = dropUnclaimedRemainders(walk.cursor);

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

/**
 * Takes out the block `open` began, and puts the walk after it.
 *
 * For a component whose adoption threw: whatever the server wrote for it is markup nobody owns now,
 * and leaving it in place puts stale content under a fallback. The walk has to end up past the
 * block either way, or the siblings after it are matched against nodes that were never theirs.
 *
 * The MARKER is the argument, not the cursor. Taking the cursor was right only for a throw raised
 * before the walk stepped inside — from the component's own `render()`, which is the one case the
 * first version of this was written against. A throw from deeper in its adoption leaves the cursor
 * on a node INSIDE the block, where the guard found no marker and did nothing: measured, the
 * component's opening marker stayed in the page still carrying its state blob, the enclosing
 * component took the failing one's close for its own, and the next sibling was built fresh beside
 * the server's untouched copy of it — two `<p id="foot">` in the page.
 */
function dropBlock(open: Comment, walk: HydrationWalk): void {
  const inside: ChildNode[] = [];
  const close = skipToClose(open.nextSibling as EnhancedChildNode | null, inside);
  walk.cursor = nextOf((close ?? open) as unknown as EnhancedChildNode);
  for (const node of inside) node.remove();
  close?.remove();
  open.remove();
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
      skipUnclaimableRemainder(walk);
      let region: ComponentRegion | undefined;
      try {
        region = hydrateComponentRegion(rawVchild, placeholder, parent, walk, componentRegionOwner(rawVchild, i));
      } catch (e) {
        /**
         * The BUILD path inside `hydrateComponentRegion` — the branch it takes when the server
         * wrote no marker where one belongs. It has no block of its own to take out, and its own
         * catch has already released the instance, so all that is left is to put the error where
         * the build path puts it. Everything that throws with a marker in hand is handled there,
         * because only there is it known where the block began.
         */
        const handler = errorHandler(e, placeholder);
        if (handler !== undefined) queuePostCommit(handler, () => addTaskToQueue(handler));
      }
      if (region !== undefined) {
        entries.push(region);
        hasRegion = true;
        walk.count++;
      }
      continue;
    }

    const vchild = filterVirtualChild(rawVchild);
    if (vchild === undefined) continue;

    // Only a text child can claim the tail of a split; an element in that position would REPLACE it
    // and the server's own node behind it would be left over.
    if (typeof vchild !== "string") skipUnclaimableRemainder(walk);

    const before = walk.cursor;
    walk.cursor = hydrateNode(vchild, placeholder, walk.cursor, parent);
    walk.count++;

    // The node this child ended up on: whatever now sits where `before` was.
    // Reading it back from the parent survives the replace and insert paths,
    // where `before` is detached and useless.
    const placed = walk.cursor ? walk.cursor.previousSibling : parent.lastChild;
    const claimed = (placed ?? before) as EnhancedChildNode | null;
    if (claimed) {
      /**
       * The slot goes on now, at adoption, and not on the first update that happens to touch it.
       *
       * A node the client adopts is matched by POSITION until something stamps it, and position is
       * exactly what moves when a child above it appears. So the first update after hydration that
       * added a leading child handed each of these nodes its neighbour's slot: the text was patched
       * either way, and focus, scroll and an uncontrolled input's value went with the node rather
       * than with the row. `i` is the same slot the diff would write — its own children index,
       * counting the ones that render nothing.
       */
      stampSlot(claimed, i, typeof vchild !== "string" && vchild.attributes?.key != null);
      entries.push(claimed);
    }
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
  /**
   * allSettled: one failed deferral must still release the subtree, or a component whose load
   * failed would stay frozen instead of rendering the failure it knows how to render.
   *
   * For ONE as well as for several, which it did not used to be. A single promise was handed back
   * raw, and the caller does `void deferred.finally(…)` — so a rejection had nobody to take it and
   * became an unhandled rejection: `window.onerror` in a browser, and a process a Node runtime may
   * refuse to keep alive. Two deferrals in the same component never did this, because `allSettled`
   * takes the rejection itself. One deferral is the common case, so the common case was the broken
   * one.
   */
  return Promise.allSettled(waiting);
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

  /**
   * The hooks are refreshed HERE too, and for the reason the direct path already writes down:
   * `useCommon` calls a hook's options callback during construction, so a hook holds whatever the
   * fields held then.
   *
   * A deferral exists to change something before the subtree renders — that is what it is FOR, and
   * what `AsyncLoad` does with it. Whatever it moved reached the component and not its hooks, so the
   * resume rendered the pre-deferral answer. Measured on a `@deferHydration` that sets `locale` from
   * the chunk it awaited: `5 usd` where the component's own state already said `sr`.
   */
  if (component[INTERNAL_HOOKS]) {
    for (const update of component[INTERNAL_HOOKS]) update();
  }

  /**
   * The walk starts on the first node the server wrote inside this block.
   *
   * The nodes collected at defer time are NOT reused as a record: they were never diffed, so what
   * belongs to which child is exactly the question this walk answers. They were kept so the parent
   * could report the truth about its own children in the meantime.
   */
  const walk: HydrationWalk = { cursor: block.open.nextSibling as EnhancedChildNode | null, count: 0 };

  try {
    const children = generateRenderOutput(component);
    const inner = hydrateLevel(children, component, block.parent, walk);
    region.entries = inner.entries;

    closeBlock(block.open, walk, component);
  } catch (e) {
    /**
     * The same door the direct path has, and this one needs it more: there is no caller to catch
     * anything here — the resume is reached through `void deferred.finally(…)`, so a throw becomes
     * an unhandled rejection and nothing else happens. The block would stay in the page for the
     * life of it, markers and all, and nothing would still know the subtree is unhydrated: the
     * pending flag, the stalled-hydration watch and the `deferredBlocks` entry are all cleared
     * above, so RMD017 could never fire for it either.
     *
     * A component that renders on the server and throws on the client is what a `typeof window`
     * branch does, and a deferred subtree is exactly where the client half is likeliest to be
     * wrong — it is deferred because the client cannot render it yet.
     */
    adoptionFailed(e, block.open, component, componentRuntime.parent, walk);
    flushPostCommit();
    return;
  }

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

    const dedupKey = `stalled-hydration:${displayName(component)}`;

    if (__DEV__) {
      diagnose(
        "RMD017",
        dedupKey,
        `<${displayName(component)} /> deferred its hydration and never resumed. ` +
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
    reportStructureMismatch(placeholder, `<${vnodeName(vnode)}>`, describeFound(existingNode));
  }
  const fresh = diffAndMerge(vnode, placeholder, undefined);

  /**
   * Replaced only when the node in the way is CONTENT. A comment is structure — a component's
   * marker, or a block's anchor — and replacing one deletes the answer to "where does this run
   * end", which nothing can work out again.
   *
   * The cursor is a closing marker exactly when the client renders one child MORE than the server
   * did, which is an ordinary divergence. Replacing it left the block with no close of its own, so
   * `closeBlock` took the ENCLOSING component's close for its own and removed everything in
   * between: the next sibling's opening marker, its nodes and its state blob. That sibling was then
   * reached with no marker at all, built fresh, and the server's state thrown away. Measured on a
   * component that rendered one extra `<i>`: its neighbour went from `sib42` to `sib0` and its
   * `shared` `@created` ran a second time.
   *
   * Text and components have always inserted in front of the cursor here; this is the path that
   * did not.
   */
  if (existingNode === null) {
    parent.appendChild(fresh);
  } else if (existingNode.nodeType === 8) {
    parent.insertBefore(fresh, existingNode);
    // The marker still belongs to whoever owns it, so the walk must not step past it: it is the
    // node the caller has to see next.
    return existingNode;
  } else {
    parent.replaceChild(fresh, existingNode);
  }
  return nextOf(fresh as EnhancedChildNode);
}
