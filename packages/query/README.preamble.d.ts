// A todo list, which every example here fetches and mutates.
export {};

declare global {
  interface Todo {
    id: string;
    title: string;
  }
  class TodoCard extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class App extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  const api: Record<string, (...args: any[]) => Promise<any>>;
  const id: string;
}
