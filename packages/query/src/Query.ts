import { Hook, create, destroy, mount, onWindow, StableProps, state, updated, watchProp } from "@ramonda/core";
import type { QueryEntry } from "./cacheEntry";
import { ClientContext, requireClient } from "./context";
import { serializeError, type SerializedError } from "./errors";
import { warnOnce } from "./diagnostics";
import { hashKey, sameKeyParts } from "./hashKey";
import type { QueryClient } from "./QueryClient";
import type {
  FetchStatus,
  ObserverBehaviour,
  QueryBehaviour,
  QueryDefaults,
  QueryEvent,
  QueryFetcher,
  QueryKey,
  QueryStatus,
} from "./types";

/**
 * One query's answer, in the shape that survives JSON — this is what travels from
 * the server to the client, carried by an ordinary `@state` field.
 *
 * The key travels with it so the client can seed the cache under the same hash,
 * and so a key that MOVED between the two renders can be recognised and the stale
 * snapshot ignored.
 */
export interface QuerySnapshot<TData> {
  key: QueryKey;
  data?: TData;
  error?: SerializedError;
}

export interface QueryProps<TData, K extends QueryKey = QueryKey> extends QueryDefaults {
  /**
   * This query's identity. Change it and you are asking a different question — the
   * hook follows, showing the new key's state (pending, or whatever is cached for
   * it) and abandoning the request for the old one.
   */
  key: K;
  /** How to get the data. Forward `ctx.signal` so an abandoned request stops. */
  fetch: QueryFetcher<TData, K>;
  /**
   * Set `false` to hold the query back — nothing is fetched and the status stays
   * `"pending"`.
   *
   * For a query that depends on something not there yet. It is better than the
   * alternative people reach for, which is a key with a hole in it
   * (`["user", undefined]`): that fetches with `undefined`, caches the failure
   * under a key that will never be asked for again, and renders an error the user
   * cannot act on.
   */
  enabled?: boolean;
}

/**
 * A query's state as a discriminated union, so TypeScript can narrow it.
 *
 * The boolean getters (`isPending`, `isError`, …) are shorter and right for most
 * renders, but they cannot narrow `data` — a getter tells the compiler nothing
 * about another getter, so `data` stays `TData | undefined` however many checks
 * came before it. Switch on this when you want the data without a `!`.
 *
 * `error` carries `data` too: a refetch that failed does not make what is on
 * screen wrong, only unconfirmed, so the last known value is still there to render
 * beside the failure.
 */
export type QueryResult<TData> =
  | { status: "pending"; data: undefined; error: undefined }
  | { status: "success"; data: TData; error: undefined }
  | { status: "error"; data: TData | undefined; error: unknown };

/**
 * Reads a cached, deduplicated, race-free query.
 *
 * ```tsx
 * class UserCard extends Component<{ id: string }> {
 *   private user = this.use(Query, (self: UserCard) => ({
 *     key: ["user", self.props.id],
 *     fetch: ({ signal }) => api.getUser(self.props.id, { signal }),
 *   }));
 *
 *   render() {
 *     if (this.user.isPending) return <p>Loading…</p>;
 *     if (this.user.isError) return <p>Could not load this user.</p>;
 *     return <p>{this.user.data?.name}</p>;
 *   }
 * }
 * ```
 *
 * `TData` is inferred from `fetch`, so nothing has to be declared at the call site
 * — see `PropsFactory` in core for why the props callback has its own overload,
 * and annotate the callback's parameter (`self: UserCard`) as above.
 *
 * ## Where the work happens
 *
 * - **`@mount`** starts the first fetch and RETURNS its promise, which is what a
 *   server render awaits before serializing (core's `commit.ts` registers a
 *   promise returned from a lifecycle as work the render must wait for). So the
 *   data lands in the HTML with no separate server API.
 * - **The getters** always read the entry for the key as it is right now, so a key
 *   change shows the new key's state in the same render that changed it — no frame
 *   of the previous user's name under the new user's heading.
 * - **A subscription** keeps this observer in step with everything else that
 *   touches the same key: another component's refetch, a mutation's `invalidate`,
 *   a manual `setData`.
 */
