// A hook of the reader's own, its props, and the store a custom decorator subscribes to.
export {};

declare global {
  interface PaginationProps {
    total: number;
    perPage: number;
  }
  interface FetchContext {
    signal: AbortSignal;
  }
  interface QueryProps<T = unknown> {
    key: unknown[];
    fetch: (ctx: FetchContext) => Promise<T>;
  }
  class Filtered extends Hook<any> {
    [key: string]: any;
  }
  class Resource extends Hook<any> {
    [key: string]: any;
  }
  class Toggle extends Hook<any> {
    [key: string]: any;
  }
  class SomeChart extends Hook<any> {
    [key: string]: any;
  }
  class UserCard extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  const counter: { count: number; increment(): void };
  const handler: (...args: unknown[]) => void;

  /** A store outside Ramonda — what a custom subscription decorator attaches to. */
  interface ThemeState {
    theme: "light" | "dark";
  }
  interface ThemeStore {
    getState(): ThemeState;
    /** Either shape: some stores hand back a function, some an object. Adapting the two is what
     *  the custom-decorator page is about. */
    subscribe(listener: (state: ThemeState) => void, ...rest: any[]): (() => void) & { unsubscribe(): void };
  }
  const store: ThemeStore;
  const themeStore: ThemeStore;

  /** The decorator these pages build. Shaped as a modern method decorator, or `@onStore(store)`
   *  lands in decorator position as `any` and TypeScript falls back to the legacy form. */
  const onStore: (...args: any[]) => <T>(value: T, context: ClassMethodDecoratorContext) => T | void;

  /**
   * The routing kit, for the example showing a hook using another hook.
   *
   * Destructured from the factory rather than imported: `Link` and `Navigator` are bound to an
   * app's own route table and reachable only through `createRouter`. Declared here, not as globals,
   * because `lib.dom` already owns the name `Navigator`.
   */
  class RouterNavigator extends Hook<any> {
    [key: string]: any;
  }
  const routes: any;
  const createRouter: (routes: any) => {
    Router: any;
    RouteOutlet: any;
    Navigator: typeof RouterNavigator;
    Link: any;
    route: (...args: any[]) => any;
  };
}
