import { Hook } from "./Hook";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { queueAfterCommit } from "../core/commit";
import { StableProps, created, destroyed, watchProp } from "./decorators";
import { PORTAL_ATTR } from "../helpers/constants";
import { diagnose } from "../debug/diagnostics";

/**
 * One `<meta>`. **Exactly one** of `name` / `property` / `httpEquiv` identifies
 * it, and that identity is what an update replaces rather than duplicates.
 *
 * A union rather than three optional fields, so a tag with nothing to identify
 * it is a type error at the call site. Without an identity there is no way to
 * find the tag again, so every update would append another copy — and the
 * failure is invisible until a page has been open long enough to accumulate
 * them. The runtime still checks it, for JS callers and suppressed errors.
 */
export type MetaTag =
  | { name: string; content: string; property?: never; httpEquiv?: never }
  | { property: string; content: string; name?: never; httpEquiv?: never }
  | { httpEquiv: string; content: string; name?: never; property?: never };

/** One `<link>`. Identified by `rel` plus `href`. */
export interface LinkTag {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
  crossOrigin?: string;
  hreflang?: string;
}

export interface HeadOptions {
  /**
   * The page title. Set it on every page: a site whose tabs and search results
   * all read the same thing has thrown away its strongest ranking signal and the
   * only line a person actually reads in a result list.
   */
  title?: string;
  /**
   * `<meta name="description">`. This is the snippet under the title in a search
   * result. First class rather than left to `meta` below, because it and `title`
   * are the two that decide whether anyone clicks.
   */
  description?: string;
  /** Anything else — Open Graph, Twitter cards, robots, viewport. */
  meta?: readonly MetaTag[];
  /** Canonical URLs, alternates, icons, preloads. */
  link?: readonly LinkTag[];
}

/**
 * Sets the document's `<head>` for the page being rendered — on the server and
 * on the client, through one code path.
 *
 * ```tsx
 * class StateGuide extends Component {
 *   head = this.use(Head, () => ({
 *     title: "State — Ramonda",
 *     description: "How @state turns a class field into a signal.",
 *   }));
 *
 *   render() { return <article>…</article>; }
 * }
 * ```
 *
 * ## Why a hook
 *
 * A decorator would fix the values at class-definition time, so a title could
 * never contain anything the page computed. An option on `renderToString` would
 * only let the TOP of the tree speak, and the component that knows the title is
 * the leaf — the route, not the shell.
 *
 * As a hook it composes the way the tree does. A layout sets a default, a route
 * inside it overrides the title, and the deeper one wins because it applies
 * later: render order is parent before child.
 *
 * ## What a hook owns: nothing
 *
 * A `Head` PUBLISHES what its page wants and never touches the document. One
 * registry per document resolves every published entry into the head the document
 * should have, and it alone creates, updates and removes elements.
 *
 * That is not a style preference — it is the only thing that survives a page
 * replacing another. Two `Head`s exist at once during a swap, because the incoming
 * page's `@created` runs before the outgoing page's `@destroyed`. When each held its
 * own list of elements to remove, the incoming page adopted
 * `<meta name="description">`, the outgoing page still had that same element in its
 * list, and its teardown took it out of the document — so a navigation left the
 * reader on a page that described itself and had no description. A `<link>` shared
 * by both went the same way. Two objects deciding ownership independently makes a
 * handover a race; one registry makes it an agreement.
 *
 * The registry is a function of the current tree, so nothing depends on the
 * order the two lifecycles interleave: whichever runs first, the state afterwards
 * is what the remaining nodes say it should be.
 *
 * The same shape as the router's store, and for the same reason — see
 * `packages/router/src/store.ts`. Almost every other router keeps its state in
 * module scope; Ramonda's belongs to a `<Router>` instance and reaches components
 * through context, because module scope is shared by concurrent requests and two
 * renders in flight would read each other's URL. The head registry is keyed by the
 * **document**, which is what makes it per-request in the same way: a server render
 * runs under a DOM installed for that request (see `apps/playground-ssr`), and
 * `resetHeadRegistry` clears it at the request boundary for the case where one
 * document is reused.
 *
 * ## Resolution — a tree of `Head`s, not of components
 *
 * Each `Head` finds the nearest one ABOVE it and hangs off it, so the registry holds
 * a tree, resolved outermost-first: a layout sets a default, a route inside it
 * overrides the title, and per tag the deeper one wins.
 *
 * "Above" is read off the CONTEXT, which is what keeps components that have no
 * `Head` out of it entirely. Component depth would have counted them, and then
 * wrapping a route in a guard, a provider or a presentational shell would have moved
 * it a level down and let it beat a page it is not nested under — which page owns
 * the title decided by incidental nesting. A `Head` that publishes itself is found by
 * every descendant however many wrappers apart they are, and by no sibling — see
 * `Context` for the two properties that buy that.
 *
 * Where two `Head`s DO share a parent, BOTH stay — they are siblings, and the head is
 * the merge of the tree per tag: their different tags coexist, and a genuine conflict
 * (both set the title) goes to the later publisher. A sidebar and a main area, both
 * alive, both contribute. This is the case a single-slot chain got wrong: it let the
 * later sibling overwrite the earlier and drop a live page's tags. A page SWAP still
 * comes out right without a rule of its own — the outgoing node removes itself on
 * `@destroyed`, `resolve` runs after the commit, and it sees only what is still live.
 *
 * Applying is an **upsert**, keyed by what identifies the tag (`name` / `property`
 * / `httpEquiv` for meta, `rel`+`href` for link), so hydration finds the server's
 * tags and updates them in place instead of doubling every one. An element no
 * remaining entry asks for is removed, and the title goes back to what the document
 * had before any `Head` spoke.
 *
 * Reactive: pass a callback (`this.use(Head, () => ({ title: this.pageTitle }))`)
 * and the head follows the value.
 *
 * `meta` and `link` are declared VALUES: a call site writes them as an array literal inside the
 * callback, so a fresh one arrives on every evaluation and every prop is a signal comparing by
 * reference. Without this the head republished on every render of the owner, whatever it changed.
 */