/**
 * `key` is a VALUE — `["user", 7]` built again is the same question — and that fact belongs
 * to this hook, not to every component that uses it. Declaring it means the framework hands
 * back one array identity for as long as the parts are equal, so a caller writes the plain
 * literal (`key: ["user", self.props.id]`) and nothing downstream sees a change.
 *
 * `onKeyChanged` therefore runs only on a real key change. Its own comparison stays: it is
 * what makes a hand-written options object cheap too, and it is the thing that decides
 * between "different objects" and "different question".
 */
@StableProps("key")
export class Query<TData, K extends QueryKey = QueryKey> extends Hook<QueryProps<TData, K>> {
  private ctx = this.use(ClientContext);

  /**
   * The re-render trigger, and nothing else — what is KNOWN lives in the cache,
   * which every observer of this key shares.
   *
   * A counter rather than a flag or a copy of the data, and both parts of that are
   * lessons already paid for in `AsyncLoad`:
   *
   * - **Not a copy of the data.** State is restored from the server's blob and the
   *   cache is not, so a mirrored copy can disagree with the entry every other
   *   observer reads. One source of truth, read on every render.
   * - **A counter, not a boolean.** A boolean restored as `true` never changes
   *   again, so the write that was meant to schedule a render schedules nothing
   *   and the page stays on the loading state forever — measured in `AsyncLoad`,
   *   where the content sat behind a spinner with the module already in the cache.
   *   An increment always differs from whatever was restored.
   */
  @state private version = 0;

  /**
   * What the server found for this key, on its way to the client.
   *
   * `@state` because that is core's transport: every hook's `@state` is serialized
   * into the hydration blob and restored before any client render (see
   * `seedFromSnapshot` for what happens then). It holds a JSON-safe shape rather
   * than the entry itself, because an entry carries a `Set` of observers, an
   * `AbortController` and a promise — none of which cross a wire.
   *
   * `null` on a client-only render, and it stays null: nothing writes it outside a
   * server render.
   */
  @state private snapshot: QuerySnapshot<TData> | null = null;

  /**
   * The subscription's bookkeeping. Plain fields: none of it is state a render
   * reads, and none of it survives a boundary.
   */
  private unsubscribe?: () => void;
  /**
   * The hash of the key this observer is subscribed to.
   *
   * The second half of change detection: `onKeyChanged` compares a freshly computed
   * hash against this one, so a key whose OBJECT parts were rebuilt is recognised as
   * the same question rather than resubscribed and refetched every render.
   */
  private attachedHash = "";
  /** The entry captured when we subscribed, so the read path never hashes. See `entry`. */
  private attachedEntry?: QueryEntry<TData>;
  /** Set once the hook is torn down, so a late notification cannot write to it. */
  private disposed = false;
  /** The polling timer, cleared on teardown and whenever `refetchInterval` changes. */
  private pollTimer?: ReturnType<typeof setInterval>;
  /** Set on the server, where the snapshot for the client has to be written. */
  private onServer = false;
  /** Set once a restored snapshot has been seeded into the cache, so it happens once. */
  private seeded = false;

  private get client(): QueryClient {
    return requireClient(this.ctx.client, "Query");
  }

  /**
   * This key's hash.
   *
   * Computed on demand and NOT memoised, because the two callers are the initial
   * subscription and the seeding check — each once per hook. Every hash on the
   * hot path (per owner render) is the one `@watchProp`'s selector produces, and
   * that one has to be recomputed anyway: comparing it against the previous value
   * is how the decorator decides whether the key moved.
   *
   * An earlier version cached it against the key array's identity. That was for a
   * design where every getter re-derived the entry; once `onKeyChanged` took over,
   * the cache was two fields nothing read.
   */
  private get hash(): string {
    return hashKey(this.props.key);
  }

