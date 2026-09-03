import { Hook, created, createContext, destroyed } from "@ramonda/core";
import { announceClient, announceClientGone } from "./devtoolsBridge";
import { QueryClient } from "./QueryClient";
import type { QueryBehaviour } from "./types";

/**
 * What a provider publishes. One key, and it is the client itself: the cache is
 * not reactive, so there is nothing here to subscribe to per property the way the
 * router splits `baseUrl` from `queryParams`. Waking a component is an observer's
 * job (see `Query`), not the context's.
 */
interface QueryContextValue {
  client: QueryClient | null;
}

/**
 * `null` is the default rather than a freshly built client, and the difference
 * matters: a default client would be a MODULE-LEVEL cache, shared by every
 * concurrent server render — one visitor's data served to another, intermittently
 * and only under real traffic. So the absence of a provider is a null, and asking
 * for a client without one throws with instructions.
 */
const [ClientProvider, ClientConsumer] = createContext<QueryContextValue>({ client: null }, { label: "QueryClient" });

export { ClientConsumer };

/**
 * Every field is optional, and the props bag itself may be left out — so the
 * common case is `this.use(QueryClientProvider)` with nothing to configure. That
 * is why the hook is declared over `QueryClientProviderProps | undefined`: core's
 * no-props `use` overload asks for a constructor that accepts `undefined`, and a
 * bag of optional fields is not the same type as its own absence.
 */
export interface QueryClientProviderProps {
  /**
   * Bring your own client. The case this exists for is a server render that
   * prefetches before rendering — build the client, fill it, hand it in — and
   * tests, which want a client they can inspect.
   *
   * Read once. The client is the identity of the cache, so swapping it under a
   * live tree would leave every observer subscribed to entries in a cache nobody
   * reads; the same reason the router's navigator is stable for its lifetime.
   */
  client?: QueryClient;
  /** Applied to every query in this tree that does not set its own. */
  defaults?: QueryBehaviour;
}

/**
 * Owns the cache for one tree and publishes it to everything below.
 *
 * ```tsx
 * class App extends Component {
 *   private query = this.use(QueryClientProvider, () => ({
 *     defaults: { staleTime: 30_000 },
 *   }));
 *
 *   render() {
 *     return <div class="app"><RouteOutlet routes={routes} /></div>;
 *   }
 * }
 * ```
 *
 * **A hook, not a component**, for the reason every provider here is a hook: it
 * puts nothing on the page. Written as `<QueryClientProvider>{children}</…>` it
 * would be a tag that draws nothing, and a reader would have to know it was there
 * to know what it covers. A hook says that in the component that owns it.
 * `createContext` returns hooks for the same reason.
 */
export class QueryClientProvider extends Hook<QueryClientProviderProps | undefined> {
  /**
   * A plain field, deliberately NOT `@state` or `@persist`.
   *
   * Those two mean "serialize me into the hydration blob", and a client holds a
   * `Map`, `AbortController`s and in-flight promises — none of which survive JSON.
   * Core would warn about exactly that (hydration/serialize.ts), and the restored
   * value would be a broken shell. What crosses the boundary is each query's
   * DATA, carried by the observers; the cache that holds it is built fresh on each
   * side.
   */
  private readonly ownClient = this.props?.client ?? new QueryClient({ defaults: this.props?.defaults });

  /**
   * Mounted for its effect: publishing the client to every descendant. Nothing
   * reads this field.
   *
   * `protected` because that is the accurate visibility — a subclassed provider
   * should reach its own provider — and because TypeScript's language service
   * flags an unused *private* member. The router's `routeProvider` is the same
   * shape for the same reasons.
   */
  protected provider = this.use(ClientProvider, () => ({ client: this.ownClient }));

  /**
   * The client this provider owns, for the component that mounted it — a route
   * guard prefetching, a test asserting on the cache. Descendants reach it through
   * the context instead, via `Query` or `useQueryClient`.
   */
  get client(): QueryClient {
    return this.ownClient;
  }

  /**
   * Publishes this client to the devtools panel in a development build.
   *
   * `env: "client"` because there is no panel during a server render — and because a
   * long-lived server process would otherwise collect one client per request, since
   * `@destroyed` does not run there.
   *
   * An EVENT rather than a registration, and this package holds no list.
   *
   * A registration would mean importing the module that describes the panel, which would put it in
   * the bundle of every application using queries whether or not it ever opens one. Announcing
   * points the other way: `@ramonda/query/devtools` listens when an app has imported it, and
   * nothing happens when it has not. The same shape core uses for `ramonda:tick`.
   *
   * Both lines are behind `__DEV__`, so a production build carries neither — and neither a field
   * nor a method here, both of which would ship whatever the guard said.
   */
  @created({ env: "client" })
  publishToDevtools(): void {
    if (__DEV__) {
      announceClient(this.ownClient);
      /**
       * And answer whenever the panel asks again.
       *
       * Announcing once is not enough, and the reason is the order an app loads in. A provider
       * mounts during hydration, synchronously; `@ramonda/query/devtools` arrives through a dynamic
       * import, which resolves after. So the one announcement happened before anything was
       * listening, and the tab stayed empty for the life of the page — for the root provider always,
       * since it never mounts again.
       *
       * `this.republish` is a method, so it is bound once and the same reference reaches
       * `removeEventListener`.
       */
      window.addEventListener("ramonda:query-client-request", this.republish);
    }
  }

  /** Says what is here, for a panel that started listening after this provider mounted. */
  republish(): void {
    if (__DEV__) announceClient(this.ownClient);
  }

  @destroyed
  unpublishFromDevtools(): void {
    if (__DEV__) {
      window.removeEventListener("ramonda:query-client-request", this.republish);
      announceClientGone(this.ownClient);
    }
  }
}

/**
 * Reads the client from context, for imperative work: prefetching in a parent's
 * `@mounted`, invalidating after a mutation, seeding the cache.
 *
 * ```ts
 * private queries = this.use(QueryClientAccess);
 * // …
 * this.queries.client.invalidate(["user"]);
 * ```
 */
export class QueryClientAccess extends Hook {
  private ctx = this.use(ClientConsumer);

  get client(): QueryClient {
    return requireClient(this.ctx.client, this.constructor.name);
  }
}

/**
 * Turns the missing-provider case into an error that says what to do, rather than
 * a `TypeError` about a property of null from somewhere inside a getter.
 *
 * Throws rather than quietly building a client, because a query with nowhere to
 * cache is not a smaller version of a working query: two components asking for the
 * same key would each get their own answer, and the server's data would have
 * nowhere to be restored into.
 */
export function requireClient(client: QueryClient | null, readerName: string): QueryClient {
  if (client) return client;

  // `||`, not the name straight through: a class expression assigned to nothing has a
  // `constructor.name` of `""`, and `<> needs a QueryClientProvider` names nobody. The one caller
  // passes `this.constructor.name`, so this is the choke point for it.
  const subject = readerName || "a component";

  throw new Error(
    `[Ramonda Query] <${subject}> needs a QueryClientProvider above it. The cache belongs to a provider ` +
      `instance and reaches components through context — there is no global client to fall back on, because a ` +
      `module-level cache is shared by every request a server handles at once, and would serve one visitor's data ` +
      `to another. Add \`this.use(QueryClientProvider)\` to the component that wraps your app.`,
  );
}