@StableProps("meta", "link")
export class Head extends Hook<HeadOptions> {
  /** This hook's node in the tree, and the proof it has published — see `publish`. */
  private node: HeadNode | undefined;
  /**
   * The registry it published INTO, held rather than looked up again.
   *
   * Looking it up would create one when none is there, and a registry created by a
   * retraction is a registry that captured its "title before" from a document the
   * page had already changed — so the way out led somewhere the page was never at.
   */
  private registry: HeadRegistry | undefined;

  /**
   * `shared`, so the server gets the head too — the entire reason this runs here rather
   * than in the reactive half: a `@watchProp` does not fire on mount, and nothing reactive
   * runs during a server render at all.
   */
  @created({ env: "shared" })
  publishOnCreate(): void {
    this.publish();
  }

  /**
   * The same publication again, client only — for the one path where the `shared`
   * one above never runs: HYDRATION.
   *
   * Hydrating runs only the `env === "client"` creates, because create and mount
   * already ran on the server and their state was restored. That is right for a
   * component, whose state comes back from the hydration blob. It is wrong for this
   * hook, because what its `@created` does is not carried in any blob: it puts the
   * page into the registry, and a page that is not in the registry is a page whose
   * tags nothing will ever update or remove.
   *
   * The hook cannot tell that it was hydrated rather than built, so both run and
   * `publish` refuses the second. A guard field rather than a coincidence of
   * idempotent operations — publishing twice would put the page in the registry
   * twice, and then one `@destroyed` would leave half of it behind.
   */
  @created({ env: "client" })
  publishOnHydrate(): void {
    this.publish();
  }

  /**
   * Joins the tree under the nearest `Head` above, and leaves itself on the
   * context for the ones below.
   *
   * Added to the parent's SET of children, not into a single slot — so a sibling
   * that publishes after this one does not displace it; both stay and the head is
   * the merge of the tree. A page SWAP still comes out right without a rule of its
   * own: the outgoing node removes itself on `@destroyed`, and `resolve` runs after
   * the commit, so it only ever sees the nodes still live.
   *
   * Done in `@created` rather than the constructor because the context a component
   * writes to must be its OWN, and because its children are rendered afterwards —
   * which is exactly when they need to find this.
   */
  private publish(): void {
    if (this.node !== undefined) return;

    const registry = registryForDocument();
    const context = this[GLOBAL_RUNTIME].context;
    const parent = context[HEAD_PARENT] as HeadNode | undefined;

    // The raw options, NOT flattened: the node is the state, and the head is a
    // function of the tree computed each apply. Flattening here would cache a
    // derived value on the node and make it the thing that can go stale.
    const node: HeadNode = { options: this.readOptions(), parent, children: new Set() };

    // A SET of children, not one slot. Two Heads that share a parent and are both
    // alive — a sidebar and a main area under one layout — are siblings, and both
    // belong in the tree. The single-slot chain this replaced let the later one
    // overwrite the earlier, dropping a live page's tags.
    if (parent === undefined) registry.roots.add(node);
    else parent.children.add(node);

    // An OWN property, so this component's descendants inherit it and its siblings
    // — which read the same ancestor object — do not.
    context[HEAD_PARENT] = node;

    this.registry = registry;
    this.node = node;
    scheduleApply(registry);
  }