  /**
   * The entry this query is currently about.
   *
   * A field read, and it has to be. This used to call `client.getEntry(this.props.key)`
   * — which HASHES the key — and every public getter goes through here, so one render
   * reading `isPending`, `isFetching` and `data` hashed the same key three times. A
   * spy on `JSON.stringify` caught it: two unrelated re-renders, two hashes, after the
   * key comparison had supposedly stopped hashing per render.
   *
   * The entry is captured when this observer subscribes, and the subscription is what
   * keeps it valid: an entry with an observer is never swept (see `unusedSince`), and
   * an entry deleted explicitly by `client.remove` sends a `"removed"` event that
   * re-subscribes and re-captures. Nothing else replaces an entry object for a key.
   *
   * No side effects: everything that has to HAPPEN when the key moves happens in
   * `onKeyChanged`, before the render rather than during it — which is what keeps a
   * getter from writing state mid-render (RMD001).
   */
  private get entry(): QueryEntry<TData> {
    // The fallback covers the window before the first `@create`: a getter read from a
    // field initializer, which nothing does today but which must not throw.
    return this.attachedEntry ?? this.client.getEntry<TData>(this.props.key);
  }

  /**
   * The key moved — a new `id`, a new page, a different route param.
   *
   * `@watchProp` is right for this and nothing else is:
   *
   * - It runs **before the render**, so the request for the new key is already in
   *   flight when the component draws its loading state. Anything post-commit —
   *   `@updated`, a subscription's connect — is one frame later.
   * - It watches the HOOK's props. That was a core bug until 0.1 — a hook's selector
   *   was handed the owning COMPONENT's props — and this hook is what surfaced it.
   *
   * ## Why the selector hands over the key and not its hash
   *
   * The decorator fires when the SELECTED value changes, so the obvious selector is
   * `props => hashKey(props.key)`: a string, compared by value, immune to the fresh
   * array literal the props callback builds every render. It works, and it hashes on
   * **every owner render** to discover that nothing moved — the cost paid to learn
   * there was nothing to do.
   *
   * Handing over the key itself inverts that. The value is then a new array each
   * render, so this method runs every time and answers the question itself, cheapest
   * test first:
   *
   * 1. `sameKeyParts` — identity, part by part. No hashing, no allocation. For a key
   *    of primitives, which is nearly all of them, this is the whole answer.
   * 2. Only if that says "not the same objects" — which is also what two freshly
   *    built `{ page: 1 }` literals say — hash once and compare against the hash we
   *    are actually subscribed to.
   *
   * Measured per render for one query: **723 ns → 31 ns** for `["user", 42]`, and
   * 1037 → 38 for a five-part key. A key containing an object pays ~250 ns more
   * (1508 → 1762), because the filter cannot decide it and the hash runs anyway; see
   * `sameKeyParts` for the full table. In a DEV build the win is bigger, because
   * hashing also runs the recursive `assertStableKey` walk.
   *
   * Writing state here is safe, unlike in a getter: watchProps run before the render
   * phase starts, so `version++` from the notification below joins the render already
   * in flight instead of scheduling one from inside it.
   */
  @watchProp((props) => props.key)
  onKeyChanged(next: QueryKey, previous: QueryKey): void {
    if (sameKeyParts(next, previous)) return;

    const hash = hashKey(next);
    // Equal by value after all: an object part was rebuilt, so the identities differ
    // and the hashes do not. Comparing against the hash we are SUBSCRIBED to rather
    // than against `previous`'s, so a key that flickered away and back inside one
    // render still lands on the right entry.
    if (hash === this.attachedHash) return;

    this.rekey(hash);
    void this.fetchIfNeeded(false);
  }

