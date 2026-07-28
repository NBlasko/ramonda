import type { MutationProps } from "./Mutation";
import type { QueryProps } from "./Query";
import type { QueryKey } from "./types";

/**
 * Wraps a query's options so **sibling callbacks get their parameter types**.
 *
 * ## The problem it solves
 *
 * `this.use(Query, () => ({ … }))` infers `TData` from `fetch`, which is the point
 * of the inline API and works:
 *
 * ```ts
 * private user = this.use(Query, () => ({
 *   key: ["user", id],
 *   fetch: async (): Promise<User> => api.getUser(id),
 * }));
 * this.user.data;  // User | undefined  ✓
 * ```
 *
 * But the props object is what `Q` is INFERRED FROM, not something checked against
 * a target type — so nothing flows back into it, and a callback parameter that was
 * not annotated has no contextual type:
 *
 * ```ts
 * fetch: ({ signal }) => …          // ✗ 'signal' implicitly has an 'any' type
 * fetch: ({ signal }: FetchContext) => …   // ✓ annotate, and it is fine
 * ```
 *
 * Passing the object through here reverses the direction: it is CHECKED against
 * `QueryProps<TData, K>` with `TData` inferred from `fetch`'s return type, which is
 * exactly the arrangement that gives every other property a contextual type.
 *
 * ```ts
 * private todo = this.use(Query, () =>
 *   queryOptions({
 *     key: ["todo", id],
 *     fetch: ({ signal, key }) => api.getTodo(key[1], { signal }),  // both typed
 *   }),
 * );
 * ```
 *
 * ## Which to use
 *
 * Annotating one parameter is shorter, and for a query with only `key` and `fetch`
 * it is all you need. Reach for this when the options are worth naming — a query
 * shared between components, or one with several callbacks that would each need an
 * annotation.
 *
 * It is a no-op at runtime: it returns its argument, and exists entirely for the
 * type checker.
 */
export function queryOptions<TData, K extends QueryKey>(options: QueryProps<TData, K>): QueryProps<TData, K> {
  return options;
}

/**
 * The same thing for a mutation, and it earns its keep sooner: a mutation usually
 * has `onSuccess`, `onError` and `onSettled` beside `mutate`, and each of those
 * would otherwise need its parameters annotated.
 *
 * ```ts
 * private add = this.use(Mutation, () =>
 *   mutationOptions({
 *     mutate: (title: string) => api.createTodo(title),
 *     onSuccess: (todo, title, { client }) => client.setData(["todo", todo.id], todo),
 *     invalidates: [["todos"]],
 *   }),
 * );
 * ```
 *
 * `TVars` still comes from `mutate`'s first parameter, so annotate that one — it is
 * the input nothing else can tell you.
 */
export function mutationOptions<TData, TVars>(options: MutationProps<TData, TVars>): MutationProps<TData, TVars> {
  return options;
}
