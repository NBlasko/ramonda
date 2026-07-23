import { Component, Host, state, createRef, onDocument, list } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { Link } from "@ramonda/router";

interface Result {
  url: string;
  title: string;
  excerpt: string;
}

/** The subset of Pagefind's API this uses. */
interface Pagefind {
  search(query: string): Promise<{
    results: { data(): Promise<PagefindData> }[];
  }>;
  debouncedSearch?(
    query: string,
    options?: unknown,
    delay?: number,
  ): Promise<{ results: { data(): Promise<PagefindData> }[] } | null>;
}

interface PagefindData {
  url: string;
  excerpt: string;
  meta?: { title?: string };
}

/**
 * Site search.
 *
 * Built on Pagefind's JS API rather than its bundled UI, so it is an ordinary
 * component that matches the rest of the site and needs no second stylesheet.
 *
 * ## Why Pagefind at all
 *
 * It builds its index from the **prerendered HTML**, at build time. That means it
 * only works because this site is static — and it means there is no service, no
 * account, no API key and no runtime cost beyond fetching the index fragments a
 * query actually needs.
 *
 * The index lives in `dist/pagefind/`, generated after the prerender by
 * `npm run index`.
 *
 * ## Why the import looks like that
 *
 * `/pagefind/pagefind.js` is produced by the Pagefind CLI **after** the bundler
 * has run, so the bundler must not try to resolve it. Assigning the specifier to
 * a variable first is what stops esbuild from following it — a literal
 * `import("/pagefind/…")` would be a build error for a file that does not exist
 * yet.
 */
@Host("div")
export class Search extends Component {
  @state open = false;
  @state query = "";
  @state results: Result[] = [];
  @state loading = false;
  /** Set when the index cannot be fetched — a dev server without a build, say. */
  @state unavailable = false;

  private input = createRef<HTMLInputElement>();
  private pagefind: Pagefind | undefined;
  /** Guards against an older query's results landing after a newer one's. */
  private latest = 0;

