import { Component, Head, Host, createRef, createSubscriptionDecorator, list, state } from "@ramonda/core";
import { InfiniteQuery, Query, QueryClientAccess, type FetchContext, type PageContext } from "@ramonda/query";

/**
 * The query package against a real API, server-rendered, with infinite scroll.
 *
 * This exists to answer what a jsdom test cannot: does a REAL server wait for real data and
 * put it in the HTML, does a REAL browser adopt that markup instead of refetching it, and does
 * `fetchNextPage` then continue from where the server stopped.
 *
 * `dummyjson.com` is used because its pagination is explicit — `{ products, total, skip, limit }`
 * — so `getNextPageParam` reads as what it is (an offset) rather than as a cursor whose meaning
 * you have to trust. No key, no signup.
 *
 * **With no network this page still renders**, showing the failure. That is not a fallback bolted
 * on: a `Query` never rejects, because a failed query is a state to render and not an exception
 * for whichever lifecycle happened to trigger it — a rejection here would abort the whole server
 * render for one panel.
 */

const API = "https://dummyjson.com";

interface Product {
  id: number;
  title: string;
  brand?: string;
  price: number;
  rating: number;
  category: string;
  description: string;
}

interface ProductPage {
  products: Product[];
  total: number;
  skip: number;
  limit: number;
}

const PAGE_SIZE = 8;

/**
 * Where the next page starts, or `undefined` when the list has ended — the only end-of-list
 * signal there is.
 *
 * A module function, not an inline arrow in the options. The props callback runs on every
 * render, so an arrow there is a fresh function every time — and RMD022 said exactly that the
 * first time this page was served, which is what the diagnostic is for. Worth keeping the
 * story: the example was written the wrong way, and the framework corrected it.
 */
function nextSkip(last: ProductPage): number | undefined {
  const seen = last.skip + last.limit;
  return seen < last.total ? seen : undefined;
}

/**
 * Loads one page. `skip` is the page param, which is why `initialPageParam` is `0` and
 * `getNextPageParam` returns the next offset — or `undefined`, which is the only end-of-list
 * signal there is.
 */
async function loadPage(ctx: PageContext): Promise<ProductPage> {
  const skip = ctx.pageParam as number;
  const response = await fetch(
    `${API}/products?limit=${PAGE_SIZE}&skip=${skip}&select=title,brand,price,rating,category`,
    {
      signal: ctx.signal,
    },
  );
  if (!response.ok) throw new Error(`products ${response.status}`);
  return (await response.json()) as ProductPage;
}

async function loadProduct(id: number, signal: AbortSignal): Promise<Product> {
  const response = await fetch(`${API}/products/${id}`, { signal });
  if (!response.ok) throw new Error(`product ${id}: ${response.status}`);
  return (await response.json()) as Product;
}

/**
 * Fires when an element scrolls into view — infinite scroll's actual trigger, and a
 * `createSubscriptionDecorator` because that is what an observer with a teardown is.
 *
 * `connect` reads nothing reactive, so it runs once and its `disconnect` runs on destroy. The
 * server has no `IntersectionObserver`; nothing here needs guarding for that, because a
 * subscription decorator is built on the effect primitive and effects are client-only.
 */
const onVisible = createSubscriptionDecorator("onVisible", (owner: Component, handler: () => void) => {
  const element = (owner as unknown as { sentinel: { current: HTMLElement | null } }).sentinel.current;
  if (!element || typeof IntersectionObserver === "undefined") return;

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) handler();
  });
  observer.observe(element);
  return () => observer.disconnect();
});

@Host("li")
class ProductRow extends Component<{
  item: Product;
  onPick: (id: number) => void;
}> {
  pick() {
    this.props.onPick(this.props.item.id);
  }

  render() {
    const p = this.props.item;
    return (
      <button type="button" className="row" onClick={this.pick}>
        <strong>{p.title}</strong>
        <span className="meta">
          {p.brand ?? p.category} · ${String(p.price)} · ★{String(p.rating)}
        </span>
      </button>
    );
  }
}

/** One page of the feed. `as` cannot take a second prop, so the row comes from `render`. */
@Host("ul")
class ProductPageRows extends Component<{
  item: ProductPage;
  onPick: (id: number) => void;
}> {
  render() {
    return list(this.props.item.products, this.renderRow);
  }

  /** A bound method, so the list's `render` is the same function on every pass (RMD020). */
  renderRow(product: Product) {
    return <ProductRow item={product} onPick={this.props.onPick} />;
  }
}

/**
 * The detail panel, keyed on the selected id.
 *
 * Two things worth watching here. Changing `id` changes the KEY, so this shows the new
 * product's state in the same render rather than the previous one's name under the new
 * heading — and coming back to an id already seen is instant, because the entry is still
 * cached. `placeholderData` is what stands in on the very first selection, so the panel does
 * not flash a spinner.
 */
@Host("aside")
class ProductDetail extends Component<{ id: number }> {
  /**
   * A Head BELOW the page's own — the nested case. Selecting a product should take
   * the title; deselecting should hand it back to the products page, not to the
   * layout and not to nothing.
   */
  head = this.use(Head, () => ({
    title: `Product ${this.props.id} — Ramonda SSR`,
    description: `Detail for product ${this.props.id}.`,
  }));
  private queries = this.use(QueryClientAccess);

