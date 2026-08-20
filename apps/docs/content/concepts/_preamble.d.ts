// The reader's own props, state and store, for the pages that teach one decorator at a time.
export {};

declare global {
  class Counter extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  /** The value about to be written, in a `@watchProp` or a setter example. */
  const next: any;

  interface CardProps {
    title: string;
    subtitle?: string;
    /** The tag the card renders as — the `@Host` page picks it off the props. */
    as?: string;
  }
  class Spinner extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  /** A row's data, and the component that draws one — the caching page compares one value against one per row. */
  interface RowItem {
    id: string;
    name: string;
  }
  class RowView extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  /** A store outside Ramonda — the thing `@onStore` and a custom decorator subscribe to. */
  interface ThemeState {
    theme: "light" | "dark";
  }
  interface ThemeStore {
    getState(): ThemeState;
    /** Either shape: some stores hand back a function, some an object. Adapting the two is what
     *  the custom-decorator page is about. */
    subscribe(listener: (state: ThemeState) => void, ...rest: any[]): (() => void) & { unsubscribe(): void };
  }
  const themeStore: ThemeStore;
  /** The decorator this page builds. Shaped as a modern method decorator, or `@onStore(store)`
   *  lands in decorator position as `any` and TypeScript falls back to the legacy form. */
  const onStore: (...args: any[]) => <T>(value: T, context: ClassMethodDecoratorContext) => T | void;

  /** `env` on a lifecycle decorator takes one of these. */
  type RenderEnv = "client" | "server";

  const title: string;
  const subtitle: string;
}
