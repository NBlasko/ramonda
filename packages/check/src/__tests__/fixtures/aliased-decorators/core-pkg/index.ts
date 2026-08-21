/**
 * A stub that really is a PACKAGE called `@ramonda/core`, `package.json` and all.
 *
 * `fixtures/framework.ts` cannot be one: it sits inside `packages/check`, so anything declared there
 * belongs to `@ramonda/check`. That is fine for the specifier test — a fixture importing
 * `"@ramonda/core"` names core whatever the mapping points at — and not fine for the question a
 * STAR re-export forces, which is answered by where the declaration lives rather than by any
 * specifier. See `declaredInsideCore` in `rules/core-import.ts`.
 */
export declare class Component<P = Record<string, unknown>> {
  props: P;
  protected use<T>(hook: T, options?: unknown): unknown;
  render(): unknown;
}
export declare function Host(tag: string, props?: unknown): (ctor: unknown) => void;
export declare function bootstrap(vnode: unknown, el: unknown): void;
export declare function state(value: unknown, context: unknown): void;
export declare function created(value: unknown, context?: unknown): unknown;
