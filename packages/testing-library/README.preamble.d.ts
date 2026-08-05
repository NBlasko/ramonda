export {};

declare global {
  class App extends Component<any> {
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
  class CounterHook extends Hook<{ start: number }> {
    [key: string]: any;
  }
  const defineConfig: (...args: any[]) => any;
  const getByText: (...args: any[]) => any;
  const instance: any;
  const loadUser: (...args: any[]) => any;
}
