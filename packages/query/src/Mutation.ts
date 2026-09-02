import { Hook, INSPECT, destroyed, StableProps, state } from "@ramonda/core";
import { ClientConsumer, requireClient } from "./context";
import type { QueryClient } from "./QueryClient";
import type { QueryKey } from "./types";
import { asError } from "./errors";

/** Where a mutation is in its one round trip. */
export type MutationStatus = "idle" | "pending" | "success" | "error";

/**
 * What a mutation's callbacks are handed.
 *
 * The client is passed in rather than closed over so a handler can invalidate,
 * write, or read the cache without the component having to reach for the provider
 * itself.
 */
export interface MutationContext {
  client: QueryClient;
}

/**
 * Undoes an optimistic update. Returned by `onMutate`, called if the mutation
 * fails — the same "return the cleanup" contract
 * `createSubscriptionDecorator` use, so it is one idea to learn rather than three.
 */
export type Rollback = (() => void) | void;

export interface MutationProps<TData, TVars> {
  /** The write itself. Forward `ctx.signal` if the transport can be cancelled. */
  mutate: (vars: TVars, ctx: MutationContext & { signal: AbortSignal }) => Promise<TData>;
  /**
   * Runs BEFORE the request, for an optimistic update.
   *
   * Return a function and it becomes the rollback, called if the mutation fails:
   *
   * ```ts
   * onMutate: (todo, { client }) => {
   *   const previous = client.peek<Todo[]>(["todos"])?.data;
   *   client.setData<Todo[]>(["todos"], (todos) => [...(todos ?? []), todo]);
   *   return () => client.setData(["todos"], previous);
   * }
   * ```
   *
   * `setData` abandons a fetch already in flight (see `QueryClient.setData`), so an
   * optimistic write cannot be undone moments later by a response that was already
   * on its way.
   */
  onMutate?: (vars: TVars, ctx: MutationContext) => Rollback;
  onSuccess?: (data: TData, vars: TVars, ctx: MutationContext) => void;
  onError?: (error: Error, vars: TVars, ctx: MutationContext) => void;
  /** Runs after success and after failure, for the spinner nobody wants to leave up. */
  onSettled?: (vars: TVars, ctx: MutationContext) => void;
  /**
   * Keys to invalidate once the mutation succeeds, by prefix — `[["todos"]]` reaches
   * `["todos", 1]` and `["todos", { done: true }]`.
   *
   * The common case, written declaratively so it cannot be forgotten in one of
   * several `onSuccess` branches. Invalidating marks the data stale and asks whoever
   * is watching to refetch; it does not blank the screen while that happens.
   */
  invalidates?: readonly QueryKey[];
}

/**
 * A write, with the state a UI needs while it is in flight.
 *
 * ```tsx
 * class AddTodo extends Component {
 *   private add = this.use(Mutation<Todo, string>, (self: AddTodo) => ({
 *     mutate: (title, { signal }) => api.createTodo(title, { signal }),
 *     onSuccess: (todo, title, { client }) => client.setData(["todo", todo.id], todo),
 *     invalidates: [["todos"]],
 *   }));
 *
 *   submit(event: SubmitEvent) {
 *     event.preventDefault();
 *     this.add.mutate(this.title);
 *   }
 *
 *   render() {
 *     return (
 *       <form onsubmit={this.submit}>
 *         <button disabled={this.add.isPending}>Add</button>
 *       </form>
 *     );
 *   }
 * }
 * ```
 *
 * ## Naming the two types
 *
 * `Mutation<Todo, string>` names what the write returns and what it takes, and every
 * callback follows from it: `mutate`'s `title` is a string, `onSuccess`'s `todo` is a
 * `Todo`, and `onMutate`/`onError`/`onSettled` are typed the same way with nothing
 * written on them. It matters more here than on a query, because a mutation usually
 * carries three or four callbacks that would otherwise each need an annotation.
 *
 * Left off, `TData` is inferred from `mutate`'s return and `TVars` from its first
 * parameter — so that parameter has to be annotated (`mutate: (title: string) => …`),
 * and so does every context a sibling callback reads (`{ client }: MutationContext`).
 *
 * ## Why its state is not in the cache
 *
 * A query is a question, and two components asking it share one answer — that
 * sharing is what the cache is for. A mutation is an ACT: two components each with
 * an "add todo" button are performing two different acts, and neither should show
 * the other's spinner or the other's error. So the state lives on the hook, and
 * nothing is keyed.
 */
