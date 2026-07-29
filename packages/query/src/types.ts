/**
 * A query's identity, as data.
 *
 * An array rather than a string, so a key can be built from parts a component
 * already has — `["user", id]`, `["posts", { page, tag }]` — and so a PREFIX of
 * it can be invalidated without string surgery. It is hashed for lookup (see
 * `hashKey`), and the hash has to come out identical on the server and on the
 * client, which is what constrains what may go in one.
 */
export type QueryKey = readonly unknown[];

/**
 * What the query knows about its DATA. Deliberately separate from whether a
 * request is in flight, because the two are independent: a query that already
 * has data and is refetching is `status: "success"` with `fetchStatus:
 * "fetching"`, and rendering it as "loading" would blank a screen that has
 * something to show.
 */
export type QueryStatus = "pending" | "success" | "error";

/** Whether a request is in flight right now. */
export type FetchStatus = "idle" | "fetching";

/**
 * What a fetcher is handed.
 *
 * `signal` is not optional and not a convenience: a query whose key changes
 * (a new `id`, a new page) abandons the previous request, and without passing
 * this to `fetch` the abandoned response still arrives and still costs the
 * network. Forward it — `fetch(url, { signal })`.
 *
 * `key` is passed too, so one fetcher can serve a family of keys instead of
 * closing over the component's props.
 */
export interface FetchContext<K extends QueryKey = QueryKey> {
  key: K;
  signal: AbortSignal;
}

/** The function that actually gets the data. */
export type QueryFetcher<TData, K extends QueryKey = QueryKey> = (ctx: FetchContext<K>) => Promise<TData>;

/**
 * How many times to try again after a failure, and how long to wait.
 *
 * A number is a count; a predicate decides per failure, which is what an HTTP
 * client wants — a 404 will never succeed on the third attempt, a 503 might.
 */
export type RetryPolicy = number | ((failureCount: number, error: unknown) => boolean);

/** Milliseconds before attempt `failureCount + 1`. */
export type RetryDelayPolicy = number | ((failureCount: number, error: unknown) => number);

/**
 * The knobs that can be set per query and defaulted per client.
 *
 * Kept in one interface rather than two so the defaults and the overrides cannot
 * drift apart: a query's effective options are `{ ...clientDefaults, ...own }`,
 * and both sides are typed by this.
 */
export interface QueryBehaviour {
  /**
   * How long data counts as fresh, in milliseconds. While fresh, mounting
   * another observer of the same key does NOT refetch — it renders what is
   * already there.
   *
   * Defaults to 0, which means "stale the moment it arrives": correct for data
   * that changes under you, and the reason a page that mounts three observers
   * of one key still makes exactly one request (they are deduped) but a
   * navigation back to it makes another.
   */
  staleTime?: number;
  /**
   * How long an entry with no observers is kept before it is dropped, in
   * milliseconds. Defaults to five minutes.
   *
   * This is what makes going back to a page instant: the data is still there,
   * shown immediately, and refreshed in the background if it is stale.
   */
  gcTime?: number;
  /** Retries after a failed fetch. Defaults to 3 attempts after the first. */
  retry?: RetryPolicy;
  /**
   * Delay before a retry. Defaults to exponential backoff capped at 30s —
   * `1s, 2s, 4s, …` — because a client that retries a struggling server
   * immediately is part of the problem.
   */
  retryDelay?: RetryDelayPolicy;
}

/**
 * Why an observer is being woken.
 *
 * The cache does not refetch on an observer's behalf, and this is what lets it not
 * have to. `"invalidated"` says "what you have is no longer trustworthy"; the
 * observer answers with a refetch **using the fetcher it holds right now**, which
 * is the only correct one — it closes over the component's current props.
 *
 * The alternative was storing each entry's fetcher in the cache so `invalidate`
 * could call it. That puts a closure over component props into a structure that
 * outlives the component (an entry survives its last observer by `gcTime`), which
 * is how a cache ends up refetching with a stale `id` — and it is the shape this
 * framework rejects everywhere else: state on the tree, not in a module.
 *
 * An entry with no observers is only marked; it refetches when something mounts and
 * asks, which is also the first moment anybody could notice.
 *
 * `"removed"` is different from both: the entry an observer was watching is GONE, so
 * there is nothing to update and nothing to refetch on. An observer answers it by
 * subscribing again — `getEntry` builds a fresh entry — and then fetching. Without
 * it, `client.remove(["user"])` after a logout left every live observer attached to a
 * discarded entry, never notified again, rendering the departed user's data until
 * something happened to remount the component.
 */