  @onDocument("keydown")
  onKey(event: KeyboardEvent) {
    if (event.key === "Escape" && this.open) {
      this.close();
      return;
    }

    // ⌘K / Ctrl-K, and "/" when the reader is not already typing somewhere.
    const inField = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(event.target.tagName);

    if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !inField)) {
      event.preventDefault();
      this.openSearch();
    }
  }

  private openSearch() {
    this.open = true;
    void this.load();
    // After the commit, so the input exists to focus.
    queueMicrotask(() => this.input.current?.focus());
  }

  close() {
    this.open = false;
    this.query = "";
    this.results = [];
  }

  /** Fetches the index on first use, never on page load. */
  private async load() {
    if (this.pagefind || this.unavailable) return;
    try {
      // The variable is load-bearing: it stops the bundler resolving a path that
      // only exists after the build.
      const specifier = "/pagefind/pagefind.js";
      this.pagefind = (await import(/* @vite-ignore */ specifier)) as Pagefind;
    } catch {
      this.unavailable = true;
    }
  }

  async onInput(event: Event) {
    const query = (event.target as HTMLInputElement).value;
    this.query = query;

    if (query.trim().length < 2) {
      this.results = [];
      return;
    }

    await this.load();
    const pagefind = this.pagefind;
    if (!pagefind) return;

    const ticket = ++this.latest;
    this.loading = true;

    const search = pagefind.debouncedSearch
      ? await pagefind.debouncedSearch(query, undefined, 120)
      : await pagefind.search(query);

    // A debounced search returns null when a newer one superseded it, and the
    // ticket covers the rest: without either, a slow early query could overwrite
    // the results of a later, more specific one.
    if (search === null || ticket !== this.latest) return;

    const top = await Promise.all(search.results.slice(0, 8).map((result) => result.data()));

    if (ticket !== this.latest) return;
    this.results = top.map((data) => ({
      url: toRoutePath(data.url),
      title: data.meta?.title ?? data.url,
      excerpt: data.excerpt,
    }));
    this.loading = false;
  }

  render(): RamondaNode {
    if (!this.open) {
      return (
        <button type="button" className="search-open" onClick={this.openSearch}>
          Search <kbd>/</kbd>
        </button>
      );
    }

    return (
      <div className="search">
        <div className="search-backdrop" onClick={this.close} />
        <div className="search-panel">
          {/*
            Backdrop and Escape close the panel, but a fullscreen mobile panel
            has neither a tappable backdrop nor an Escape key — so this is the
            only exit there. Hidden on desktop, where the other two suffice.
          */}
          <button type="button" className="search-close" onClick={this.close} aria-label="Close search">
            ✕
          </button>
          <input
            ref={this.input}
            type="search"
            className="search-input"
            placeholder="Search the documentation…"
            value={this.query}
            onInput={this.onInput}
          />
          {this.unavailable ? (
            <p className="search-note">
              The search index is not available. Run <code>npm run build</code> — it is generated from the built pages.
            </p>
          ) : this.query.trim().length < 2 ? (
            <p className="search-note">Type at least two characters.</p>
          ) : this.results.length === 0 ? (
            <p className="search-note">{this.loading ? "Searching…" : "Nothing found."}</p>
          ) : (
            /*
              The handler is on the <ul>, not on each row. `Link` takes no
              onClick — a reasonable line to draw, since its click handling
              decides whether to intercept and whether to preventDefault, so a
              user handler there would need answers for ordering and for
              cancellation. A click bubbles, so one handler on the list does it,
              and the row component needs no callback prop at all.
            */
            <ul className="search-results" onClick={this.close}>
              {/*
                `list()`, not `results.map(...)`. This is the shape the function
                exists for: the list is CONDITIONAL — it only exists when the
                panel is open and a query matched — so there is nothing to
                declare on a render that shows the empty state instead.

                `key` earns its place here, and this is the case the option
                exists for: results are fresh objects on every keystroke, but a
                page that matched "hydr" usually still matches "hydra". Keying by
                URL keeps those rows instead of rebuilding on every character.
              */}
              {list({
                each: this.results,
                as: SearchResult,
                key: (result: Result) => result.url,
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }
}

/** One result. The `as` shorthand hands it the item; it needs nothing else. */
@Host("li")
class SearchResult extends Component<{ item: Result }> {
  render(): RamondaNode {
    const result = this.props.item;
    return (
      <Link href={result.url} className="search-result">
        <strong>{result.title}</strong>
        <SearchExcerpt html={result.excerpt} />
      </Link>
    );
  }
}

/**
 * Pagefind reports a page by the URL it was indexed at — `/ssr/async/`, with a
 * trailing slash, because that is how a static host addresses
 * `dist/ssr/async/index.html`.
 *
 * The route table does not have trailing slashes, so a `<Link>` to one falls
 * through to the `*` route: measured, a search result navigated to "Not found"
 * while the URL bar showed the right page.
 */
function toRoutePath(url: string): string {
  const clean = url.replace(/index\.html$/, "").replace(/\.html$/, "");
  const trimmed = clean.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Pagefind's excerpt arrives as HTML with `<mark>` around the matches, and
 * Ramonda has no way to render an HTML string — deliberately, since markup
 * injected as a string is invisible to the diff.
 *
 * So it is parsed and turned into real nodes. The parse is the sanitisation:
 * only text and `<mark>` survive, and everything else is flattened to its text.
 * The input comes from the site's own index rather than from a user, but a
 * search excerpt is derived from page content and that is content this site
 * happens to be full of code samples in.
 */
@Host("span")
class SearchExcerpt extends Component<{ html: string }> {
  render(): RamondaNode {
    const parsed = new DOMParser().parseFromString(`<body>${this.props.html}</body>`, "text/html");

    const parts: RamondaNode[] = [];
    for (const node of Array.from(parsed.body.childNodes)) {
      const text = node.textContent ?? "";
      if (!text) continue;
      parts.push(node.nodeType === 1 && (node as Element).tagName === "MARK" ? <mark>{text}</mark> : text);
    }

    return <span className="search-excerpt">{parts}</span>;
  }
}