  /**
   * Subscribes to `hash`, dropping the previous subscription.
   *
   * Not built on `createSubscriptionDecorator`, and the reason is worth writing down
   * because the shape looks made for it. A connect that reads
   * `this.props.key` re-runs on **every owner render**, not on every key change:
   * the key is a fresh array literal each time, the prop signal compares with
   * `!==`, so it reports a change even when the value is equal. The effect's
   * cleanup runs before each re-run, so every unrelated re-render would
   * unsubscribe — and unsubscribing the last observer ABORTS the fetch in flight.
   * The measured result is a query that never completes while its owner is
   * re-rendering.
   *
   * Effects also never run on the server, and the observer count has to be right
   * there too.
   */
  private attach(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.client.subscribe(this.props.key, this.observe);
    // Captured here, once, so the read path never hashes. Valid for as long as the
    // subscription above is — see `entry`.
    this.attachedEntry = this.client.getEntry<TData>(this.props.key);
  }

  /**
   * Moves this observer onto the key whose hash is `hash`: seeds whatever the server
   * sent for it, then subscribes.
   *
   * Seeding BEFORE subscribing is deliberate — `hydrate` wakes an entry's observers,
   * and being subscribed first would mean answering our own seed with a `version`
   * write. It is silenced on top of that (see `hydrate`'s `silent`), so a component
   * already watching this key is not woken either.
   */
  private rekey(hash: string): void {
    this.attachedHash = hash;
    this.seedFromSnapshot(hash);
    this.attach();
  }

  /**
   * Puts the server's answer for this key into the cache, once.
   *
   * This is what makes server rendering work with nothing for an app to wire up.
   * `@state` is serialized into the hydration blob per hook and restored **before
   * any client render**, so by the time this runs the snapshot is already here —
   * and seeding it from the read path means the FIRST client render produces what
   * the server produced. Do it later (from `@mount`, say) and the first render
   * shows a spinner where the HTML has content, which hydration resolves by
   * destroying that content: the reader watches finished text flash into a
   * placeholder, and core reports the disagreement as RMD007.
   *
   * The hash is checked because a key can move between the server's render and the
   * client's first one — a route param read from the URL, most often — and the
   * server's answer to the old question is not an answer to the new one.
   */
  private seedFromSnapshot(hash: string): void {
    if (this.seeded) return;
    const snapshot = this.snapshot;
    if (!snapshot) return;

    // Once per hook, whether or not it turns out to be usable: a snapshot that did
    // not match cannot start matching later.
    this.seeded = true;
    if (hashKey(snapshot.key) !== hash) return;

    this.client.hydrate(
      {
        queries: [
          {
            key: snapshot.key,
            data: snapshot.data,
            error: snapshot.error,
            // Ignored — `hydrate` restamps with this side's clock, because the
            // server's is another machine's. See `QueryEntry.restored`.
            updatedAt: 0,
          },
        ],
      },
      { silent: true },
    );
  }

  /**
   * Writes what this query knows into `@state`, so it travels to the client.
   *
   * Server only. This is the whole SSR mechanism: no `dehydrate()` call in an app's
   * server entry, no `<HydrationBoundary>`, no script tag to place — core already
   * carries every hook's `@state` across the boundary, so a query's data rides
   * along with everything else the component was holding.
   *
   * The cost is that two observers of one key each carry a copy. That is bytes,
   * not correctness, and it buys an SSR story with nothing to forget. `dehydrate`
   * is still exported for a server that would rather send the cache once and hand
   * it to the provider itself.
   */
  private captureSnapshot(): void {
    if (this.disposed) return;

    const entry = this.client.getEntry<TData>(this.props.key);
    if (entry.status === "success") {
      this.snapshot = { key: entry.key, data: entry.data };
      return;
    }
    if (entry.status === "error") {
      // An Error does not survive JSON — `JSON.stringify(new Error("x"))` is `{}`
      // — so it crosses as `{ name, message }` and arrives as a `ServerQueryError`.
      this.snapshot = { key: entry.key, error: serializeError(entry.error) };
    }
  }

