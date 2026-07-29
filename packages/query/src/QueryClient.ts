import { createEntry, isStale, type QueryEntry } from "./cacheEntry";
import { deserializeError, serializeError, type SerializedError } from "./errors";
import { hashKey, keyStartsWith } from "./hashKey";
import { replaceEqualDeep } from "./structuralSharing";
import type {
  ObserverBehaviour,
  QueryBehaviour,
  QueryDefaults,
  QueryEvent,
  QueryFetcher,
  QueryKey,
  QueryObserver,
  ResolvedFetchOptions,
  ResolvedObserverOptions,
  RetryDelayPolicy,
  RetryPolicy,
} from "./types";

export interface QueryClientOptions {
  /** Applied to every query that does not set its own. */
  defaults?: QueryDefaults;
  /**
   * The clock. Defaults to `Date.now`.
   *
   * A seam for tests, and only for tests: staleness is arithmetic on timestamps,
   * and a suite that has to `vi.advanceTimersByTime` to check "is this five
   * minutes old" ends up testing the fake timer. Passing a counter here tests the
   * arithmetic.
   */
  now?: () => number;
}

/** One query as it crosses the server→client boundary. */
export interface DehydratedQuery {
  key: QueryKey;
  data?: unknown;
  error?: SerializedError;
  /** The server's clock, kept for the record; `hydrate` does not trust it. See `restored`. */
  updatedAt: number;
}

export interface DehydratedState {
  queries: DehydratedQuery[];
}

const DEFAULT_STALE_TIME = 0;
const DEFAULT_GC_TIME = 5 * 60 * 1000;
const DEFAULT_RETRY = 3;
const MAX_RETRY_DELAY = 30_000;

/** `1s, 2s, 4s, … 30s`. A client that retries a struggling server at once is part of the problem. */
function defaultRetryDelay(failureCount: number): number {
  return Math.min(1000 * 2 ** (failureCount - 1), MAX_RETRY_DELAY);
}

/**
 * The cache, and the only thing that talks to a fetcher.
 *
 * **One per render tree, never a module-level singleton.** Query data is
 * per-request state — whose user, whose permissions — and a module is shared by
 * every request a server handles at once, so a global cache would serve one
 * visitor's data to another. Intermittent, invisible in development where you test
 * one request at a time, and visible only under real traffic. The framework takes
 * this position everywhere (see the router's store, and `why/no-globals`); this is
 * the same reasoning applied to the thing where the stakes are highest.
 *
 * So a client is created by `QueryClientProvider` and reaches components through
 * context. It is a plain class with no reactive fields of its own: waking a
 * component is the observer's job, through the callbacks registered here.
 */
export class QueryClient {
  private readonly entries = new Map<string, QueryEntry>();
  private readonly defaults: ResolvedFetchOptions;
  /**
   * The observer-level defaults, resolved once.
   *
   * Held here even though the client never acts on them, because a provider is
   * where a tree says "no focus refetching in this app" and an observer needs one
   * place to ask. `resolveObserver` is that place; nothing else in this class
   * reads them.
   */
  private readonly observerDefaults: ResolvedObserverOptions;
  private readonly now: () => number;

  constructor(options: QueryClientOptions = {}) {
    const given = options.defaults ?? {};
    this.defaults = {
      staleTime: given.staleTime ?? DEFAULT_STALE_TIME,
      gcTime: given.gcTime ?? DEFAULT_GC_TIME,
      retry: given.retry ?? DEFAULT_RETRY,
      retryDelay: given.retryDelay ?? defaultRetryDelay,
      // On by default. Measured against the render it prevents: 28 µs of comparison versus
      // 5.4 ms of commit for ten rows, 811 µs versus 272 ms for a thousand — see
      // structuralSharing.ts for the table and for what bounds the walk.
      structuralSharing: given.structuralSharing ?? true,
    };
    this.observerDefaults = {
      refetchOnMount: given.refetchOnMount ?? "stale",
      refetchOnWindowFocus: given.refetchOnWindowFocus ?? true,
      refetchOnReconnect: given.refetchOnReconnect ?? true,
      refetchInterval: given.refetchInterval ?? 0,
    };
    this.now = options.now ?? Date.now;
  }

