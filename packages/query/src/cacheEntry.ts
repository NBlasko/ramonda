import type { FetchStatus, QueryKey, QueryObserver, QueryStatus } from "./types";

/**
 * One query's slot in the cache: what is known, whether a request is in flight,
 * and who is watching.
 *
 * Shared by every observer of the same key — that sharing IS the cache. Three
 * components asking for `["user", 7]` get one entry, so they make one request and
 * cannot disagree about what the answer was.
 */
export interface QueryEntry<TData = unknown> {
  /** The hash this entry is indexed by, kept on the entry so a sweep can delete it. */
  readonly hash: string;
  /**
   * The key as it was last passed. Kept so `invalidate(["user"])` can match by
   * prefix — the hash alone cannot be taken apart again.
   */
  key: QueryKey;
  status: QueryStatus;
  fetchStatus: FetchStatus;
  data: TData | undefined;
  /** Whatever the fetcher rejected with, untouched. Serialized only on the way out. */
  error: unknown;
  /** When data last arrived. 0 means never. */
  updatedAt: number;
  /** When the current error arrived. 0 means there has never been one. */
  errorUpdatedAt: number;
  /** Consecutive failures for the fetch in progress; reset by success. */
  failureCount: number;
  /**
   * The in-flight fetch, and what identifies it.
   *
   * `promise` is what makes two observers share one request rather than racing:
   * the second one joins it. `fetchId` is what makes the RESULT safe to apply —
   * a fetch that was superseded (its key changed, it was aborted and restarted)
   * must not write over the newer one's data when it finally lands. Compared on
   * settle; a mismatch means "this answer is for a question nobody is asking now".
   */
  promise?: Promise<void>;
  fetchId: number;
  controller?: AbortController;
  /**
   * Everyone to wake when this entry changes. A `Set` of callbacks rather than of
   * hooks: the cache has no business knowing what a component is, and a callback
   * is what both an observer and a test can supply.
   */
  observers: Set<QueryObserver>;
  /**
   * When the last observer left, by the client's clock. `undefined` while
   * somebody is watching.
   *
   * This is how garbage collection works here: a timestamp checked on the way
   * past, not a `setTimeout`. Two measured reasons, pointing the same way.
   *
   * 1. On the CLIENT, the timer would be created inside `@destroy` (the last
   *    observer unsubscribing is a component being torn down), and core's DEV
   *    timer guard attributes any timer started during a lifecycle to that
   *    component — then reports whatever is still ticking at the END of the same
   *    teardown as a leak (RMD006, see core's lifecycleMenagement.ts). Every
   *    unmount of the last observer would file a false leak report.
   * 2. On the SERVER, a pending timer is a live handle on the event loop for as
   *    long as `gcTime` says, per request. Lazy expiry costs nothing after the
   *    response is sent, because nothing is scheduled.
   */
  unusedSince?: number;
  /**
   * The `gcTime` the last fetch was run with, so a sweep can apply the option the
   * query itself declared rather than the client's default.
   *
   * On the entry rather than looked up per sweep because by the time it matters
   * there is no observer left to ask — the query whose options they were has
   * unmounted, which is precisely why the entry is a candidate for collection.
   */
  gcTime?: number;
  /**
   * Set when this entry's data came from a server render rather than from a fetch
   * on this side.
   *
   * Read by `refetchOnMount`, and the reason it exists: `updatedAt` cannot be
   * compared across the boundary. The server stamps it with the SERVER's clock,
   * and two machines' clocks differ by seconds routinely — so a restored entry
   * can look either fresher or staler than it is. `hydrate` therefore restamps
   * `updatedAt` with the client's own clock (the data is as fresh as the document
   * that carried it) and sets this flag, so anything that wants to treat "came
   * from the server" differently can, without arithmetic on two clocks.
   */
  restored?: boolean;
}

export function createEntry<TData>(hash: string, key: QueryKey, now: number): QueryEntry<TData> {
  return {
    hash,
    key,
    status: "pending",
    fetchStatus: "idle",
    data: undefined,
    error: undefined,
    updatedAt: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    fetchId: 0,
    observers: new Set(),
    unusedSince: now,
  };
}

/**
 * Whether the data is old enough to be worth replacing.
 *
 * An entry with no data is always stale — there is nothing to be fresh. That
 * matters for `staleTime: Infinity`, which means "never refetch what you have",
 * not "never fetch at all".
 */
export function isStale(entry: QueryEntry, staleTime: number, now: number): boolean {
  if (entry.updatedAt === 0) return true;
  if (staleTime === Number.POSITIVE_INFINITY) return false;
  return now - entry.updatedAt >= staleTime;
}