  /**
   * The reactive half, client only: re-applies when the options actually change.
   *
   * ## One selector per option, and why that is safe here
   *
   * Every option is its own dependency, so this runs when one of them moved and never for a
   * render that changed something else — and `previous[i] === next[i]` says WHICH moved, which a
   * single value cannot.
   *
   * It was one selector returning `JSON.stringify([...])` until the class declared `meta` and
   * `link` stable. That was not a flourish: `@watchProp` compares with `Object.is`, a call site
   * writes those two as array literals inside its callback, and a fresh array is never equal to
   * the last one. Measured over five re-renders with identical contents — the serialized form
   * fired 0 times, plain selectors fired 5, and plain selectors with `@StableProps` fire 0. The
   * comparison moved to where it belongs: the hook says the arrays are values, so every consumer
   * of them gets that, not only this watcher.
   *
   * ## Why the re-apply is a `@watchProp` rather than an effect
   *
   * Order. `@created` runs parent→child, so a route nested in a layout applies last and
   * wins — the semantics anyone would expect. Effects run the other way (child→parent, so
   * a parent's `@mounted` sees its children mounted), so re-applying from one hands the
   * title straight back to the layout on the first commit. That needs a guard: compare
   * against the last applied snapshot, and let the first run be a no-op because `@created`
   * has already done it in the right order.
   *
   * A `@watchProp` runs in the build phase, in the same parent→child order as `@created`, and
   * **does not fire on mount at all** — so the first application belongs to `@created`, later
   * ones to this, and the deeper Head wins in both. The guard field went with the effect.
   */
  @watchProp(
    (props) => props.title,
    (props) => props.description,
    (props) => props.meta,
    (props) => props.link,
  )
  republishOnChange(): void {
    if (this.node === undefined || this.registry === undefined) return;
    // Just the raw options — resolution flattens the whole tree on apply.
    this.node.options = this.readOptions();
    scheduleApply(this.registry);
  }

  /**
   * Withdraws the page, and lets the registry work out what that leaves.
   *
   * Nothing is removed from the document here. What the remaining entries no longer
   * ask for goes; what an incoming page has already published stays, whichever of
   * the two lifecycles ran first.
   */
  @destroyed
  retract(): void {
    const registry = this.registry;
    const node = this.node;
    this.node = undefined;
    this.registry = undefined;
    if (node === undefined || registry === undefined) return;

    // Removing THIS node from its parent's set, and nothing else. No "is the slot
    // still mine" guard: a page being replaced is destroyed after the page
    // replacing it has published, but the two are DIFFERENT nodes in the set, so
    // deleting one never touches the other. The tree makes the handover an
    // agreement without comparing entries — the chain needed the comparison only
    // because it had one slot to fight over.
    if (node.parent === undefined) registry.roots.delete(node);
    else node.parent.children.delete(node);

    scheduleApply(registry);
  }

  /**
   * Reads every option through the proxy, so a reactive caller's signals are all
   * registered as dependencies of whoever is reading — not just the ones a
   * particular page happens to set.
   */
  private readOptions(): HeadOptions {
    const { title, description, meta, link } = this.props;
    return { title, description, meta, link };
  }
}

/**
 * One `Head`'s node in the tree of `Head`s — not of components.
 *
 * It holds the RAW options, never a flattened form: the tree is the state, and the
 * document's head is a function of it, recomputed each apply (see `resolve`). Caching
 * a derived value here is exactly what would let the node go stale.
 *
 * `parent` is the nearest `Head` ABOVE this one; `children` are the live `Head`s
 * directly below it. A general tree, not a chain: two `Head`s that share a parent and
 * are both alive — a sidebar and a main area under one layout — are siblings, and the
 * tree keeps BOTH. A single-slot chain could only hold one, so the later publisher
 * dropped the earlier's tags while its page was still on screen. A page SWAP still
 * comes out right without a special rule: the outgoing node removes itself from the
 * set on `@destroyed`, and `resolve` runs after the commit, so it only ever sees the
 * nodes still live.
 */