  /** Resolves a query's options against this client's defaults. */
  resolve(options?: QueryBehaviour): ResolvedFetchOptions {
    if (!options) return this.defaults;
    return {
      staleTime: options.staleTime ?? this.defaults.staleTime,
      gcTime: options.gcTime ?? this.defaults.gcTime,
      retry: options.retry ?? this.defaults.retry,
      retryDelay: options.retryDelay ?? this.defaults.retryDelay,
      structuralSharing: options.structuralSharing ?? this.defaults.structuralSharing,
    };
  }

  /**
   * Applies structural sharing with the client's default, for writes that carry no per-query
   * options of their own (`setData`). A query's own `structuralSharing: false` is honoured on
   * the fetch path, where the options are in hand.
   */
  private share<TData>(previous: TData | undefined, next: TData): TData {
    return this.defaults.structuralSharing ? replaceEqualDeep(previous, next) : next;
  }

  /**
   * Writes data for a key **only if nothing is there yet** — what `initialData` needs.
   *
   * Distinct from `setData`, and the difference is the point: `setData` is an assertion ("this
   * is the value now") and cancels a fetch in flight, while this is an offer ("use this if you
   * have nothing"). An answer that was fetched, or restored from a server render, outranks one
   * the app had lying around — and a second observer arriving with its own `initialData` must
   * not overwrite the first's.
   *
   * `updatedAt` is honoured because seeded data usually is not new. Without it a value from
   * `localStorage` would look freshly fetched, and a long `staleTime` would keep it.
   */
  seed<TData>(key: QueryKey, data: TData, updatedAt?: number): void {
    const entry = this.getEntry<TData>(key);
    if (entry.status !== "pending") return;

    entry.data = data;
    entry.status = "success";
    entry.error = undefined;
    entry.updatedAt = updatedAt ?? this.now();
    entry.failureCount = 0;
    entry.restored = false;
    this.notify(entry, "updated");
  }

  /** Resolves an observer's triggers against this client's defaults. */
  resolveObserver(options?: ObserverBehaviour): ResolvedObserverOptions {
    if (!options) return this.observerDefaults;
    return {
      refetchOnMount: options.refetchOnMount ?? this.observerDefaults.refetchOnMount,
      refetchOnWindowFocus: options.refetchOnWindowFocus ?? this.observerDefaults.refetchOnWindowFocus,
      refetchOnReconnect: options.refetchOnReconnect ?? this.observerDefaults.refetchOnReconnect,
      refetchInterval: options.refetchInterval ?? this.observerDefaults.refetchInterval,
    };
  }

  /** The entry for a key, created empty if this is the first time it is asked for. */
  getEntry<TData = unknown>(key: QueryKey): QueryEntry<TData> {
    const hash = hashKey(key);
    let entry = this.entries.get(hash);
    if (!entry) {
      entry = createEntry(hash, key, this.now());
      this.entries.set(hash, entry);
    } else {
      // The hash matched, so this key is equal to the stored one — but not
      // necessarily the same array. Keeping the newest means prefix matching in
      // `invalidate` compares against a key that is still reachable, rather than
      // one captured by a component that has since unmounted.
      entry.key = key;
    }
    return entry as QueryEntry<TData>;
  }

  /** The entry for a key if it exists, without creating one. */
  peek<TData = unknown>(key: QueryKey): QueryEntry<TData> | undefined {
    return this.entries.get(hashKey(key)) as QueryEntry<TData> | undefined;
  }

  /** Every entry currently held, for a devtools panel or a test. */
  all(): readonly QueryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Registers an observer and hands back the way to remove it.
   *
   * The return value is the unsubscribe, in the shape core's subscription decorators and
   * `createSubscriptionDecorator` already take as a cleanup — so an observer is
   * one decorator away from being torn down correctly, with nothing to remember.
   */
  subscribe(key: QueryKey, observer: QueryObserver): () => void {
    const entry = this.getEntry(key);
    entry.observers.add(observer);
    entry.unusedSince = undefined;

    // Swept here as well as on the way out, because leaving is not a moment the
    // cache can count on: the last observer of a page unsubscribes and then
    // nothing happens for minutes, so a sweep only on unsubscribe would find
    // every expired entry one tick too early and never look again. This entry is
    // safe from its own sweep — the observer above cleared `unusedSince`.
    this.sweep();

    let removed = false;
    return () => {
      // Idempotent: a cleanup can run twice (an effect re-running, then teardown),
      // and the second call must not un-count an observer that never left.
      if (removed) return;
      removed = true;

      entry.observers.delete(observer);
      if (entry.observers.size > 0) return;

      entry.unusedSince = this.now();
      // Nobody is waiting for this answer any more. Aborting is not an
      // optimisation — the response would arrive, be applied to an entry no one
      // reads, and cost the network on a page the user has already left.
      this.cancel(entry.key);
      this.sweep();
    };
  }

