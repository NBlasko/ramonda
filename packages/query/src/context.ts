import { Hook, create, createContext, destroy } from "@ramonda/core";
import { registerDevtoolsClient } from "./devtoolsBridge";
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
 * **A hook, not a component**, for the reason every provider here is a hook: a
 * component is exactly one element, so `<QueryClientProvider>{children}</…>`
 * would cost a wrapper node that means nothing — and inside a `<tr>` or a
 * `<select>` that node is illegal HTML. `createContext` returns hooks for the same
 * reason.
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

  /** Set while this provider is registered with the devtools panel; DEV and client only. */
  private unpublish: (() => void) | undefined;

  /**
   * Publishes this client to the devtools panel in a development build.
   *
   * `env: "client"` because there is no panel during a server render — and because a
   * long-lived server process would otherwise collect one client per request, since
   * `@destroy` does not run there.
   *
   * The cleanup is stored and called from `@destroy` rather than returned: returning a
   * teardown is `createSubscriptionDecorator`'s contract, not `@create`'s,
   * which ignores what it is handed back. Measured the hard way — the registry grew by one
   * per test until the two halves were written out like this.
   */
  @create({ env: "client" })
  publishToDevtools(): void {
    if (__DEV__) this.unpublish = registerDevtoolsClient(this.ownClient);
  }

  @destroy
  unpublishFromDevtools(): void {
    this.unpublish?.();
    this.unpublish = undefined;
  }
}

/**
 * Reads the client from context, for imperative work: prefetching in a parent's
 * `@mount`, invalidating after a mutation, seeding the cache.
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

  throw new Error(
    `[Ramonda Query] <${readerName}> needs a QueryClientProvider above it. The cache belongs to a provider ` +
      `instance and reaches components through context — there is no global client to fall back on, because a ` +
      `module-level cache is shared by every request a server handles at once, and would serve one visitor's data ` +
      `to another. Add \`this.use(QueryClientProvider)\` to the component that wraps your app.`,
  );
}
