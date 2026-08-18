export declare class Component {
  protected use<T>(hook: T, options?: unknown): unknown;
  render(): unknown;
}
export declare class Hook {
  protected use<T>(hook: T, options?: unknown): unknown;
}
/** The type that says "a component goes here" — what a slot is declared with. */
export interface ComponentClassKind<P = unknown> {
  new (): Component;
  props?: P;
}
/**
 * A rendered node, which CARRIES a component class — the shape a slot walk must not follow.
 *
 * Measured in `@ramonda/core`: a walk that hunted for the marker anywhere found eight slots that
 * are not slots, `RamondaNode.name` among them. A prop typed as a node is one the caller already
 * wrote; a slot is one the caller fills.
 */
export interface RamondaNode {
  name: ComponentClassKind;
}
export declare function createContext<T>(
  d: T,
  o?: { label?: string; optional?: boolean; single?: boolean },
): [unknown, unknown];
export declare function createRoutes(table: unknown): unknown;
export declare function bootstrap(vnode: unknown, el: unknown): void;
/** The server's entries. A tree starts here as much as it does at `bootstrap`. */
export declare function renderToString(vnode: unknown): Promise<string>;
export declare function renderPage(vnode: unknown): Promise<{ body: string }>;
export declare function list<T>(each: T[], render: (item: T) => unknown): unknown;
export declare function catchError(value: unknown, context: unknown): void;
export declare function Host(tag: string, props?: unknown): (ctor: unknown) => void;
export declare function ShouldUpdateOnPropsChange(decide: unknown): (ctor: unknown) => void;
export declare function StableProps(...keys: string[]): (ctor: unknown) => void;
export declare function state(value: unknown, context: unknown): void;
export declare function compute(value: unknown, context: unknown): void;

/** The form's two hooks, as much of them as a fixture needs. */
export declare class Form<S> {
  fields: any;
}
export declare class Field<T> {
  value: T;
  error?: string;
  bind: Record<string, unknown>;
  set(next: T): void;
}

/** Per-request data. Live only while the render is running — see the late-request rule. */
export interface RequestKey<T> {
  readonly label: string;
  readonly __type?: T;
}
export declare function requestKey<T>(label: string, options?: { exposeToClient?: boolean }): RequestKey<T>;
export declare function requestContext(): {
  readonly url: { pathname: string };
  readonly headers: { get(name: string): string | null };
  readonly cookies: { get(name: string): string | undefined; has(name: string): boolean };
  get<T>(key: RequestKey<T>): T;
};

/**
 * The lifecycle and effect decorators, as much of them as a fixture needs.
 *
 * FUNCTIONS rather than classes, deliberately: `framework-head.ts` exists because adding a hook
 * CLASS here moved three fixtures' component counts, and a declaration nothing constructs cannot.
 *
 * `env` is the whole point of the three at the top for `client-only-request-read`: the lifecycle
 * family defaults to `shared` and runs on both sides, and only `{ env: "client" }` narrows it.
 */
export declare function created(options?: { env?: "shared" | "client" | "server" }): (...args: unknown[]) => void;
export declare function mounted(options?: { env?: "shared" | "client" | "server" }): (...args: unknown[]) => void;
export declare function destroyed(options?: { env?: "shared" | "client" | "server" }): (...args: unknown[]) => void;
export declare function updated(value: unknown, context: unknown): void;
export declare function deferHydration(value: unknown, context: unknown): void;
export declare function interval(ms: string | number): (...args: unknown[]) => void;
export declare function timeout(ms: string | number): (...args: unknown[]) => void;
export declare function onWindow(type: string): (...args: unknown[]) => void;
export declare function onDocument(type: string): (...args: unknown[]) => void;
export declare function onElement(type: string): (...args: unknown[]) => void;
