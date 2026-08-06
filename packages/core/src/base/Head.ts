import { Hook } from "./Hook";
import { GLOBAL_RUNTIME } from "../core/runtime";
import { create, destroy, watchProp } from "./decorators";
import { HEAD_ATTR } from "../helpers/constants";

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
 *   head = this.use(Head, {
 *     title: "State — Ramonda",
 *     description: "How @state turns a class field into a signal.",
 *   });
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
 * page's `@create` runs before the outgoing page's `@destroy`. When each held its
 * own list of elements to remove, the incoming page adopted
 * `<meta name="description">`, the outgoing page still had that same element in its
 * list, and its teardown took it out of the document — so a navigation left the
 * reader on a page that described itself and had no description. A `<link>` shared
 * by both went the same way. Two objects deciding ownership independently makes a
 * handover a race; one registry makes it an agreement.
 *
 * The registry is a function of the current entries, so nothing depends on the
 * order the two lifecycles interleave: whichever runs first, the state afterwards
 * is what the remaining entries say it should be.
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
 * ## Resolution — a chain of `Head`s, not of components
 *
 * Each `Head` finds the nearest one ABOVE it and hangs off it, so the registry
 * holds a chain that is resolved outermost-first: a layout sets a default, a route
 * inside it overrides the title, and per tag the deeper one wins.
 *
 * "Above" is read off the CONTEXT, which is what keeps components that have no
 * `Head` out of it entirely. Component depth would have counted them, and then
 * wrapping a route in a guard, a provider or a presentational shell would have moved
 * it a level down and let it beat a page it is not nested under — which page owns
 * the title decided by incidental nesting. A component's context is
 * `Object.create(parentContext)`, so a `Head` writing itself onto its own context is
 * inherited by every descendant however many wrappers apart they are, and by no
 * sibling: two branches get two objects off the same ancestor.
 *
 * Where two `Head`s DO share a parent, the later one to publish takes the slot and
 * the branch that was there goes with it — including everything its children
 * published. That is a rule rather than a derivation, and it is the one that makes a
 * route replacing its sibling discard the old branch whole instead of waiting for
 * each of its children to be destroyed in an order nothing guarantees.
 *
 * Applying is an **upsert**, keyed by what identifies the tag (`name` / `property`
 * / `httpEquiv` for meta, `rel`+`href` for link), so hydration finds the server's
 * tags and updates them in place instead of doubling every one. An element no
 * remaining entry asks for is removed, and the title goes back to what the document
 * had before any `Head` spoke.
 *
 * Reactive: pass a callback (`this.use(Head, () => ({ title: this.pageTitle }))`)
 * and the head follows the value.
 */
export class Head extends Hook<HeadOptions> {
  /** This hook's published entry, and the proof it has published — see `publish`. */
  private entry: HeadEntry | undefined;
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
  @create({ env: "shared" })
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
   * hook, because what its `@create` does is not carried in any blob: it puts the
   * page into the registry, and a page that is not in the registry is a page whose
   * tags nothing will ever update or remove.
   *
   * The hook cannot tell that it was hydrated rather than built, so both run and
   * `publish` refuses the second. A guard field rather than a coincidence of
   * idempotent operations — publishing twice would put the page in the registry
   * twice, and then one `@destroy` would leave half of it behind.
   */
  @create({ env: "client" })
  publishOnHydrate(): void {
    this.publish();
  }

  /**
   * Joins the chain under the nearest `Head` above, and leaves itself on the
   * context for the ones below.
   *
   * Taking the slot means the branch that held it is gone — including everything
   * ITS children published, since they hang off it. A route replacing its sibling
   * therefore discards the old branch whole, rather than waiting for each of its
   * children's `@destroy` to run in an order nothing guarantees.
   *
   * Done in `@create` rather than the constructor because the context a component
   * writes to must be its OWN, and because its children are rendered afterwards —
   * which is exactly when they need to find this.
   */
  private publish(): void {
    if (this.entry !== undefined) return;

    const registry = registryForDocument();
    const context = this[GLOBAL_RUNTIME].context as Record<symbol, unknown>;
    const parent = context[HEAD_PARENT] as HeadEntry | undefined;

    const entry: HeadEntry = { options: this.readOptions(), parent, child: undefined };

    if (parent === undefined) registry.root = entry;
    else parent.child = entry;

    // An OWN property, so this component's descendants inherit it and its siblings
    // — which read the same ancestor object — do not.
    context[HEAD_PARENT] = entry;

    this.registry = registry;
    this.entry = entry;
    applyRegistry(registry);
  }

  /**
   * The reactive half, client only: re-applies when the options actually change.
   *
   * ## Why `@watchProp` with a selector that returns a STRING
   *
   * The selector reads all four options, so every one of them is a dependency, and it
   * hands back a serialized form — which `@watchProp` then compares by value, because a
   * string does. So this runs exactly when the options moved, and never for a render that
   * changed something else. No snapshot field to keep, and no comparison of its own.
   *
   * ## Why this is not an `@effect`, which is what it used to be
   *
   * Order. `@create` runs parent→child, so a route nested in a layout applies last and
   * wins — the semantics anyone would expect. Effects run the other way (child→parent, so
   * a parent's `@mount` sees its children mounted), so an effect that re-applied handed the
   * title straight back to the layout on the first commit. That needed a guard: compare
   * against the last applied snapshot, and let the first run be a no-op because `@create`
   * had already done it in the right order.
   *
   * A `@watchProp` runs in the build phase, in the same parent→child order as `@create`, and
   * **does not fire on mount at all** — so the first application belongs to `@create`, later
   * ones to this, and the deeper Head wins in both. The guard field went with the effect.
   */
  @watchProp((props) => JSON.stringify([props.title, props.description, props.meta, props.link]))
  republishOnChange(): void {
    if (this.entry === undefined || this.registry === undefined) return;
    this.entry.options = this.readOptions();
    applyRegistry(this.registry);
  }

