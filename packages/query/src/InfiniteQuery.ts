import { Hook, StableProps, state } from "@ramonda/core";
import { QueryClientAccess } from "./context";
import { Query, type QueryResult } from "./Query";
import type { FetchContext, InfiniteData, InfiniteQueryProps, QueryKey, QueryStatus } from "./types";

/**
 * A query whose answer arrives a page at a time, held as one cache entry.
 *
 * ```tsx
 * private feed = this.use(InfiniteQuery<Page>, (self: Feed) => ({
 *   key: ["posts", self.props.tag],
 *   initialPageParam: 0,
 *   loadPage: ({ pageParam, signal }) => api.posts(pageParam as number, { signal }),
 *   getNextPageParam: (last) => last.nextCursor,
 * }));
 *
 * // `InfiniteQuery<Page>` names what one page is, which is the type nothing else can
 * // supply: `getNextPageParam` reads a page, but nothing flows between two properties
 * // of the same object literal, so written without the pin its `last` is an implicit
 * // `any` until it is annotated. Naming `Page` once types both callbacks.
 *
 * // render
 * {list(this.feed.pages, PostList)}
 * <button type="button" onClick={this.feed.fetchNextPage} disabled={!this.feed.hasNextPage}>more</button>
 * ```
 *
 * ## Why this composes `Query` instead of extending or duplicating it
 *
 * Everything a paginated query needs beyond pages is what `Query` already is: one
 * entry per key, one request shared by every observer, the mount/focus/reconnect/poll
 * triggers, `invalidate`, the SSR snapshot, the subscription that survives a key
 * change. None of that differs because the data has pages in it.
 *
 * So it is used rather than reimplemented — a hook using a hook, which is what
 * composition is for. The bag handed to it is stable: `key` is a value `Query` declares
 * (`@StableProps`), and `fetch` is a bound method. Extending `Query` would have meant
 * making its `fetch` prop optional to accommodate a subclass that does not take one,
 * which would weaken the type for every ordinary query to serve this one.
 *
 * ## What the pages actually are
 *
 * `data` in the entry is `{ pages, pageParams }` — the whole list under one hash. That
 * is what makes `invalidate(["posts"])` mean "this list is out of date" rather than
 * "page 3 is out of date", and it needs no change to the cache: an entry's data is
 * generic, so a page list is just another shape of answer.
 *
 * **A refresh reloads every page it already has**, in order, using the params it
 * remembers. Reloading only the first would leave pages 2..n from before the change,
 * which is a list that never existed on the server. The cost is honest and bounded by
 * `maxPages` if you set it.
 */
@StableProps("key")
export class InfiniteQuery<TPage, K extends QueryKey = QueryKey> extends Hook<InfiniteQueryProps<TPage, K>> {
  private access = this.use(QueryClientAccess);

  /**
   * The inner query. Its `fetch` is `loadAll`, a bound method, so the bag is stable and
   * the inner query cannot see a changed prop on a render that changed nothing.
   */
  private query = this.use(Query, (self: InfiniteQuery<TPage, K>) => ({
    key: self.props.key,
    fetch: self.loadAll,
    staleTime: self.props.staleTime,
    gcTime: self.props.gcTime,
    retry: self.props.retry,
    retryDelay: self.props.retryDelay,
    enabled: self.props.enabled,
    refetchOnMount: self.props.refetchOnMount,
    refetchOnWindowFocus: self.props.refetchOnWindowFocus,
    refetchOnReconnect: self.props.refetchOnReconnect,
    refetchInterval: self.props.refetchInterval,
  }));

  /**
   * Which end a page is being appended to, while it is being fetched.
   *
   * `@state` rather than a plain field: `isFetchingNextPage` is read in a render, so the
   * render has to re-run when it changes. `undefined` means the fetch in flight (if any)
   * is a whole-list refresh rather than a page being added.
   */
  @state private direction: "next" | "previous" | undefined = undefined;

  /**
   * Loads every page the entry already knows about, in order — the fetcher every
   * ordinary trigger uses.
   *
   * Sequential rather than parallel, and that is not laziness: page N+1's param comes
   * from page N's data, so there is nothing to parallelise. `signal` is forwarded to each
   * page, so an abort stops the whole walk at whichever page is in flight.
   */
  private async loadAll(ctx: FetchContext<K>): Promise<InfiniteData<TPage>> {
    const previous = this.snapshotOf(ctx.key);
    const params = previous && previous.pageParams.length > 0 ? previous.pageParams : [this.props.initialPageParam];

    const pages: TPage[] = [];
    const pageParams: unknown[] = [];

    for (const pageParam of params) {
      const page = await this.props.loadPage({ key: ctx.key, signal: ctx.signal, pageParam });
      pages.push(page);
      pageParams.push(pageParam);
    }

    return { pages, pageParams };
  }

