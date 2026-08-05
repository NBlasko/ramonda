import { Hook, create, destroy, mount, onDocument, onWindow, StableProps, state, watchProp } from "@ramonda/core";
import type { QueryEntry } from "./cacheEntry";
import { ClientConsumer, requireClient } from "./context";
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
  /**
   * Data to put IN THE CACHE for this key, if nothing is there yet.
   *
   * It behaves exactly like a fetched answer, because that is what it becomes: every observer
   * of the key sees it, `status` is `"success"`, and staleness applies — with the default
   * `staleTime: 0` it is stale on arrival and `refetchOnMount` will refresh it. That is usually
   * what you want from data you already had lying around (a list the previous page fetched, a
   * value from `localStorage`).
   *
   * Pass a function when producing it is not free: `initialData: build()` runs the build every
   * time the props callback runs — which is whenever a signal it reads moves, and for a query
   * that is exactly when the key changes. `initialData: build` is called only when the cache is
   * actually empty.
   *
   * Use `initialDataUpdatedAt` when the data is not new — see below.
   */
  initialData?: TData | (() => TData);
  /**
   * When `initialData` was actually obtained, as a timestamp. Defaults to now.
   *
   * Without it, seeded data looks freshly fetched, so a `staleTime` of a minute would keep a
   * value from `localStorage` for a minute before checking. Pass what you know and staleness
   * does the right thing — including refetching immediately if it is already older than
   * `staleTime`.
   */
  initialDataUpdatedAt?: number;
  /**
   * What THIS observer renders while there is nothing real yet. Never written to the cache.
   *
   * The difference from `initialData` is the whole point of having both: initial data IS the
   * answer until something better arrives, shared by every observer and subject to staleness;
   * placeholder data is a stand-in this one component shows instead of a spinner, and it is
   * gone the moment the fetch lands.
   *
   * While it is showing, `status` is `"success"` and `data` is the placeholder, so the ordinary
   * `if (isPending) return <Spinner />` gives way to the stand-in — which is the point.
   * `isPlaceholder` is how you tell: dim it, or hide the actions that would act on it.
   *
   * Pass a function when producing it is not free, for the same reason as `initialData`.
   */
  placeholderData?: TData | (() => TData);
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
 *   private user = this.use(Query<User>, (self: UserCard) => ({
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
 * ## Two ways to write the type, and why
 *
 * `Query<User>` above is an instantiation expression: it names `TData` on the class
 * before the props are read, which makes the props object something CHECKED against
 * `QueryProps<User, K>` rather than something a type is inferred FROM. That is what
 * gives every callback beside it a contextual type — `fetch: ({ signal, key }) => …`
 * needs no annotations, and `key[1]` is typed by the key.
 *
 * Left off, `TData` is inferred from `fetch` instead, which also works and is shorter:
 *
 * ```tsx
 * private user = this.use(Query, (self: UserCard) => ({
 *   key: ["user", self.props.id],
 *   fetch: ({ signal }: FetchContext) => api.getUser(self.props.id, { signal }),
 * }));
 * ```
 *
 * The trade is only where the type is written. Inferring means the props object is the
 * source of the inference, so a callback parameter left unannotated has no contextual
 * type (`'signal' implicitly has an 'any' type`) — one annotation buys it back. Pinning
 * means writing the data type once and annotating nothing. Reach for the pin when there
 * is more than one callback to annotate, or when naming the type documents the query.
 *
 * Either way the props callback's own parameter is annotated (`self: UserCard`) — see
 * `PropsFactory` in core for why that one cannot be inferred.
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
/**
 * The parts of a query an app can observe, one bit each. A read is recorded per FACET rather
 * than per getter, because several getters answer the same question — `isPending`, `isSuccess`
 * and `isError` are all "what is the status".
 */
const enum Facet {
  Data = 1,
  Status = 2,
  Error = 4,
  Fetching = 8,
  Failure = 16,
  UpdatedAt = 32,
  Restored = 64,
}

/** A snapshot of the facets, taken whenever the owner is woken. */
interface Observed {
  data: unknown;
  status: QueryStatus;
  fetchStatus: FetchStatus;
  error: unknown;
  failureCount: number;
  updatedAt: number;
  restored: boolean;
}

@StableProps("key")
export class Query<TData, K extends QueryKey = QueryKey> extends Hook<QueryProps<TData, K>> {
  private ctx = this.use(ClientConsumer);

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
    /**
     * Reading `version` is load-bearing, and it is what makes a `@compute` over this query
     * CORRECT rather than frozen.
     *
     * The cache is not reactive: an entry is a plain object, and what wakes an observer is the
     * `version` increment in `notify`. A render re-reads these getters every time, so it never
     * noticed — but a `@compute` caches, and a compute that read no signal is never invalidated.
     * Measured before this line existed: `@compute get name() { return this.query.data?.name }`
     * returned `undefined` forever while the render, reading `data` directly, showed `Ada 4`.
     *
     * Touching the signal here means every reader — render, compute, watcher — depends on the
     * one thing that changes when the entry does. No extra render comes of it: the version
     * write IS the wake-up, so there is nothing else to schedule.
     */
    void this.version;

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
    this.seedInitialData();
    this.attach();
  }

  /**
   * Puts `initialData` into the cache, if the cache has nothing for this key.
   *
   * From `rekey` rather than a lifecycle, so it also runs when the KEY moves: a new key is a
   * new question, and if the app has initial data for it, the first render of it should show
   * that rather than a spinner.
   *
   * "If nothing is there" is what makes it safe with several observers and with a key that
   * comes back: seeding never overwrites an answer, and a value that was already fetched — or
   * restored from the server — outranks one the app had lying around.
   */
  private seedInitialData(): void {
    const given = this.props.initialData;
    if (given === undefined) return;

    const entry = this.client.peek<TData>(this.props.key);
    if (entry !== undefined && entry.status !== "pending") return;

    // Called only now, which is why the function form exists: the props callback runs on every
    // render, so an inline value would be rebuilt every time for the one render that needs it.
    const data = typeof given === "function" ? (given as () => TData)() : given;
    this.client.seed(this.props.key, data, this.props.initialDataUpdatedAt);
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

  private observe(event: QueryEvent): void {
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

    this.wake();
  }

  /**
   * Wakes the owner, unless nothing it has read actually changed.
   *
   * The comparison is by identity for `data` and `error` and by value for the rest, because
   * that is what the cache guarantees: it REPLACES `data` when a fetch lands, so a refetch
   * returning an equal-but-new object counts as a change. Closing that last gap is what
   * `select` or structural sharing would be for, and it is deliberately not this.
   *
   * Before the first render nothing has been read, and then everything counts — the first
   * paint must not be skipped on the grounds that the app has not asked for anything yet.
   */
  private wake(): void {
    const next = this.observed();
    const previous = this.lastSeen;
    this.lastSeen = next;

    // The ATTACHED entry, not `peek(this.props.key)`: peeking hashes the key, and this runs on every
    // notification — which would undo the identity fast path (measured at 723 ns → 31 ns, and there is
    // a test that holds it).
    if (__DEV__) reportIgnoredError(this.read, this.attachedEntry);

    if (previous !== undefined && this.read !== 0 && !this.changed(previous, next)) return;

    this.version++;
  }

  /** The facets, as the app could observe them right now. */
  private observed(): Observed {
    const entry = this.attachedEntry ?? this.client.getEntry<TData>(this.props.key);
    return {
      data: entry.data,
      status: entry.status,
      fetchStatus: entry.fetchStatus,
      error: entry.error,
      failureCount: entry.failureCount,
      updatedAt: entry.updatedAt,
      restored: entry.restored === true,
    };
  }

  /** Whether anything the app has READ differs between two observations. */
  private changed(a: Observed, b: Observed): boolean {
    if (this.read & Facet.Data && !Object.is(a.data, b.data)) return true;
    if (this.read & Facet.Status && a.status !== b.status) return true;
    if (this.read & Facet.Fetching && a.fetchStatus !== b.fetchStatus) return true;
    if (this.read & Facet.Error && !Object.is(a.error, b.error)) return true;
    if (this.read & Facet.Failure && a.failureCount !== b.failureCount) return true;
    if (this.read & Facet.UpdatedAt && a.updatedAt !== b.updatedAt) return true;
    if (this.read & Facet.Restored && a.restored !== b.restored) return true;
    return false;
  }

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
    /**
     * The one case a notification never covers: an error restored from a server render is on screen at
     * the first paint, and nothing notifies afterwards.
     *
     * Reported from here rather than from a `@mount` of its own, because a DEV-only lifecycle method is
     * not free in production — the decorator registers from an initializer, so every instance bound an
     * empty method and the flush called it. Placed before `fetchOnMount` and unaffected by it: a refetch
     * moves `fetchStatus`, not `status`, so the restored failure is still there to see.
     */
    if (__DEV__) reportIgnoredError(this.read, this.attachedEntry);

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
   * Refreshes stale data when the tab becomes visible again.
   *
   * **Only when it is stale**, so a tab switched away from and back inside `staleTime` costs
   * nothing — which is what makes this a defensible default rather than a request per switch.
   *
   * ## Why visibility and not focus
   *
   * This listened to the window's `focus` event until 2026-07-29, and that signal is wrong in
   * both directions:
   *
   * - **It misses.** On a phone, leaving the browser and coming back reliably fires
   *   `visibilitychange`; `focus` and `blur` are unreliable there. So the reader returned to
   *   stale data and nothing refreshed it.
   * - **It over-fires.** A page that was visible the whole time — a second monitor, a split
   *   screen, or simply DevTools having focus — fires `focus` when you click into it, though
   *   nothing was ever hidden. With the default `staleTime: 0` that is a request per click.
   *
   * `document.visibilityState` answers the question the option is actually asking: is somebody
   * looking at this again. TanStack reached the same conclusion and dropped its focus listener.
   *
   * ## Why the option is still called `refetchOnWindowFocus`
   *
   * Because that is the name people arrive with, and it describes the intent even where it no
   * longer describes the mechanism. Renaming it would cost every reader a lookup to learn that
   * nothing about their app changed.
   *
   * `@onDocument`, because `visibilitychange` fires on the document — and like `@onWindow` it is
   * built on an effect, so it attaches on the client only and is removed on destroy with
   * nothing to forget.
   */
  @onDocument("visibilitychange")
  refreshOnVisible(): void {
    if (document.visibilityState !== "visible") return;
    if (!this.client.resolveObserver(this.observerBehaviour()).refetchOnWindowFocus) return;
    void this.fetchIfNeeded(false);
  }

  /** Refreshes stale data when the browser comes back online. Same shape as visibility. */
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
    this.read |= Facet.Status;
    // `"success"` while a placeholder shows, because that is what a placeholder is FOR: the
    // ordinary `if (isPending) return <Spinner />` has to give way to the stand-in. Read
    // `isPlaceholder` to tell the two apart.
    if (this.showsPlaceholder) return "success";
    return this.entry.status;
  }

  /** Whether a request is in flight right now. */
  get fetchStatus(): FetchStatus {
    this.read |= Facet.Fetching;
    return this.entry.fetchStatus;
  }

  /**
   * The data, or `undefined` while there has never been any.
   *
   * Present alongside an error when a refetch failed over data that had already
   * arrived — see `QueryResult`.
   */
  get data(): TData | undefined {
    this.read |= Facet.Data;
    if (this.showsPlaceholder) return this.placeholder();
    return this.entry.data;
  }

  /** Whatever the fetcher rejected with, untouched. A restored one is a `ServerQueryError`. */
  /**
   * What the app has actually READ off this query, and what those parts looked like when it
   * was last woken. Together they decide whether a change is worth a render.
   *
   * ## Why this exists
   *
   * A cache entry changes three times per refetch — the fetch starts, the data arrives, the
   * freshness moves — and every one of them used to wake the owner. Measured on a query whose
   * rendered value never changed: three refetches, **nine renders**. Two of the three are for
   * facts the component never asked about, which is the cheapest kind of wasted work to
   * remove: it needs no new API, only knowing what was read.
   *
   * The same shape TanStack and SWR arrived at, by different means — they proxy the result
   * object and record field access. Here the getters ARE the access points, so a bit per facet
   * is enough.
   *
   * ## Why the read set only ever grows
   *
   * It is never cleared, and that is deliberate: a component that reads `isFetching` inside a
   * branch would otherwise stop being woken for it the moment the branch is not taken, and the
   * next time the branch IS taken it would render a stale spinner. Accumulating errs towards
   * more renders, which is the safe direction — the same reason TanStack tracks from the first
   * render rather than per render.
   */
  private read = 0;
  private lastSeen: Observed | undefined;

  /** Built at most once — see `placeholder()`. */
  private placeholderValue: TData | undefined;

  get error(): unknown {
    this.read |= Facet.Error;
    return this.entry.error;
  }

  /** No data yet, and no failure to show for it. This is the "loading" case. */
  get isPending(): boolean {
    // Through `status`, not straight to the entry: a placeholder reports `"success"`, and three
    // getters that disagree with the one they are shorthand for is the trap `result` already
    // showed. A test caught this one — `isPending` stayed true under a placeholder.
    return this.status === "pending";
  }

  /** There is data. It may be refetching; check `isFetching` for that. */
  get isSuccess(): boolean {
    return this.status === "success";
  }

  /** The last attempt failed. `data` may still hold the last known good value. */
  get isError(): boolean {
    return this.status === "error";
  }

  /**
   * A request is in flight — including a background refresh over data already on
   * screen, which is the case `isPending` deliberately does not cover.
   */
  get isFetching(): boolean {
    this.read |= Facet.Fetching;
    return this.entry.fetchStatus === "fetching";
  }

  /** Consecutive failed attempts for the request in progress. 0 once it succeeds. */
  get failureCount(): number {
    this.read |= Facet.Failure;
    return this.entry.failureCount;
  }

  /** When the data arrived, by this side's clock. 0 means it never has. */
  get updatedAt(): number {
    this.read |= Facet.UpdatedAt;
    return this.entry.updatedAt;
  }

  /** Whether the data came from a server render rather than a fetch on this side. */
  /**
   * Whether what `data` returns is the stand-in rather than an answer.
   *
   * Worth rendering: a placeholder is not wrong, but it is not the user's data either, so an
   * action taken against it may be acting on nothing. Dim it, or hide the buttons.
   */
  get isPlaceholder(): boolean {
    this.read |= Facet.Data | Facet.Status;
    return this.showsPlaceholder;
  }

  /**
   * A placeholder shows only while there is genuinely nothing — no data and no error.
   *
   * Not "while pending": a failed query with no data must keep reporting the failure, or a
   * placeholder would hide it forever and RMQ002 would be the only sign.
   */
  private get showsPlaceholder(): boolean {
    if (this.props.placeholderData === undefined) return false;
    const entry = this.entry;
    return entry.status === "pending" && entry.data === undefined;
  }

  /**
   * Builds the placeholder, once per instance.
   *
   * The function form exists because an inline value is rebuilt every time the props callback
   * runs — and a rebuilt object handed to `data` changes identity, which access tracking would
   * then have to wake for. The callback runs less often than it used to (it is cached on the
   * signals it reads), but "less often" is not "once", and this value is wanted once.
   */
  private placeholder(): TData | undefined {
    if (this.placeholderValue === undefined) {
      const given = this.props.placeholderData;
      this.placeholderValue = typeof given === "function" ? (given as () => TData)() : given;
    }
    return this.placeholderValue;
  }

  get isRestored(): boolean {
    this.read |= Facet.Restored;
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
    // The union exposes all three at once, so reading it subscribes to all three.
    this.read |= Facet.Data | Facet.Status | Facet.Error;

    // The union has to agree with the getters, or a component that narrows through `result`
    // would see `pending` while one reading `data` sees the placeholder.
    if (this.showsPlaceholder) return { status: "success", data: this.placeholder() as TData, error: undefined };
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
   * RMQ002 — the query failed and the app never looks at failures.
   *
   * ## Why this instead of `throwOnError`
   *
   * TanStack has an option that rethrows a failure so an error boundary catches it. It is not
   * built here, and the reason is what a boundary DOES: it replaces the subtree, which means
   * unmounting — `@destroy`, cleanups, lost local state, lost focus and scroll position — and a
   * retry then has to rebuild all of it. A failed fetch is not an unexpected situation; the
   * network fails routinely, which is why `Query` models it as state and keeps the data it had.
   * Handing that to a boundary punishes the reader for somebody else's timeout.
   *
   * What people actually get from `throwOnError` is *noticing*. That is a diagnostic, not an
   * API — so this is the diagnostic. If the failure genuinely means the page cannot be shown,
   * the render says so itself (`if (q.isError) return <NotFound />`), which unmounts exactly
   * what the app chose to unmount.
   *
   * ## What it asks
   *
   * Not "did this render look" but "does this query's reader EVER look" — the read set is the
   * same one access tracking keeps, and it never shrinks. That is the better question anyway: a
   * component that has read `isError` once has the branch, and one that never has cannot show
   * the failure in any state.
   *
   * It follows that the tracking had to come first. Before it, a query read only through `data`
   * would fail, change nothing visible, and never render again — so a render-based check could
   * not see it either.
   */
}

/**
 * RMQ002, and it lives out here rather than on the class for a reason that cost a measurement.
 *
 * As a private method it survived into `dist/index.prod.js` as `reportIgnoredError(){}` — the body,
 * the message and the code all stripped by `__DEV__`, but the declaration left standing, because
 * **a class method cannot be tree-shaken**: nothing can prove it is unused. A module function
 * referenced only inside `if (__DEV__)` is dropped whole, which is why every other diagnostic in this
 * repo is written this way.
 *
 * Its DEV-only `@mount reportRestoredError` was the worse half. A lifecycle decorator registers from
 * an initializer, so in production every `Query` instance allocated an id, BOUND the empty method,
 * pushed an entry onto the runtime's mounts, and the flush then called it — per instance, not per
 * class, for a method that did nothing. The restored-error case now reports from the top of `load`,
 * which is an `@mount` that exists in every build.
 *
 * Takes what it needs rather than the instance: the read mask and the attached entry are the only
 * two things it looked at, and passing them keeps the private fields private.
 */
function reportIgnoredError(read: number, entry: QueryEntry<unknown> | undefined): void {
  if (!__DEV__) return;
  if (read & (Facet.Status | Facet.Error)) return;
  if (entry?.status !== "error") return;

  const reason = entry.error instanceof Error ? entry.error.message : String(entry.error);
  warnOnce(
    `[RMQ002] The query ${JSON.stringify(entry.key)} failed and nothing reads its failure: ${reason}\n` +
      `Read \`isError\`, \`error\`, \`status\` or \`result\` so the reader learns something went wrong — a ` +
      `failed refetch keeps the data it had, so the page may look fine while showing values nobody can refresh. ` +
      `If the failure means the page cannot be shown at all, return your own markup for it ` +
      `(\`if (q.isError) return <NotFound />\`) rather than letting an error boundary unmount the subtree.`,
  );
}