/**
 * `invalidates` is a list of keys, so it is a value for the same reason a key is — see
 * `Query`. Declared here so `invalidates: [["todos"]]` at a call site is one identity
 * rather than a fresh array every render.
 */
@StableProps("invalidates")
export class Mutation<TData, TVars = void> extends Hook<MutationProps<TData, TVars>> {
  private ctx = this.use(ClientConsumer);

  /**
   * The status, and the only reactive field here.
   *
   * A string, so it is JSON and survives the hydration blob. It will always be
   * `"idle"` in one, because a mutation is a write and a server render never starts
   * one — but a field that COULD carry something unserializable is a warning
   * waiting for the first person whose mutation returns a `Response`.
   */
  @state private status: MutationStatus = "idle";
  /**
   * Bumped on every settle, so two successes in a row still re-render.
   *
   * `status` alone does not: the second success writes `"success"` over `"success"`,
   * the signal compares equal, and nothing re-renders while `data` has changed
   * underneath. The same trap `AsyncLoad`'s counter documents from the hydration
   * side.
   */
  @state private version = 0;

  /**
   * The result and the failure, deliberately NOT `@state`.
   *
   * Both are whatever the app's transport produced — a parsed body, an `Error`, a
   * class instance — and `@state` means "serialize me into the hydration blob",
   * which for an `Error` yields `{}` and for anything exotic yields a warning. They
   * are read during the render that `version` scheduled, and `AsyncLoad.failure` is
   * the same shape for the same reason.
   */
  private lastData?: TData;
  private lastError?: Error;
  /** Identifies the mutation in flight, so an earlier one cannot land over a later one. */
  private runId = 0;
  private controller?: AbortController;
  private disposed = false;

  /**
   * What the devtools panel shows for this mutation.
   *
   * `status` is `@state` and visible already; `lastData` and `lastError` are plain fields behind
   * `version`, for the reason recorded above them — so the panel could see that something had
   * happened without ever seeing WHAT. See `INSPECT`.
   */
  [INSPECT](): Record<string, unknown> {
    return {
      data: this.lastData,
      // Serialised here rather than handed over raw: an Error survives the panel's value tree as
      // `{}`, which reads as "no error" beside a status that says otherwise.
      error: this.lastError ? `${this.lastError.name}: ${this.lastError.message}` : undefined,
      isInFlight: this.controller !== undefined,
    };
  }

  private get client(): QueryClient {
    return requireClient(this.ctx.client, "Mutation");
  }

  private get context(): MutationContext {
    return { client: this.client };
  }

  /**
   * Runs the mutation. Never rejects — the failure is `this.error`.
   *
   * This is the one to call from a click handler: an unhandled rejection in a
   * button's `onClick` is a console error the user cannot act on, and a mutation
   * that failed is a state to render. Use `mutateAsync` when the CALLER needs to
   * know, and then handle the rejection.
   */
  mutate(vars: TVars): void {
    this.requireProvider();

    void this.run(vars).catch(() => {
      // Swallowed on purpose: `run` has already recorded the failure and called
      // `onError`. This catch exists so the promise nobody awaited does not become
      // an unhandled rejection.
    });
  }

  /** Like `mutate`, but the promise resolves with the data and rejects on failure. */
  mutateAsync(vars: TVars): Promise<TData> {
    this.requireProvider();
    return this.run(vars);
  }