interface HeadNode {
  /** This node's own contribution, raw — flattened only during `resolve`. */
  options: HeadOptions;
  parent: HeadNode | undefined;
  children: Set<HeadNode>;
}

/**
 * Where a `Head` leaves itself for the `Head`s below it to find.
 *
 * On the CONTEXT — the mechanism is on `Context`, and this is one of the two keys published
 * there — which is what makes the tree a tree of `Head`s rather than of components: a descendant
 * finds whatever an ancestor published however many components apart they are, and a wrapper, a
 * guard or a provider in between is invisible, because it publishes nothing. Component depth would
 * have counted those, so wrapping a route in anything at all would have changed which page owns
 * the title.
 *
 * A symbol, so nothing else on that object can name it, which is what makes it safe to share the
 * object with `createContext`. Sibling isolation is not a rule anything has to enforce here.
 */
const HEAD_PARENT = Symbol("ramondaHeadParent");

/** A tag the resolved head should contain: the selector that identifies it, and what it says. */
interface ResolvedTag {
  tagName: "meta" | "link";
  attributes: Record<string, string>;
}

/**
 * Everything one document's head is, in one place.
 *
 * `managed` maps a tag's identifying selector to the element standing for it, and
 * it is the ONLY record of which elements belong to Ramonda. No hook holds one.
 */
interface HeadRegistry {
  /**
   * The `Head`s with no `Head` above them — usually one, but a page can hold
   * several independent top-level `Head`s at once, and during a swap the incoming
   * root is here beside the outgoing one until the latter's `@destroyed`. Each hangs
   * its subtree off itself through `children`.
   */
  roots: Set<HeadNode>;
  managed: Map<string, Element>;
  /**
   * For an element the registry ADOPTED rather than created: the attributes it had before, to put
   * back when no page asks for it any more.
   *
   * Absent for one the registry built, which is the whole distinction — a tag nothing in the
   * document had must not outlive the page that asked for it, and a tag the page author wrote must
   * not be deleted by a page that merely borrowed it. `title` had this from the start
   * (`originalTitle`); the tags did not, so a hand-written `<meta name="description">` in
   * `index.html` was taken over and then removed for good.
   */
  adopted: Map<string, { original: Record<string, string>; applied: Record<string, string> }>;
  /** What the document's title was before any `Head` published, to go back to. */
  originalTitle: string;
  /**
   * The last title the registry itself wrote, to tell "still ours" from "someone
   * else's" — see `applyRegistry`.
   */
  appliedTitle: string | undefined;
}

/**
 * Keyed by the document rather than kept in module scope — the distinction the
 * router makes for the same reason. A server render runs under a DOM installed for
 * that request, so this is per-request; `resetHeadRegistry` covers a document that
 * is reused between them.
 */
const registries = new WeakMap<Document, HeadRegistry>();

function registryForDocument(): HeadRegistry {
  let registry = registries.get(document);
  if (registry === undefined) {
    registry = {
      roots: new Set(),
      managed: new Map(),
      adopted: new Map(),
      originalTitle: document.title,
      appliedTitle: undefined,
    };
    registries.set(document, registry);
  }
  return registry;
}

/**
 * Drops a document's registry, for a server that renders more than one request into
 * the same DOM. Called from `resetHead` in `hydration/ssr.ts`, which is where the
 * request boundary already is.
 */
export function resetHeadRegistry(): void {
  const registry = registries.get(document);
  registries.delete(document);

  /**
   * Unmarked as well as dropped.
   *
   * A registry marked for recompute and then discarded is still in `dirty`, and the
   * next commit would recompute it — writing a finished request's title and tags
   * into the document the NEXT one is rendering into. The whole reason this function
   * exists is that boundary, so leaving a way across it defeats it.
   */
  if (registry !== undefined) dirty.delete(registry);
}

/** The selector that identifies a `<meta>`, or `undefined` when nothing does. */
function metaSelector(tag: MetaTag): string | undefined {
  if (tag.name) return `meta[name="${cssEscape(tag.name)}"]`;
  if (tag.property) return `meta[property="${cssEscape(tag.property)}"]`;
  if (tag.httpEquiv) return `meta[http-equiv="${cssEscape(tag.httpEquiv)}"]`;
  return undefined;
}

