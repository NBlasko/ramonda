import { Hook } from "./Hook";
import { create, destroy, watchProp } from "./decorators";
import { HEAD_ATTR } from "../helpers/constants";
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
 * ## Why it writes to `document.head` rather than collecting into a registry
 *
 * Because there is a `document` on both sides. `renderToString` runs under a DOM
 * (see `apps/playground-ssr/server.mjs`, which installs one JSDOM per request),
 * so writing to `document.head` is the same operation server-side and
 * client-side, and there is no second code path to keep in step.
 *
 * The alternative — a module-level map of collected tags, which is how most
 * frameworks' head libraries do it — is exactly the thing this codebase refuses:
 * module scope is shared by concurrent requests, so two renders in flight would
 * read each other's title. Nothing here is module-level.
 *
 * ## Updating and cleanup
 *
 * Applying is an **upsert**, keyed by what identifies the tag (`name` /
 * `property` / `httpEquiv` for meta, `rel`+`href` for link). So hydration finds
 * the server's tags and updates them in place instead of doubling every one.
 *
 * On unmount the hook removes the elements it created. The title is restored to
 * what it was **only if nothing else has set one since** — otherwise the page
 * that replaced this one has already spoken and must not be undone.
 *
 * Reactive: pass a callback (`this.use(Head, () => ({ title: this.pageTitle }))`)
 * and the head follows the value.
 */
export class Head extends Hook<HeadOptions> {
  /** The elements this instance put in the head, so it removes only its own. */
  private owned: Element[] = [];
  /** What `document.title` was before this hook first touched it. */
  private previousTitle: string | undefined;
  /** The last title this hook set, to tell "still mine" from "someone else's". */
  private appliedTitle: string | undefined;

  /**
   * `shared`, so the server gets the head too — the entire reason this runs here rather
   * than in the reactive half: a `@watchProp` does not fire on mount, and nothing reactive
   * runs during a server render at all.
   */
  @create({ env: "shared" })
  applyOnCreate(): void {
    this.apply();
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
  applyOnChange(): void {
    this.apply();
  }

  @destroy
  removeOwnTags(): void {
    for (const element of this.owned) element.remove();
    this.owned.length = 0;

    // Only if this hook's title is still the one showing. A route swap mounts
    // the next page's Head before this one is destroyed, so by now the title may
    // legitimately belong to someone else.
    if (this.previousTitle !== undefined && document.title === this.appliedTitle) {
      document.title = this.previousTitle;
    }
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

  private apply(): void {
    const { title, description, meta, link } = this.readOptions();

    if (title !== undefined) {
      if (this.previousTitle === undefined) this.previousTitle = document.title;
      document.title = title;
      this.appliedTitle = title;
    }

    if (description !== undefined) {
      this.upsertMeta({ name: "description", content: description });
    }

    if (meta !== undefined) {
      for (const tag of meta) this.upsertMeta(tag);
    }

    if (link !== undefined) {
      for (const tag of link) this.upsertLink(tag);
    }
  }

  /**
   * Finds an existing tag by its identifying attribute, or creates one.
   *
   * The lookup is what makes hydration work: the server already wrote these
   * tags into the HTML, so the client must recognise and update them rather than
   * append a second copy of every one.
   */
  private claim(selector: string, tagName: string): Element {
    const existing = document.head.querySelector(selector);
    if (existing) {
      // Adopt a tag the server wrote, so this hook removes it on unmount.
      if (!this.owned.includes(existing)) {
        existing.setAttribute(HEAD_ATTR, "");
        this.owned.push(existing);
      }
      return existing;
    }

    const created = document.createElement(tagName);
    created.setAttribute(HEAD_ATTR, "");
    document.head.appendChild(created);
    this.owned.push(created);
    return created;
  }

  private upsertMeta(tag: MetaTag): void {
    const key = tag.name
      ? `meta[name="${cssEscape(tag.name)}"]`
      : tag.property
        ? `meta[property="${cssEscape(tag.property)}"]`
        : tag.httpEquiv
          ? `meta[http-equiv="${cssEscape(tag.httpEquiv)}"]`
          : undefined;

    if (key === undefined) {
      if (__DEV__) {
        diagnose("RMD042", JSON.stringify(tag), `Skipped: ${JSON.stringify(tag)}`);
      }
      return;
    }

    const element = this.claim(key, "meta");
    if (tag.name) element.setAttribute("name", tag.name);
    if (tag.property) element.setAttribute("property", tag.property);
    if (tag.httpEquiv) element.setAttribute("http-equiv", tag.httpEquiv);
    // setAttribute, never innerHTML: the DOM escapes the value, so a title or
    // description carrying a quote cannot break out of the attribute.
    element.setAttribute("content", tag.content);
  }

  private upsertLink(tag: LinkTag): void {
    const element = this.claim(`link[rel="${cssEscape(tag.rel)}"][href="${cssEscape(tag.href)}"]`, "link");
    element.setAttribute("rel", tag.rel);
    element.setAttribute("href", tag.href);
    if (tag.type) element.setAttribute("type", tag.type);
    if (tag.sizes) element.setAttribute("sizes", tag.sizes);
    if (tag.crossOrigin) element.setAttribute("crossorigin", tag.crossOrigin);
    if (tag.hreflang) element.setAttribute("hreflang", tag.hreflang);
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