  private observe = (event: QueryEvent): void => {
    if (this.disposed) return;

    if (event === "invalidated") {
      // What we hold is no longer trustworthy, and we are the one holding the
      // fetcher for this key — see `QueryEvent` for why the cache does not call it
      // itself.
      void this.fetchIfNeeded(true);
      return;
    }

    if (event === "removed") {
      // The entry itself is gone (a logout, a `client.remove`). Subscribing again
      // builds a fresh one and re-captures it, and then there is data to get.
      this.rekey(this.attachedHash);
      this.version++;
      void this.fetchIfNeeded(true);
      return;
    }

    // On the server the blob is the only way out, and this is every moment the
    // entry changed — including a fetch another observer of the same key started,
    // and a refetch triggered during the render's drain. `@mount` captures once
    // too, for data that was already there and so never notified anyone.
    if (this.onServer) this.captureSnapshot();

    this.version++;
  };

  /**
   * Subscribes, and seeds whatever the server sent for this key.
   *
   * `env: "client"` and a separate `env: "server"` twin below, rather than one
   * shared `@create`, because **a shared `@create` does not run while hydrating**:
   * hydration runs only the `client` ones, on the grounds that the server already
   * ran the others (core's hydrate.ts). A shared one here would therefore skip the
   * seeding on exactly the path that needs it.
   *
   * It has to be a `@create` rather than `@mount` for the same reason: creates run
   * BEFORE the first render, and the seed has to be in the cache before anything
   * reads it, or the first client render disagrees with the server's markup (RMD007)
   * and hydration resolves that by throwing the markup away.
   */
  @create({ env: "client" })
  initClient(): void {
    this.rekey(this.hash);
  }

  /** The server's half: subscribe, and remember that a snapshot has to be written. */
  @create({ env: "server" })
  initServer(): void {
    this.onServer = true;
    this.rekey(this.hash);
  }

  /**
   * The first fetch, and on the server the snapshot that follows it.
   *
   * Returned rather than awaited: a lifecycle that returns a promise is awaited by
   * a SERVER render (core registers it as work the render must finish before
   * serializing) and left fire-and-forget on the client. That split is the whole
   * SSR story — the HTML waits for the data, the live page paints first.
   *
   * `@mount` rather than `@create`, and not only because the promise is awaited
   * here: a shared `@create` is skipped while hydrating, so a first fetch there
   * would never run for a page that arrived server-rendered.
   */
  @mount
  load(): Promise<void> {
    const work = this.fetchOnMount();
    if (!this.onServer) return work;

    // Captured after the work settles, for the case no notification ever came:
    // data that was already in the cache (another observer fetched it, or a route
    // guard prefetched it) changes nothing, so nothing wakes this observer — and
    // without this the client would get an empty snapshot for a query the server
    // rendered perfectly well.
    return work.then(() => this.captureSnapshot());
  }

  /**
   * What mounting should do about data that is already there.
   *
   * The interesting case is the restored one. With the default `staleTime: 0`,
   * "refetch if stale" means "refetch always" — so a server-rendered page would
   * fetch every one of its queries again the instant it hydrated, doubling every
   * request on the most common setup there is. Data that came from the server is
   * therefore treated as being as fresh as the document that carried it: mounting
   * does not refresh it, and `refetchOnMount: "always"` is there for a page that
   * genuinely wants both.
   *
   * A query with nothing cached fetches whatever the setting says — `refetchOnMount`
   * decides whether to REFRESH, and there is nothing to refresh yet.
   */
  private fetchOnMount(): Promise<void> {
    if (this.props.enabled === false) return Promise.resolve();

    const entry = this.client.getEntry<TData>(this.props.key);
    const hasResult = entry.updatedAt > 0 || entry.errorUpdatedAt > 0;
    const onMount = this.client.resolveObserver(this.observerBehaviour()).refetchOnMount;

    if (!hasResult) return this.fetchIfNeeded(true);
    if (onMount === "always") return this.fetchIfNeeded(true);
    if (onMount === false) return Promise.resolve();
    if (entry.restored) return Promise.resolve();

    return this.fetchIfNeeded(false);
  }