  /**
   * Every function here is a BOUND METHOD, and the first version of this example was written
   * the other way — with two arrows inline — which is what RMD022 reported the moment the page
   * was served:
   *
   * > A hook's props callback built a new value for the same contents: `ProductDetail → Query`
   * > built a new function for the `fetch` prop on 4 consecutive runs of its props callback.
   *
   * Every prop is a signal, so a fresh function is a *change* every time the callback runs. A
   * bound method has nothing to capture:
   * `loadOne` reads its argument and `skeleton` reads `this.props` when they are CALLED, so the
   * identity never moves. Worth keeping the story rather than quietly writing the fixed version:
   * the diagnostic caught the framework author writing the framework's own example wrong.
   */
  private product = this.use(Query<Product>, (self: ProductDetail) => ({
    key: ["product", self.props.id],
    fetch: self.loadOne,
    staleTime: 60_000,
    placeholderData: self.skeleton,
  }));

  /** The fetcher. `key` comes from the context, so nothing about the component is captured. */
  loadOne({ signal, key }: FetchContext) {
    return loadProduct(key[1] as number, signal);
  }

  /** What the panel shows on the very first selection, instead of flashing a spinner. */
  skeleton(): Product {
    return {
      id: this.props.id,
      title: "Loading…",
      price: 0,
      rating: 0,
      category: "",
      description: "",
    };
  }

  refresh() {
    this.queries.client.invalidate(["product", this.props.id]);
  }

  render() {
    const p = this.product;
    if (p.isError) {
      return (
        <div className="panel error">
          <h3>Could not load product {String(this.props.id)}</h3>
          <p>{(p.error as Error).message}</p>
        </div>
      );
    }

    return (
      <div className={p.isPlaceholder ? "panel dim" : "panel"}>
        <h3>{p.data?.title}</h3>
        <p>{p.data?.description}</p>
        <p className="meta">
          ${String(p.data?.price ?? 0)} · ★{String(p.data?.rating ?? 0)}
          {p.isFetching ? " · refreshing…" : ""}
        </p>
        <button type="button" id="refresh-product" onClick={this.refresh} disabled={p.isPlaceholder}>
          invalidate this product
        </button>
      </div>
    );
  }
}

@Host("div")
export class ProductsPage extends Component {
  head = this.use(Head, () => ({
    title: "Products — Ramonda SSR",
    description: "A paged list, fetched on the server.",
    meta: [{ property: "og:type", content: "product.group" }],
  }));
  @state selected: number | undefined = undefined;

  /**
   * The element the observer watches. Below the last page, so seeing it means "more".
   *
   * A `createRef`, not a callback: `ref` takes anything that can RECEIVE the element, and a
   * `Ref` is what the subscription's `connect` can read `current` off.
   */
  sentinel = createRef<HTMLElement>();

  // Passed directly rather than through a callback: every value in it is a constant or a
  // module-level function, so there is nothing for a per-render rebuild to keep in step.
  private feed = this.use(InfiniteQuery<ProductPage>, {
    key: ["products"],
    initialPageParam: 0,
    loadPage,
    // `undefined` ends the list. `skip + limit` past `total` is exactly that.
    getNextPageParam: nextSkip,
  });

  /**
   * Scrolled into view — ask for one more page. `fetchNextPage` is a no-op when there is no
   * next page or one is already arriving, so this needs no guard of its own.
   */
  @onVisible()
  onSentinel() {
    void this.feed.fetchNextPage();
  }

  select(id: number) {
    this.selected = id;
  }

  renderPage(page: ProductPage) {
    return <ProductPageRows item={page} onPick={this.select} />;
  }

  render() {
    const feed = this.feed;

    return (
      <div className="page products">
        <h2>Products</h2>
        <p className="meta">
          Server-rendered first page, then infinite scroll. {String(feed.pages.length)} page(s) ·{" "}
          {String(feed.pages.reduce((n, page) => n + page.products.length, 0))} of {String(feed.pages[0]?.total ?? 0)}
        </p>

        {feed.isError ? (
          <div className="panel error">
            <h3>Could not load the feed</h3>
            <p>{(feed.error as Error).message}</p>
            <p className="meta">
              With no network this is what the server renders — a failed query is a state, not an exception that aborts
              the page.
            </p>
          </div>
        ) : null}

        <div className="split">
          <div className="feed">
            {list(feed.pages, this.renderPage)}

            {/* The sentinel: scrolling it into view asks for the next page. */}
            <div id="sentinel" ref={this.sentinel} className="sentinel">
              {feed.isFetchingNextPage ? "loading more…" : feed.hasNextPage ? "scroll for more" : "that is all"}
            </div>

            <button
              type="button"
              id="load-more"
              onClick={this.loadMore}
              disabled={!feed.hasNextPage || feed.isFetchingNextPage}
            >
              {feed.isFetchingNextPage ? "loading…" : "load more"}
            </button>
          </div>

          {this.selected === undefined ? (
            <aside className="panel dim">
              <p>Pick a product.</p>
            </aside>
          ) : (
            <ProductDetail id={this.selected} />
          )}
        </div>
      </div>
    );
  }

  loadMore() {
    void this.feed.fetchNextPage();
  }
}