  /**
   * Withdraws the page, and lets the registry work out what that leaves.
   *
   * Nothing is removed from the document here. What the remaining entries no longer
   * ask for goes; what an incoming page has already published stays, whichever of
   * the two lifecycles ran first.
   */
  @destroy
  retract(): void {
    const registry = this.registry;
    const entry = this.entry;
    this.entry = undefined;
    this.registry = undefined;
    if (entry === undefined || registry === undefined) return;

    /**
     * Only if the slot is still THIS one.
     *
     * A page being replaced is destroyed after the page replacing it has published,
     * so by now the slot may hold the incoming branch — and unlinking then would
     * take away a head that is live. Comparing the entry rather than trusting the
     * order is what makes the outcome the same whichever way round they run.
     */
    if (entry.parent === undefined) {
      if (registry.root === entry) registry.root = undefined;
    } else if (entry.parent.child === entry) {
      entry.parent.child = undefined;
    } else {
      return; // already replaced; the document is the incoming branch's business
    }

    applyRegistry(registry);
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
 * One page's contribution, and its place in the chain of `Head`s — not of components.
 *
 * `parent` is the nearest `Head` ABOVE this one, and `child` the one live `Head`
 * below it. A chain rather than a general tree because only one path can be showing
 * at a time: when two `Head`s share a parent, the later one to publish takes the
 * slot, and the branch that was there goes with it. That is what makes a route
 * replacing its sibling discard everything the old branch's children had published,
 * without waiting for their `@destroy` to run in some particular order.
 */
interface HeadEntry {
  options: HeadOptions;
  parent: HeadEntry | undefined;
  child: HeadEntry | undefined;
}

/**
 * Where a `Head` leaves itself for the `Head`s below it to find.
 *
 * On the CONTEXT, which is what makes the chain a chain of `Head`s rather than of
 * components: a component's context is `Object.create(parentContext)`, so a
 * descendant inherits whatever an ancestor wrote however many components apart they
 * are — and a wrapper, a guard or a provider in between is invisible, because it
 * writes nothing. Component depth would have counted those, so wrapping a route in
 * anything at all would have changed which page owns the title.
 *
 * Two branches get two context objects off the same parent, so neither sees the
 * other. Sibling isolation is not a rule anything has to enforce here; it is what
 * prototype inheritance already does.
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
  /** The outermost `Head`; the rest hangs off it through `child`. */
  root: HeadEntry | undefined;
  managed: Map<string, Element>;
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
      root: undefined,
      managed: new Map(),
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
  registries.delete(document);
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
      console.warn(
        `[Ramonda] A <meta> passed to Head has no name, property or http-equiv, so there is nothing to identify it by and it would be duplicated on every update. Skipped: ${JSON.stringify(tag)}`,
      );
    }
    return;
  }

  const attributes: Record<string, string> = { content: tag.content };
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
 * The head the entries add up to.
 *
 * Down the chain, so later wins: the outermost `Head` first, then the one below
 * it, and a route nested in a layout overrides it.
 */
function resolve(root: HeadEntry | undefined): { title: string | undefined; tags: Map<string, ResolvedTag> } {
  let title: string | undefined;
  const tags = new Map<string, ResolvedTag>();

  for (let entry = root; entry !== undefined; entry = entry.child) {
    const { options } = entry;
    if (options.title !== undefined) title = options.title;
    if (options.description !== undefined) collectMeta(tags, { name: "description", content: options.description });
    if (options.meta !== undefined) for (const tag of options.meta) collectMeta(tags, tag);
    if (options.link !== undefined) for (const tag of options.link) collectLink(tags, tag);
  }

  return { title, tags };
}

/**
 * Finds the element for a selector, or makes one.
 *
 * The lookup is what makes hydration work: the server already wrote these tags into
 * the HTML, so the client must recognise and update them rather than append a
 * second copy of every one.
 */
function elementFor(selector: string, tagName: string): Element {
  const existing = document.head.querySelector(selector);
  if (existing) {
    existing.setAttribute(HEAD_ATTR, "");
    return existing;
  }

  const created = document.createElement(tagName);
  created.setAttribute(HEAD_ATTR, "");
  document.head.appendChild(created);
  return created;
}

/**
 * Makes the document's head match what the entries say, whatever it said before.
 *
 * Written as "compute the answer, then reconcile", not "apply my changes": the
 * result depends only on which entries are currently registered, so it does not
 * matter whether a page published before or after another retracted.
 */
function applyRegistry(registry: HeadRegistry): void {
  const { title, tags } = resolve(registry.root);

  for (const [selector, spec] of tags) {
    const element = registry.managed.get(selector) ?? elementFor(selector, spec.tagName);
    // setAttribute, never innerHTML: the DOM escapes the value, so a title or
    // description carrying a quote cannot break out of the attribute.
    for (const name in spec.attributes) element.setAttribute(name, spec.attributes[name]);
    registry.managed.set(selector, element);
  }

  for (const [selector, element] of [...registry.managed]) {
    if (tags.has(selector)) continue;
    element.remove();
    registry.managed.delete(selector);
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
  link.setAttribute(HEAD_ATTR, "");
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
