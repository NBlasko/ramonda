export declare class Component {
  protected use<T>(hook: T): unknown;
  render(): unknown;
}
export declare class Hook {
  protected use<T>(hook: T): unknown;
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
