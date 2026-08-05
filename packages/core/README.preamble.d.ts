// The reader's own components, for the examples in this README.
export {};

declare global {
  /** The value about to be written, in a `@watchProp` or a setter example. */
  const next: any;

  class App extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Row extends Component<{ item: any }> {
    [key: string]: any;
    render(): any;
  }
  class RowView extends Component<{ item: any }> {
    [key: string]: any;
    render(): any;
  }
  class Counter extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Card extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  const For: ComponentClassKind<{ each: unknown[]; as: unknown }>;
  const items: unknown[];
  const api: Record<string, (...args: any[]) => Promise<any>>;
}