function collectMeta(tags: Map<string, ResolvedTag>, tag: MetaTag): void {
  const selector = metaSelector(tag);
  if (selector === undefined) {
    if (__DEV__) {
      diagnose("RMD043", Object.keys(tag).sort().join(","), `Skipped: ${JSON.stringify(tag)}`, {
        fields: Object.keys(tag).sort().join(","),
      });
    }
    return;
  }

  const attributes: Record<string, string> = {};
  // Guarded, not `{ content: tag.content }`: the type requires `content`, but a JS
  // caller can omit it, and stringifying undefined ships `content="undefined"`.
  if (tag.content !== undefined) attributes.content = tag.content;
  if (tag.name) attributes.name = tag.name;
  if (tag.property) attributes.property = tag.property;
  if (tag.httpEquiv) attributes["http-equiv"] = tag.httpEquiv;
  tags.set(selector, { tagName: "meta", attributes });
}

function collectLink(tags: Map<string, ResolvedTag>, tag: LinkTag): void {
  const attributes: Record<string, string> = { rel: tag.rel, href: tag.href };
  if (tag.type) attributes.type = tag.type;
  if (tag.sizes) attributes.sizes = tag.sizes;
  if (tag.crossOrigin) attributes.crossorigin = tag.crossOrigin;
  if (tag.hreflang) attributes.hreflang = tag.hreflang;
  tags.set(`link[rel="${cssEscape(tag.rel)}"][href="${cssEscape(tag.href)}"]`, { tagName: "link", attributes });
}

/**
 * Flattens one `Head`'s options into the tags it contributes.
 *
 * Options are the shape an app writes — a `description` shorthand, a list of meta,
 * a list of link. Tags are the shape the document needs: a selector that identifies
 * each one and the attributes it should carry. Deriving that means building
 * selectors and escaping values, and none of it depends on anything outside this
 * node's options.
 *
 * Called from `resolve`, once per node per apply. An earlier version cached the
 * result on the node and re-derived only on change; the tree rewrite dropped that
 * cache on purpose, so the node holds only raw options and the head is always a pure
 * function of the tree. The cost is re-deriving selectors each apply (measured at the
 * time as ~3 µs for a 14-tag layout/section/page), traded for one source of truth.
 */
function flatten(options: HeadOptions): { title: string | undefined; tags: Map<string, ResolvedTag> } {
  const tags = new Map<string, ResolvedTag>();

  if (options.description !== undefined) collectMeta(tags, { name: "description", content: options.description });
  if (options.meta !== undefined) for (const tag of options.meta) collectMeta(tags, tag);
  if (options.link !== undefined) for (const tag of options.link) collectLink(tags, tag);

  return { title: options.title, tags };
}

/**
 * The head the tree adds up to — computed WHOLE, from the nodes as they are now.
 *
 * A pre-order walk: each node's own tags first, then its children. So a deeper
 * `Head` overrides a shallower one, and a later sibling overrides an earlier one —
 * but only where they name the SAME tag; different tags coexist, which is what lets
 * a sidebar and a main area both contribute. Roots and children are visited in
 * publish order (the `Set`s keep insertion order), so "later wins" is deterministic.
 *
 * Recomputed every apply rather than cached and patched, and `flatten` runs here per
 * node rather than being stored on it. That is the point the rewrite turned on: the
 * answer is a function of the tree as it stands, so no interleaving of publish and
 * retract can leave the document holding a tag nothing asks for, and no node can hold
 * a stale derived value. The cost is re-deriving selectors each apply — the cache the
 * chain kept — which is the trade made for the tree being the single source of truth.
 */
function resolve(roots: Set<HeadNode>): { title: string | undefined; tags: Map<string, ResolvedTag> } {
  let title: string | undefined;
  const tags = new Map<string, ResolvedTag>();

  const visit = (node: HeadNode): void => {
    const flat = flatten(node.options);
    if (flat.title !== undefined) title = flat.title;
    for (const [selector, tag] of flat.tags) tags.set(selector, tag);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);

  return { title, tags };
}

/**
 * Finds the element for a selector, or makes one.
 *
 * The lookup is what makes hydration work: the server already wrote these tags into
 * the HTML, so the client must recognise and update them rather than append a
 * second copy of every one.
 */
