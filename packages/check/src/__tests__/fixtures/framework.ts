export declare class Component {
  protected use<T>(hook: T): unknown;
  render(): unknown;
}
export declare class Hook {
  protected use<T>(hook: T): unknown;
}
export declare function createContext<T>(d: T, o?: { label?: string }): [unknown, unknown];
export declare function bootstrap(vnode: unknown, el: unknown): void;
export declare function list(options: { each: unknown[]; as?: unknown }): unknown;
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
