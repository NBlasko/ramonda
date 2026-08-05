// What a test file has around it: the query helpers a render returns, and the reader's own
// component and loader under test.
export {};

declare global {
  class Counter extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  /** A test config file reads `process.env`; the harness page shows one. */
  const process: { env: Record<string, string | undefined> };

  class CounterHook extends Hook<{ start: number }> {
    [key: string]: any;
  }
  const defineConfig: (...args: any[]) => any;
  const getByText: (...args: any[]) => any;
  const instance: any;
  const result: any;
  const loadUser: (...args: any[]) => any;
  const getUser: (...args: any[]) => any;
  const waitFor: (...args: any[]) => any;
}