  /**
   * Fetches, unless the same fetch is already in flight — in which case the
   * caller joins it. That join is what makes three components asking for
   * `["user", 7]` in one render produce one request.
   *
   * The returned promise settles when the data (or the failure) has been applied,
   * and it never rejects: a failed query is a state to render, not an exception
   * for whoever happened to trigger it. A component's `@mount` can therefore
   * return it, which is what a server render awaits before serializing.
   */
  fetch<TData>(key: QueryKey, fetcher: QueryFetcher<TData>, options?: QueryBehaviour): Promise<void> {
    const entry = this.getEntry<TData>(key);
    if (entry.promise) return entry.promise;

    const resolved = this.resolve(options);
    entry.gcTime = resolved.gcTime;

    const fetchId = ++entry.fetchId;
    const controller = new AbortController();
    entry.controller = controller;
    entry.fetchStatus = "fetching";
    entry.failureCount = 0;
    this.notify(entry, "updated");

    const promise = this.run(entry, fetcher, resolved, fetchId, controller);
    entry.promise = promise;
    return promise;
  }

  /**
   * Fetches only if what is there is stale, and without registering an observer.
   *
   * This is the tool for flattening a waterfall: a route's parent loads what the
   * page needs in ONE place, and the children below it find their data already in
   * the cache instead of each fetching what the one above it just learned. A
   * server render gives up after ten sequential rounds of async work for exactly
   * that shape (core's `renderToString`), and this is how a page stays under it.
   */
  prefetch<TData>(key: QueryKey, fetcher: QueryFetcher<TData>, options?: QueryBehaviour): Promise<void> {
    const resolved = this.resolve(options);
    const entry = this.getEntry<TData>(key);
    if (!isStale(entry, resolved.staleTime, this.now())) return Promise.resolve();
    return this.fetch(key, fetcher, options);
  }

  /**
   * Writes data straight into the cache, as the newest thing known about this key.
   *
   * **A fetch in flight is abandoned.** The write is newer information than a
   * request that was made before it, so letting the response land afterwards
   * would undo an optimistic update with the value it was replacing —
   * intermittently, depending on which won the race. Same principle as the
   * router's updaters: one channel, and the freshest write wins.
   */
  setData<TData>(key: QueryKey, next: TData | ((previous: TData | undefined) => TData)): void {
    const entry = this.getEntry<TData>(key);
    this.cancel(key);

    const value = typeof next === "function" ? (next as (previous: TData | undefined) => TData)(entry.data) : next;

    // An explicit write goes through the same sharing as a fetch: an optimistic update that
    // recomputes an equal list should not re-render every row of it.
    entry.data = this.share(entry.data, value);
    entry.status = "success";
    entry.error = undefined;
    entry.updatedAt = this.now();
    entry.failureCount = 0;
    entry.restored = false;
    this.notify(entry, "updated");
  }

  /**
   * Marks everything under `prefix` as stale, and asks whoever is watching to
   * refetch. No prefix means every query.
   *
   * Matching is by prefix and by VALUE — `invalidate(["user"])` reaches
   * `["user", 1]` and `["user", 2]`, and `invalidate(["posts", { page: 1 }])`
   * finds the entry a component created with a freshly built object literal.
   */
  invalidate(prefix?: QueryKey): void {
    for (const entry of this.entries.values()) {
      if (prefix && !keyStartsWith(entry.key, prefix)) continue;
      // Stale rather than empty: the data stays on screen while the refetch runs,
      // which is the whole difference between a refresh and a flicker.
      entry.updatedAt = 0;
      this.notify(entry, "invalidated");
    }
  }