  /**
   * Appends the next page, or prepends the previous one.
   *
   * The merge happens INSIDE the fetcher, which is what keeps this off the cache's
   * hands: the client is asked for an ordinary fetch, and what it stores is the whole
   * new list. Deduplication, abort, retry and the stale-result guard all keep working,
   * because nothing about this is special from the entry's point of view.
   *
   * `pages` is read when the fetch STARTS rather than when the button was clicked, so a
   * refresh that landed in between is built on rather than overwritten.
   */
  private async loadEdge(direction: "next" | "previous", ctx: FetchContext<K>): Promise<InfiniteData<TPage>> {
    const current = this.snapshotOf(ctx.key) ?? { pages: [], pageParams: [] };
    const pageParam = this.edgeParam(direction, current);

    // Nothing to add — the list did not have an edge by the time the fetch ran. Hand back
    // what is there, so the entry is left exactly as it was.
    if (pageParam === undefined || pageParam === null) return current;

    const page = await this.props.loadPage({ key: ctx.key, signal: ctx.signal, pageParam });

    const pages = direction === "next" ? [...current.pages, page] : [page, ...current.pages];
    const pageParams = direction === "next" ? [...current.pageParams, pageParam] : [pageParam, ...current.pageParams];

    return this.trim(direction, { pages, pageParams });
  }

  /**
   * Drops pages from the far end once `maxPages` is reached, so an endlessly scrolled
   * list cannot grow without bound. Off unless asked for.
   */
  private trim(direction: "next" | "previous", data: InfiniteData<TPage>): InfiniteData<TPage> {
    const max = this.props.maxPages;
    if (max === undefined || max <= 0 || data.pages.length <= max) return data;

    const from = direction === "next" ? data.pages.length - max : 0;
    return {
      pages: data.pages.slice(from, from + max),
      pageParams: data.pageParams.slice(from, from + max),
    };
  }

  /** The param for one more page at the given end, or `undefined` when there is none. */
  private edgeParam(direction: "next" | "previous", data: InfiniteData<TPage> | undefined): unknown {
    if (!data || data.pages.length === 0) {
      // Nothing loaded yet: the only page that can be asked for is the first one.
      return direction === "next" ? this.props.initialPageParam : undefined;
    }

    if (direction === "next") {
      const lastIndex = data.pages.length - 1;
      return this.props.getNextPageParam(
        data.pages[lastIndex]!,
        data.pages,
        data.pageParams[lastIndex],
        data.pageParams,
      );
    }

    const getPrevious = this.props.getPreviousPageParam;
    if (getPrevious === undefined) return undefined;
    return getPrevious(data.pages[0]!, data.pages, data.pageParams[0], data.pageParams);
  }

  /** What is in the cache for a key right now, read without registering an observer. */
  private snapshotOf(key: K): InfiniteData<TPage> | undefined {
    return this.access.client.peek<InfiniteData<TPage>>(key)?.data;
  }

  private async fetchEdge(direction: "next" | "previous"): Promise<void> {
    if (this.props.enabled === false) return;
    if (this.direction !== undefined) return; // already adding a page

    this.direction = direction;
    try {
      await this.access.client.fetch<InfiniteData<TPage>>(
        this.props.key,
        (ctx) => this.loadEdge(direction, ctx as FetchContext<K>),
        {
          staleTime: this.props.staleTime,
          gcTime: this.props.gcTime,
          retry: this.props.retry,
          retryDelay: this.props.retryDelay,
        },
      );
    } finally {
      this.direction = undefined;
    }
  }

  /** The pages, oldest first. Empty until the first one arrives. */
  get pages(): readonly TPage[] {
    return this.query.data?.pages ?? EMPTY;
  }

  /** The params each page was loaded with, in the same order as `pages`. */
  get pageParams(): readonly unknown[] {
    return this.query.data?.pageParams ?? EMPTY;
  }

  /** Whether `getNextPageParam` has something to ask for. */
  get hasNextPage(): boolean {
    const param = this.edgeParam("next", this.query.data);
    return param !== undefined && param !== null;
  }

  /** Whether `getPreviousPageParam` was given and has something to ask for. */
  get hasPreviousPage(): boolean {
    const param = this.edgeParam("previous", this.query.data);
    return param !== undefined && param !== null;
  }

  get isFetchingNextPage(): boolean {
    return this.direction === "next";
  }

  get isFetchingPreviousPage(): boolean {
    return this.direction === "previous";
  }

  /** Nothing to show yet — no page has arrived. */
  get isPending(): boolean {
    return this.query.isPending;
  }

  get isSuccess(): boolean {
    return this.query.isSuccess;
  }

  get isError(): boolean {
    return this.query.isError;
  }

  get error(): Error | undefined {
    return this.query.error;
  }

  /**
   * A request is in flight — including one that is adding a page. `isFetchingNextPage`
   * is the narrower question, and the one a "load more" button should ask.
   */
  get isFetching(): boolean {
    return this.query.isFetching;
  }

  get status(): QueryStatus {
    return this.query.status;
  }

  get updatedAt(): number {
    return this.query.updatedAt;
  }

  get isRestored(): boolean {
    return this.query.isRestored;
  }

  /** The whole list as a discriminated union, for narrowing without a `!`. */
  get result(): QueryResult<InfiniteData<TPage>> {
    return this.query.result;
  }

  /** Adds one page at the end. A no-op when there is no next page, or one is arriving. */
  fetchNextPage(): Promise<void> {
    return this.fetchEdge("next");
  }

  /** Adds one page at the start, for a list that grows both ways. */
  fetchPreviousPage(): Promise<void> {
    return this.fetchEdge("previous");
  }

  /**
   * Reloads every page it has, in order. What `invalidate` triggers too — see the note
   * on the class for why the whole list rather than the first page.
   */
  refetch(): Promise<void> {
    return this.query.refetch();
  }
}

/** One array for "no pages", so a render that has none does not rebuild one (RMD020). */
const EMPTY: readonly never[] = [];