  /**
   * Reaches for the client HERE, outside the async body, so a missing provider
   * throws at the call site.
   *
   * An `async` function turns a synchronous throw into a rejected promise, and
   * `mutate` swallows rejections on purpose (they are already recorded as
   * `this.error`). So a mutation with no `QueryClientProvider` above it used to do
   * nothing at all: no throw, no log, no state change — measured, and the reason
   * this line exists rather than trusting `run` to hit the same getter one
   * statement later.
   *
   * Deliberately in `mutateAsync` too. A missing provider is a wiring mistake, not
   * a request that failed, and it should not arrive as a rejection to be handled
   * beside a real one.
   */
  private requireProvider(): void {
    void this.client;
  }

  private async run(vars: TVars): Promise<TData> {
    const runId = ++this.runId;
    const controller = new AbortController();
    this.controller = controller;

    const rollback = this.props.onMutate?.(vars, this.context);

    this.lastError = undefined;
    this.status = "pending";
    this.version++;

    try {
      const data = await this.props.mutate(vars, { client: this.client, signal: controller.signal });

      // A second call started while this one was in flight owns the state now.
      // Recording this one's result would show the older answer as the current one.
      if (this.runId !== runId || this.disposed) return data;

      this.lastData = data;
      this.status = "success";
      this.version++;

      for (const key of this.props.invalidates ?? []) {
        this.client.invalidate(key);
      }
      this.props.onSuccess?.(data, vars, this.context);
      this.props.onSettled?.(vars, this.context);

      return data;
    } catch (thrown) {
      // One shape for a failure, the same one a Query stores — see `asError`. The original is on
      // `cause`, which is what an `onError` inspecting a thrown object reaches for.
      const error = asError(thrown);

      // The rollback runs even for a superseded or unmounted mutation: it undoes a
      // write to the CACHE, which outlives this hook, and leaving an optimistic
      // value in there because the component went away is how a list ends up
      // showing a todo the server rejected.
      if (typeof rollback === "function") rollback();

      if (this.runId === runId && !this.disposed) {
        this.lastError = error;
        this.status = "error";
        this.version++;
        this.props.onError?.(error, vars, this.context);
        this.props.onSettled?.(vars, this.context);
      }

      throw error;
    }
  }

  /**
   * Forgets the last result, putting the hook back to `"idle"`.
   *
   * For a form that has shown its error and is being tried again, where leaving
   * `isError` set would keep a stale message under a field the user has since fixed.
   */
  reset(): void {
    this.lastData = undefined;
    this.lastError = undefined;
    this.status = "idle";
    this.version++;
  }

  /**
   * Aborts the request in flight, if the transport honours the signal.
   *
   * Not called on unmount, and that is the point: a write that has left is not
   * something to cancel because the button that started it went away — the server
   * may well have applied it, and cancelling only loses the confirmation. What
   * unmounting does stop is the STATE writing back into a dead hook.
   */
  cancel(): void {
    this.controller?.abort();
  }

  @destroyed
  dispose(): void {
    this.disposed = true;
  }

  get isIdle(): boolean {
    void this.version;
    return this.status === "idle";
  }

  get isPending(): boolean {
    void this.version;
    return this.status === "pending";
  }

  get isSuccess(): boolean {
    void this.version;
    return this.status === "success";
  }

  get isError(): boolean {
    void this.version;
    return this.status === "error";
  }

  /**
   * What the last successful mutation returned.
   *
   * `version` is read first in each of these so a render depends on the counter as
   * well as on the status — `data` changing between two successes moves nothing
   * else, and without the read this getter would be served from a render that never
   * happened.
   */
  get data(): TData | undefined {
    void this.version;
    return this.lastData;
  }

  /** What the last failed mutation rejected with. */
  get error(): Error | undefined {
    void this.version;
    return this.lastError;
  }
}