  /**
   * Refreshes stale data when the window regains focus.
   *
   * **Only when it is stale**, so a tab switched away from and back inside
   * `staleTime` costs nothing — which is what makes this a defensible default
   * rather than a request per alt-tab.
   *
   * `@onWindow` rather than a hand-rolled listener: it is built on an effect, so it
   * is attached on the client only and removed on destroy with nothing to forget.
   * Reading props in the HANDLER is safe — an event is not an effect run, so
   * nothing is recording dependencies, and the key array cannot pull this into the
   * re-run loop described on `attach`.
   */
  @onWindow("focus")
  refreshOnFocus(): void {
    if (!this.client.resolveObserver(this.observerBehaviour()).refetchOnWindowFocus) return;
    void this.fetchIfNeeded(false);
  }

  /** Refreshes stale data when the browser comes back online. Same shape as focus. */
  @onWindow("online")
  refreshOnReconnect(): void {
    if (!this.client.resolveObserver(this.observerBehaviour()).refetchOnReconnect) return;
    void this.fetchIfNeeded(false);
  }

  /**
   * Starts the fetch that flipping `enabled` unblocks.
   *
   * This was an `@effect` reading `this.props.enabled` (that decorator is gone now), and
   * `@watchProp` is better at
   * the same job in every way that can be measured:
   *
   * - **It fires only on a change**, so the "is this the first run?" guard is gone.
   *   The effect ran once on the first commit whether or not anything had flipped,
   *   found the data `@mount` had just fetched already stale under the default
   *   `staleTime: 0`, and fetched it again — two requests for one mounted query,
   *   until a flag was added to suppress it. A watcher does not fire at mount at
   *   all, so there is nothing to suppress.
   * - **Nothing is tracking while it runs**, so the work happens here instead of a
   *   microtask later. Inside an effect body, calling `fetchIfNeeded` (which reads
   *   `props.key`) pulled the key signal into the effect's dependencies and built a
   *   loop: render → effect → fetch → notify → render, measured at 14 fetches for
   *   one query. `runWatchProps` is called from the build path with no effect and no
   *   compute active, so the same call records nothing.
   * - **It runs before the render**, so the request is in flight when the component
   *   draws its loading state, rather than one commit later.
   */
  @watchProp((props) => props.enabled)
  onEnabledChanged(enabled: boolean | undefined): void {
    if (enabled === false) return;
    void this.fetchIfNeeded(false);
  }

  /**
   * Polls, when `refetchInterval` asks for it.
   *
   * Three named methods rather than one effect, and no timer left to a cleanup:
   *
   * - `@create({ env: "client" })` starts it, before the first render, and only on
   *   the client — a pending interval on the server is a live handle on the event
   *   loop for every request.
   * - `@watchProp` restarts it when the interval changes, synchronously.
   * - `@destroy` clears it. That order matters for core's DEV timer guard: a timer
   *   created during a lifecycle is attributed to the component, and anything still
   *   ticking at the END of teardown is reported as a leak (RMD006). Cleared here,
   *   there is nothing to report.
   *
   * `@interval` cannot do this — its delay is a decorator argument, fixed where the
   * class is written, and this one comes from a prop.
   *
   * Polling forces the fetch rather than checking staleness: an interval IS the
   * staleness policy for a query that has one, and a `refetchInterval` shorter than
   * `staleTime` would otherwise do nothing at all.
   */
  @create({ env: "client" })
  startPolling(): void {
    this.schedulePoll();
  }