  /** Aborts the fetch in flight for a key, if there is one. Leaves the data alone. */
  cancel(key: QueryKey): void {
    const entry = this.peek(key);
    if (!entry?.promise) return;

    // Bumped BEFORE the abort, so the rejection the fetcher is about to produce
    // is recognised as superseded and never applied. Without this the abort
    // itself would be committed as the query's error.
    entry.fetchId++;
    entry.controller?.abort();
    entry.controller = undefined;
    entry.promise = undefined;
    entry.fetchStatus = "idle";
  }

  /**
   * Drops everything under `prefix` (or everything), aborting whatever is in flight.
   *
   * The tool for a logout: the next visitor to this tab must not see the last one's
   * data, and marking it stale is not enough — stale data is still shown while it
   * refreshes.
   *
   * Observers are told, and that is not a courtesy. An entry they were watching is
   * gone, so their subscription now points at a discarded object: without the
   * `"removed"` event they would never be notified again and would keep rendering
   * what was just deleted. Notified AFTER the delete, so re-subscribing lands on a
   * fresh entry rather than the one on its way out.
   */
  remove(prefix?: QueryKey): void {
    const removed: QueryEntry[] = [];

    for (const entry of Array.from(this.entries.values())) {
      if (prefix && !keyStartsWith(entry.key, prefix)) continue;
      this.cancel(entry.key);
      this.entries.delete(entry.hash);
      removed.push(entry);
    }

    for (const entry of removed) {
      this.notify(entry, "removed");
    }
  }

  /**
   * Deletes entries nobody has watched for longer than their `gcTime`.
   *
   * Called on the way past — when an observer arrives or leaves — rather than from
   * a timer. See `unusedSince` on the entry for the two measurements behind that.
   */
  sweep(): void {
    const now = this.now();
    for (const entry of Array.from(this.entries.values())) {
      if (entry.unusedSince === undefined || entry.promise) continue;
      const gcTime = entry.gcTime ?? this.defaults.gcTime;
      if (gcTime !== Number.POSITIVE_INFINITY && now - entry.unusedSince >= gcTime) {
        this.entries.delete(entry.hash);
      }
    }
  }

