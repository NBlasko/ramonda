import type { HOOK_RUNTIME, HookRuntime, INTERNAL_HOOKS, Runtime, GLOBAL_RUNTIME } from "../core/runtime";

export type HookProps = Record<string, any> | undefined;

/**
 * The callback form of `this.use(Hook, props)` — re-run on every owner render,
 * which is what keeps a hook's props in step with the owner's data.
 *
 * **The parameter is `never`, and that is load-bearing.** It used to be `this`,
 * folded into one union parameter (`props: Q | R` with `R extends (bag: this) =>
 * Q`), and that shape cannot type a GENERIC hook class. `HookProps` is
 * `Record<string, any> | undefined`, and a function is assignable to
 * `Record<string, any>` — so with no fixed candidate for `Q` from the
 * constructor, TypeScript infers `Q` as the CALLBACK ITSELF:
 *
 *   Type '(self: UserCard) => { key: string[]; fetch: … }'
 *     is not assignable to type 'QueryProps<unknown>'
 *
 * A non-generic hook never hit this: its constructor pins `Q`, which outvotes
 * the callback. `@ramonda/query`'s `Query<TData>` has no such anchor, so the
 * callback has to live in its own overload for `Q` to be inferred from the
 * RETURN type — and from there `TData` follows out of the `fetch` prop, with
 * nothing declared at the call site.
 *
 * Three parameter types were measured for that overload:
 *
 * - `this` — unusable. Resolving an overload needs the argument's type, which
 *   needs the arrow's contextual type, which needs the class's `this` type,
 *   which is the class whose field is being declared: TS7022 circularity on
 *   every call site, generic hook or not.
 * - `any` — works, and makes an UNANNOTATED `(self) => …` a silent `any`.
 * - `never` — works, and makes it a hard error instead
 *   (`Property 'props' does not exist on type 'never'`). The same reason
 *   `createSubscriptionDecorator` constrains its handler with `never[]`, and the
 *   same stance `@watchProp` takes: strict, never `any`.
 *
 * So the owner's type comes from ANNOTATING the parameter — `(self: Panel) =>
 * ({ … })` — which is how every call site in the framework and its docs already
 * writes it.
 */
export type PropsFactory<Q> = (bag: never) => Q;

// The type parameter is a phantom (a variance marker only — callers write
// `BaseHook<T>`, nothing in the body reads it). Named `_`-prefixed so it is not
// mistaken for the `HookProps` type above and is understood as intentionally
// unbound.
export declare class BaseHook<_Options> {
  public [GLOBAL_RUNTIME]: Runtime;
  public [INTERNAL_HOOKS]?: (() => void)[];
  public [HOOK_RUNTIME]: HookRuntime;
}
