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
export declare const h: (...a: unknown[]) => unknown;