  @watchProp((props) => props.refetchInterval)
  onIntervalChanged(): void {
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    const every = this.client.resolveObserver(this.observerBehaviour()).refetchInterval;
    if (every <= 0) return;

    this.pollTimer = setInterval(() => {
      if (this.disposed) return;
      void this.fetchIfNeeded(true);
    }, every);
  }

  @destroy
  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    // Before core's timer guard looks: it reports whatever is still ticking at the
    // end of this teardown as a leak (RMD006).
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Fetches unless there is a good reason not to: the query is disabled, or what is
   * cached is still fresh.
   *
   * Never rejects. A failed query is a state to render — `isError` — not an
   * exception for whichever lifecycle happened to trigger it; a rejection here
   * would surface as an unhandled promise on the client and would abort a server
   * render for one failed panel.
   */
  private fetchIfNeeded(force: boolean): Promise<void> {
    if (this.props.enabled === false) return Promise.resolve();

    const options = this.behaviour();
    // Resolved against the client's defaults before asking about staleness: an
    // unset `staleTime` here means "whatever the provider decided", not zero — and
    // reading it as zero would refetch on every mount in a tree that deliberately
    // set a long one.
    const staleTime = this.client.resolve(options).staleTime;
    if (!force && !this.client.isStale(this.props.key, staleTime)) {
      return Promise.resolve();
    }

    return this.client.fetch<TData>(this.props.key, this.props.fetch as QueryFetcher<TData>, options);
  }

  /** This query's own cache options, as passed. Defaults are resolved by the client. */
  private behaviour(): QueryBehaviour {
    return {
      staleTime: this.props.staleTime,
      gcTime: this.props.gcTime,
      retry: this.props.retry,
      retryDelay: this.props.retryDelay,
    };
  }

  /**
   * This query's own triggers, as passed.
   *
   * Reads four scalars and NOTHING else — in particular not `key`. Called from
   * inside effects, where reading the key array would make them re-run on every
   * owner render; see `attach`.
   */
  private observerBehaviour(): ObserverBehaviour {
    return {
      refetchOnMount: this.props.refetchOnMount,
      refetchOnWindowFocus: this.props.refetchOnWindowFocus,
      refetchOnReconnect: this.props.refetchOnReconnect,
      refetchInterval: this.props.refetchInterval,
    };
  }

  // --- What a component reads -----------------------------------------------

  /** What is known about the DATA — independent of whether a request is running. */
  get status(): QueryStatus {
    if (__DEV__) this.sawError = true;
    return this.entry.status;
  }

  /** Whether a request is in flight right now. */
  get fetchStatus(): FetchStatus {
    return this.entry.fetchStatus;
  }

  /**
   * The data, or `undefined` while there has never been any.
   *
   * Present alongside an error when a refetch failed over data that had already
   * arrived — see `QueryResult`.
   */
  get data(): TData | undefined {
    return this.entry.data;
  }

  /** Whatever the fetcher rejected with, untouched. A restored one is a `ServerQueryError`. */
  /**
   * DEV only: whether this render looked at the failure. See `reportIgnoredError`.
   *
   * A plain field, not `@state`: reading it must not make anything reactive, and nothing
   * renders from it.
   */
  private sawError = false;

  get error(): unknown {
    if (__DEV__) this.sawError = true;
    return this.entry.error;
  }

  /** No data yet, and no failure to show for it. This is the "loading" case. */
  get isPending(): boolean {
    return this.entry.status === "pending";
  }

  /** There is data. It may be refetching; check `isFetching` for that. */
  get isSuccess(): boolean {
    return this.entry.status === "success";
  }

  /** The last attempt failed. `data` may still hold the last known good value. */
  get isError(): boolean {
    if (__DEV__) this.sawError = true;
    return this.entry.status === "error";
  }

  /**
   * A request is in flight — including a background refresh over data already on
   * screen, which is the case `isPending` deliberately does not cover.
   */
  get isFetching(): boolean {
    return this.entry.fetchStatus === "fetching";
  }