/**
 * The element, unless it is no longer in the head.
 *
 * A remembered element is not proof of a tag in the document: an extension, an
 * analytics snippet or anything writing `document.head.innerHTML` can take it out,
 * and then every later update wrote attributes onto a detached node — the page had
 * no description, nothing said so, and the next write did not fix it either,
 * because the registry went on believing it owned one.
 *
 * `parentNode`, not `isConnected`: this runs under whatever DOM a server render
 * installed, and the cheap check is the one every implementation has.
 */
function live(element: Element | undefined): Element | undefined {
  if (element === undefined) return undefined;
  return element.parentNode === document.head ? element : undefined;
}

/**
 * Takes off what this tag no longer asks for.
 *
 * The upsert only ever SET attributes, so one a page stopped passing stayed on the
 * element forever: `<link rel="alternate" href="/a" hreflang="en">` that became
 * plain `<link rel="alternate" href="/a">` was still telling a crawler the page is
 * in English. The resolved tag is the whole truth about what the element should
 * carry, so anything else on it is left over.
 *
 * `PORTAL_ATTR` is kept, because it is not part of the tag's meaning — it is how the
 * server tells its own tags apart from the shell's.
 */
function dropUnwantedAttributes(element: Element, wanted: Record<string, string>): void {
  for (const name of element.getAttributeNames()) {
    if (name === PORTAL_ATTR || name in wanted) continue;
    element.removeAttribute(name);
  }
}

/**
 * The element for a selector, and whether it was ALREADY THERE.
 *
 * The second half is the caller's whole reason for asking: a tag the PAGE AUTHOR wrote is
 * borrowed and goes back when no page wants it, while one Ramonda wrote belongs to the page and
 * goes with it. That cannot be worked out afterwards, because the first thing done to either is to
 * mark it.
 *
 * **Already carrying the marker is not the author's.** That is a tag this framework wrote on the
 * SERVER, which the client adopts on hydration — the whole reason `collectHead` uses the same
 * marker to find them. Restoring one of those would leave a server-rendered description standing
 * after the page that asked for it unmounted, which is what two hydration tests say and they are
 * right.
 */
function elementFor(selector: string, tagName: string): { element: Element; adopted: boolean } {
  const existing = document.head.querySelector(selector);
  if (existing) {
    const ours = existing.hasAttribute(PORTAL_ATTR);
    existing.setAttribute(PORTAL_ATTR, "");
    return { element: existing, adopted: !ours };
  }

  const created = document.createElement(tagName);
  created.setAttribute(PORTAL_ATTR, "");
  document.head.appendChild(created);
  return { element: created, adopted: false };
}

/** Every attribute an element carries, less the marker, which is this module's own bookkeeping. */
function attributesOf(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value } of element.attributes) {
    if (name !== PORTAL_ATTR) out[name] = value;
  }
  return out;
}

/**
 * Whether the element still carries what this registry last wrote.
 *
 * The guard `title` has, for a tag: a script that is not a `Head` may own this element by now — a
 * live counter, an analytics tag rewriting a description — and handing the author's old values
 * back would undo a value nobody asked us to touch.
 */
function stillOurs(element: Element, applied: Record<string, string>): boolean {
  for (const name in applied) {
    if (element.getAttribute(name) !== applied[name]) return false;
  }
  return true;
}

/**
 * Puts a borrowed element back the way it was found, and hands it back to the document.
 *
 * The marker goes too: the element stops being the registry's, and leaving it would offer the
 * author's tag to whatever adopts next.
 */
function restore(element: Element, original: Record<string, string>): void {
  dropUnwantedAttributes(element, original);
  for (const name in original) element.setAttribute(name, original[name]);
  element.removeAttribute(PORTAL_ATTR);
}

/**
 * Makes the document's head match what the entries say, whatever it said before.
 *
 * Written as "compute the answer, then reconcile", not "apply my changes": the
 * result depends only on which entries are currently registered, so it does not
 * matter whether a page published before or after another retracted.
 */
/**
 * Registries with something to recompute, drained once per commit.
 *
 * Marking rather than applying is the point. Every `Head` in a tree publishes
 * during its own `@created`, and the head the document should have is a function of
 * all of them — so applying per publication does the work once per page in the
 * chain AND walks the document through states no commit ever meant to show: on a
 * route swap, the incoming page title beside the outgoing page tags, for the
 * length of one build.
 *
 * A `Set`, so a whole tree of publications collapses into one recompute. Held here
 * rather than as a flag on the registry, so a commit that never comes cannot leave
 * a registry marked and permanently skipped.
 */