  /**
   * Everything worth carrying to the client: what succeeded, and what failed.
   *
   * A query still pending is left out. Its promise cannot cross the wire, and a
   * "pending" entry restored on the client would only say what an empty cache
   * already says — while costing bytes in every response.
   */
  dehydrate(): DehydratedState {
    const queries: DehydratedQuery[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "success") {
        queries.push({ key: entry.key, data: entry.data, updatedAt: entry.updatedAt });
      } else if (entry.status === "error") {
        queries.push({ key: entry.key, error: serializeError(entry.error), updatedAt: entry.errorUpdatedAt });
      }
    }
    return { queries };
  }

  /**
   * Seeds the cache from a server render.
   *
   * **`updatedAt` is restamped with this side's clock.** The server's timestamp
   * comes from another machine, and two clocks differ by seconds routinely — so
   * comparing it against `Date.now()` here would make data look either fresher or
   * staler than it is, at random. The data is exactly as fresh as the document
   * that carried it, which is to say: as of now. `restored` records where it came
   * from, for anything that wants to treat it differently.
   *
   * Existing data is not overwritten if it is newer than the snapshot — a client
   * that already fetched something itself knows better than the HTML does.
   *
   * `silent` skips waking the observers, and exists for the one caller that must:
   * a `Query` seeding its own restored snapshot **during a render**. Waking an
   * observer means writing its `version`, and a state write during a render is
   * what core reports as RMD001. Nothing is missed by staying quiet there —
   * hydration renders every component in the tree anyway, so each observer reads
   * the seeded entry on its own way past.
   */
  hydrate(state: DehydratedState, options: { silent?: boolean } = {}): void {
    const now = this.now();
    for (const query of state.queries) {
      const entry = this.getEntry(query.key);
      if (entry.updatedAt > 0 || entry.promise) continue;

      if (query.error) {
        entry.status = "error";
        entry.error = deserializeError(query.error);
        entry.errorUpdatedAt = now;
      } else {
        entry.status = "success";
        // Hydration has nothing to share with — there is no previous value on this side — so
        // this is a plain assignment on purpose.
        entry.data = query.data;
        entry.updatedAt = now;
      }
      entry.restored = true;
      if (!options.silent) this.notify(entry, "updated");
    }
  }

  /** Whether a key's data is old enough to be worth replacing. */
  isStale(key: QueryKey, staleTime: number): boolean {
    const entry = this.peek(key);
    if (!entry) return true;
    return isStale(entry, staleTime, this.now());
  }

  private notify(entry: QueryEntry, event: QueryEvent): void {
    // Snapshotted: an observer may unsubscribe while being notified (a refetch on
    // "invalidated" can tear a component down), and iterating the live Set then
    // skips whoever came after it.
    for (const observer of Array.from(entry.observers)) {
      observer(event);
    }
  }

  /**
   * One fetch, with its retries.
   *
   * Every path out checks `fetchId` first. A fetch is superseded when its key
   * changed under it, when `setData` wrote a newer value, or when the last
   * observer left — and in all three cases the answer, whenever it arrives, is to
   * a question nobody is asking. Applying it would resurrect abandoned data over
   * current data, which is the bug this counter exists to make impossible rather
   * than unlikely.
   */
  private async run<TData>(
    entry: QueryEntry<TData>,
    fetcher: QueryFetcher<TData>,
    options: ResolvedFetchOptions,
    fetchId: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      for (;;) {
        try {
          const data = await fetcher({ key: entry.key, signal: controller.signal });
          if (entry.fetchId !== fetchId) return;

          entry.data = options.structuralSharing ? replaceEqualDeep(entry.data, data) : data;
          entry.status = "success";
          entry.error = undefined;
          entry.updatedAt = this.now();
          entry.errorUpdatedAt = 0;
          entry.failureCount = 0;
          entry.restored = false;
          entry.fetchStatus = "idle";
          this.notify(entry, "updated");
          return;
        } catch (error) {
          if (entry.fetchId !== fetchId || controller.signal.aborted) return;

          entry.failureCount++;

          if (!shouldRetry(options.retry, entry.failureCount, error)) {
            // The data is KEPT. A failed refetch does not mean what was on screen
            // became wrong — it means it could not be confirmed — and blanking a
            // page to prove the network failed serves nobody. So `status` becomes
            // "error" while `data` stays: the observer can render the failure
            // beside the last known good value, or ignore one of them.
            entry.status = "error";
            entry.error = error;
            entry.errorUpdatedAt = this.now();
            entry.fetchStatus = "idle";
            this.notify(entry, "updated");
            return;
          }

          // Woken between attempts too: `failureCount` is part of what an observer
          // renders ("retrying, attempt 2"), and without this it would jump from 0
          // to its final value with nothing in between.
          this.notify(entry, "updated");

          const delayed = await sleep(resolveDelay(options.retryDelay, entry.failureCount, error), controller.signal);
          if (!delayed || entry.fetchId !== fetchId) return;
        }
      }
    } finally {
      // Only if this is still the current fetch: a superseding one has already
      // installed its own promise and controller, and clearing them here would
      // strand it — `fetch` would see no promise in flight and start a third.
      if (entry.fetchId === fetchId) {
        entry.promise = undefined;
        entry.controller = undefined;
      }
    }
  }
}

function shouldRetry(policy: RetryPolicy, failureCount: number, error: unknown): boolean {
  if (typeof policy === "function") return policy(failureCount, error);
  return failureCount <= policy;
}

function resolveDelay(policy: RetryDelayPolicy, failureCount: number, error: unknown): number {
  return typeof policy === "function" ? policy(failureCount, error) : policy;
}

/**
 * Waits, or gives up early if the fetch is aborted while waiting. Resolves `true`
 * when the delay elapsed and `false` when it was cut short.
 *
 * A plain `setTimeout` would keep the retry pending after the component that
 * wanted it is gone — up to 30 seconds of backoff, then a request for a page
 * nobody is looking at. Note this timer is started from a promise callback, not
 * from a lifecycle, so core's DEV timer guard has no owner to attribute it to and
 * correctly leaves it alone.
 */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