  /** Consecutive failed attempts for the request in progress. 0 once it succeeds. */
  get failureCount(): number {
    if (__DEV__) this.sawError = true;
    return this.entry.failureCount;
  }

  /** When the data arrived, by this side's clock. 0 means it never has. */
  get updatedAt(): number {
    return this.entry.updatedAt;
  }

  /** Whether the data came from a server render rather than a fetch on this side. */
  get isRestored(): boolean {
    return this.entry.restored === true;
  }

  /**
   * The same state as a discriminated union, for when narrowing is worth four more
   * characters:
   *
   * ```tsx
   * const user = this.user.result;
   * if (user.status === "success") return <p>{user.data.name}</p>;  // data: User
   * ```
   */
  get result(): QueryResult<TData> {
    if (__DEV__) this.sawError = true;
    const entry = this.entry;
    if (entry.status === "success") {
      return { status: "success", data: entry.data as TData, error: undefined };
    }
    if (entry.status === "error") {
      return { status: "error", data: entry.data, error: entry.error };
    }
    return { status: "pending", data: undefined, error: undefined };
  }

  /**
   * Fetches again whatever the cache thinks about freshness, and hands back a
   * promise that settles when it has.
   *
   * Joins a request already in flight rather than starting a second — the same
   * deduplication two components asking for one key get, because a second request
   * for an answer already on its way is a race with itself.
   */
  refetch(): Promise<void> {
    return this.fetchIfNeeded(true);
  }

  /**
   * RMQ002 — the query failed and the render never looked.
   *
   * ## Why this instead of `throwOnError`
   *
   * TanStack has an option that rethrows a failure so an error boundary catches it. It is not
   * built here, and the reason is what a boundary DOES: it replaces the subtree, which means
   * unmounting — `@destroy`, cleanups, lost local state, lost focus and scroll position — and
   * a retry then has to rebuild all of it. A failed fetch is not an unexpected situation; the
   * network fails routinely, which is why `Query` models it as state and keeps the data it
   * had. Handing that to a boundary punishes the reader for somebody else's timeout.
   *
   * What people actually get from `throwOnError` is *noticing*. That is a diagnostic, not an
   * API — so this is the diagnostic. If the failure genuinely means the page cannot be shown,
   * the render says so itself (`if (this.user.isError) return <NotFound />`), which unmounts
   * exactly what the app chose to unmount.
   *
   * ## How it knows
   *
   * The getters that expose a failure — `error`, `isError`, `status`, `failureCount`,
   * `result` — set a flag when read. `@updated` runs after the commit, so by then the flag
   * reflects the render that just happened; it is cleared afterwards, so the next render is
   * judged on its own reads rather than being excused by an earlier one.
   *
   * `@mount` checks too, for the one case an update never covers: an error restored from a
   * server render is already on screen at the first paint, with no second render to follow it.
   */
  @updated
  @mount
  reportIgnoredError(): void {
    if (!__DEV__) return;

    const looked = this.sawError;
    this.sawError = false;
    if (looked) return;

    // The ATTACHED entry, not `peek(this.props.key)`: peeking hashes the key, and this runs
    // after every render — which would undo the whole point of the identity fast path
    // (measured at 723 ns → 31 ns per render, and there is a test that holds it).
    const entry = this.attachedEntry;
    if (entry?.status !== "error") return;

    const reason = entry.error instanceof Error ? entry.error.message : String(entry.error);
    warnOnce(
      `[RMQ002] The query ${JSON.stringify(entry.key)} failed and nothing rendered it: ${reason}\n` +
        `Read \`isError\`, \`error\`, \`status\` or \`result\` so the reader learns something went wrong — a ` +
        `failed refetch keeps the data it had, so the page may look fine while showing values nobody can refresh. ` +
        `If the failure means the page cannot be shown at all, return your own markup for it ` +
        `(\`if (q.isError) return <NotFound />\`) rather than letting an error boundary unmount the subtree.`,
    );
  }
}