const dirty = new Set<HeadRegistry>();

function scheduleApply(registry: HeadRegistry): void {
  dirty.add(registry);
  queueAfterCommit(flushHeads);
}

/**
 * Recomputes every marked registry. Idempotent, and safe to call with nothing
 * marked — which is what lets the teardown path call it unconditionally.
 */
export function flushHeads(): void {
  if (dirty.size === 0) return;
  const registries = Array.from(dirty);
  dirty.clear();
  for (const registry of registries) applyRegistry(registry);
}

function applyRegistry(registry: HeadRegistry): void {
  const { title, tags } = resolve(registry.roots);

  for (const [selector, spec] of tags) {
    const known = live(registry.managed.get(selector));
    let element = known;
    if (element === undefined) {
      const found = elementFor(selector, spec.tagName);
      element = found.element;
      // Recorded once, and only on the first adoption: a later pass would read back the attributes
      // this registry itself wrote and "restore" the page's own values.
      if (found.adopted) {
        // Only on the FIRST adoption: a later pass would read back the attributes this registry
        // itself wrote and hand the page's own values over as if they were the author's.
        if (!registry.adopted.has(selector)) {
          registry.adopted.set(selector, { original: attributesOf(element), applied: {} });
        }
      } else {
        // Built here, so it is the page's — and any note about a PREVIOUS element under this
        // selector is stale. Something removed the author's tag; what stands in its place is ours
        // and must go with the page rather than be handed to an author who no longer has one.
        registry.adopted.delete(selector);
      }
    }
    // setAttribute, never innerHTML: the DOM escapes the value, so a title or
    // description carrying a quote cannot break out of the attribute.
    for (const name in spec.attributes) element.setAttribute(name, spec.attributes[name]);
    dropUnwantedAttributes(element, spec.attributes);
    registry.managed.set(selector, element);
    // What was written, so the restore can tell "still ours" from "someone else's" — the same
    // question `title` asks, for the same reason.
    const borrowed = registry.adopted.get(selector);
    if (borrowed !== undefined) borrowed.applied = spec.attributes;
  }

  for (const [selector, element] of [...registry.managed]) {
    if (tags.has(selector)) continue;

    const borrowed = registry.adopted.get(selector);
    if (borrowed === undefined) element.remove();
    else if (stillOurs(element, borrowed.applied)) restore(element, borrowed.original);
    // else: something else owns this tag now. Left exactly as it is.

    registry.managed.delete(selector);
    registry.adopted.delete(selector);
  }

  /**
   * A page claiming a title always gets it. Going BACK is the guarded half: the
   * document's title may have been set by something that is not a `Head` at all —
   * an analytics script, a notification counter, a page writing `document.title`
   * directly — and restoring over that would undo a live value nobody asked us to
   * touch. So it goes back only if what is showing is still what this registry
   * last wrote.
   */
  if (title !== undefined) {
    document.title = title;
    registry.appliedTitle = title;
  } else if (registry.appliedTitle !== undefined && document.title === registry.appliedTitle) {
    document.title = registry.originalTitle;
    registry.appliedTitle = undefined;
  }
}

/**
 * Adds a `<link rel="modulepreload">` to the head, once.
 *
 * Separate from the `Head` hook, and deliberately simpler: this is only ever
 * called during a **server** render, where there is nothing to clean up — the
 * document is serialized and thrown away. So there is no ownership to track and
 * no unmount to survive; it upserts by `href` and stops.
 *
 * It carries the same marker every other managed head element does, so
 * `renderPage` collects it and `renderDocument` emits it with no new plumbing at
 * all. That is the whole reason preload hints cost so little to add.
 */
export function addModulePreload(href: string): void {
  const selector = `link[rel="modulepreload"][href="${cssEscape(href)}"]`;
  if (document.head.querySelector(selector)) return;

  const link = document.createElement("link");
  link.setAttribute(PORTAL_ATTR, "");
  link.setAttribute("rel", "modulepreload");
  link.setAttribute("href", href);
  document.head.appendChild(link);
}

/**
 * Escapes a value for use inside an attribute selector.
 *
 * `CSS.escape` is the right tool and jsdom has it, but it is not guaranteed
 * everywhere this runs — and a description containing a quote would otherwise
 * turn `querySelector` into a syntax error at runtime.
 */
function cssEscape(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  if (escape) return escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