export type QueryEvent = "updated" | "invalidated" | "removed";

/** Woken on every change to one entry. */
export type QueryObserver = (event: QueryEvent) => void;

/** Everything needed to run one fetch, with no defaults left to resolve. */
export interface ResolvedFetchOptions {
  staleTime: number;
  gcTime: number;
  retry: RetryPolicy;
  retryDelay: RetryDelayPolicy;
}

/**
 * When a query with data already in the cache should ask again anyway.
 *
 * - `"stale"` (default) — only if `staleTime` has passed.
 * - `"always"` — every time an observer mounts, fresh or not.
 * - `false` — never on mount; the data is refreshed by an `invalidate`, a
 *   `refetch`, or one of the other triggers.
 *
 * A query with NO data fetches under all three: this decides whether to REFRESH,
 * and there is nothing to refresh yet.
 */
export type RefetchOnMount = "stale" | "always" | false;

/**
 * The triggers, which belong to an observer rather than to the cache — two
 * components watching one key may reasonably disagree about whether a tab regaining
 * focus should refresh it, while they cannot disagree about what the data is.
 *
 * Kept in their own interface for exactly that reason: `QueryClient` never reads
 * them, so it cannot come to depend on something that is not its business.
 */
export interface ObserverBehaviour {
  /** See `RefetchOnMount`. Defaults to `"stale"`. */
  refetchOnMount?: RefetchOnMount;
  /**
   * Refresh stale data when the window regains focus. Defaults to `true`.
   *
   * Only when it is STALE: a tab switched away from and back within `staleTime`
   * fetches nothing, so the default is not a request per alt-tab.
   */
  refetchOnWindowFocus?: boolean;
  /** Refresh stale data when the browser comes back online. Defaults to `true`. */
  refetchOnReconnect?: boolean;
  /**
   * Poll every N milliseconds. Off by default.
   *
   * Unlike the other triggers this refetches whether or not the data is stale —
   * an interval IS the staleness policy for a query that has one.
   */
  refetchInterval?: number;
}

/** What a provider takes, and what a single query may override. */
export type QueryDefaults = QueryBehaviour & ObserverBehaviour;

/** Observer options with no defaults left to resolve. */
export interface ResolvedObserverOptions {
  refetchOnMount: RefetchOnMount;
  refetchOnWindowFocus: boolean;
  refetchOnReconnect: boolean;
  refetchInterval: number;
}

/**
 * What one page load is told: the key, the abort signal, and which page is being asked
 * for. `pageParam` is whatever `getNextPageParam` returned (or `initialPageParam` for the
 * first) — a cursor, an offset, a URL, anything.
 */
export interface PageContext<K extends QueryKey = QueryKey> extends FetchContext<K> {
  pageParam: unknown;
}

/**
 * A paginated answer, held as ONE cache entry: the pages in order, and the param each was
 * loaded with.
 *
 * The params are kept because a refresh has to reload the pages it already has — page N+1's
 * cursor comes out of page N's data, so without the params there would be no way to reload
 * page 3 without walking pages 1 and 2 again.
 */
export interface InfiniteData<TPage> {
  pages: TPage[];
  pageParams: unknown[];
}

/** What an `InfiniteQuery` takes. */
export interface InfiniteQueryProps<TPage, K extends QueryKey = QueryKey> extends QueryBehaviour, ObserverBehaviour {
  key: K;
  /** Loads one page. Forward `ctx.signal` so an abandoned list stops fetching. */
  loadPage: (context: PageContext<K>) => Promise<TPage>;
  /** The param for the first page — an offset of 0, a null cursor, page 1. */
  initialPageParam: unknown;
  /**
   * The param for one more page, or `undefined` when the list has ended. Returning
   * `undefined` is what makes `hasNextPage` false, so it is the end-of-list signal.
   */
  getNextPageParam: (lastPage: TPage, pages: TPage[], lastPageParam: unknown, pageParams: unknown[]) => unknown;
  /** The same, backwards. Omit it and `hasPreviousPage` is always false. */
  getPreviousPageParam?: (firstPage: TPage, pages: TPage[], firstPageParam: unknown, pageParams: unknown[]) => unknown;
  /**
   * Keep at most this many pages, dropping from the far end. Off by default — a list that
   * is scrolled forever otherwise grows forever.
   */
  maxPages?: number;
  /** Fetch nothing while this is false, and stay `pending`. */
  enabled?: boolean;
}
