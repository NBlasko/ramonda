import type { HOOK_RUNTIME, HookRuntime, INTERNAL_HOOKS, Runtime, GLOBAL_RUNTIME } from "../core/runtime";

export type HookProps = Record<string, any> | undefined;

/**
 * What a `use()` says ABOUT a hook, as opposed to what it passes INTO one.
 *
 * The third argument to `this.use()`, and separate from the props for one reason: a hook's props
 * belong to whoever wrote the hook. A framework that reserved a word in there — `label`, say —
 * would collide with a real one sooner or later, and on a form it collides immediately, because a
 * form is full of labels. Nothing here is passed to the hook, which never sees it.
 *
 * Development-only and cosmetic. A production build stores none of it.
 */
export interface HookMeta {
  /**
   * What to call this hook in devtools, added to its class name: `Form (Sign Up)`.
   *
   * A hook cannot name itself — `this.constructor.name` is `Form` for every form on the page — so
   * two `this.use(Form, …)` in one component are two nodes with one name, and a panel listing them
   * can only number them. This is where the distinguishing name can come from, because a `use()`
   * call is the one place that knows which of the two it is.
   *
   * ```tsx
   * private signup = this.use(Form<typeof schema>, { schema, defaultValues, onSubmit }, { label: "Sign Up" });
   * ```
   *
   * Added rather than substituted: the class says WHAT the node is, which a label cannot recover,
   * and the label says WHICH one, which the class cannot give.
   */
  label?: string;
}

/**
 * Where a `use()`'s metadata lives on the hook instance.
 *
 * Registered rather than unique, so a package that wants to read it — `@ramonda/form`'s panel, or
 * anybody else's — can reach it with `Symbol.for("ramonda.hook.meta")` and no import at all. The
 * same contract shape as the diagnostics sink: a well-known key, honoured by nothing being imported.
 */
export const HOOK_META = Symbol.for("ramonda.hook.meta");

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
 * Four parameter types were measured for that overload:
 *
 * - `any` — works, and makes an UNANNOTATED `(self) => …` a silent `any`.
 * - `never` — works, and makes it a hard error instead
 *   (`Property 'props' does not exist on type 'never'`), so the owner's type had
 *   to come from ANNOTATING the parameter. It left a hole: `never` accepts any
 *   function, so a callback written for one class and handed to another passed
 *   silently — a shared `(self: Panel) => ({ fetch: self.load })` used on a class
 *   with no `load` compiled.
 * - `this` — unusable on its own. Resolving an overload needs the argument's
 *   type, which needs the arrow's contextual type, which needs the class's `this`
 *   type, which is the class whose field is being declared: TS7022 circularity on
 *   every call site, generic hook or not. Measured again before the change below,
 *   and it still holds.
 * - **`S extends this = this`** — what is here. `S` is inferred from the CALLBACK
 *   and only then checked against `this`, so the field initializer never has to
 *   resolve `this` to find the argument's type and the circle does not close.
 *
 * So an unannotated parameter is typed as the owner, a member that does not exist
 * is reported by name, and a callback annotated with the wrong class is refused.
 * `HookPropsSelf.test.tsx` holds all three with `@ts-expect-error`.
 *
 * `S` defaults to `never` on the type itself, which is what the implementation
 * signature uses — it takes either form and needs neither checked.
 */
export type PropsFactory<Q, S = never> = (self: S) => Q;

/**
 * A type-only carrier for a hook's props type.
 *
 * `Hook.props` is `protected`, which makes it invisible to a conditional type — so
 * `This extends { props: infer P }` yields `never` for a hook, and a decorator cannot read
 * the props type off the instance the way it can for a component (whose `props` is public
 * on `BaseComponent`). This phantom fixes that without changing the surface: it is
 * `declare`d, so it emits nothing; symbol-keyed, so it cannot collide or show up in
 * autocomplete; and optional, so nothing has to assign it.
 *
 * It is what lets `@watchProp` type its selector from the class it is placed on.
 */
export declare const PROPS_TYPE: unique symbol;

// The type parameter is a phantom (a variance marker only — callers write
// `BaseHook<T>`, nothing in the body reads it). Named `_`-prefixed so it is not
// mistaken for the `HookProps` type above and is understood as intentionally
// unbound.
export declare class BaseHook<_Options> {
  public [GLOBAL_RUNTIME]: Runtime;
  public [INTERNAL_HOOKS]?: (() => void)[];
  public [HOOK_RUNTIME]: HookRuntime;
}
