// A todo list and a user, which every query example fetches, plus the client the reader holds.
export {};

declare global {
  interface Todo {
    id: string;
    title: string;
  }
  interface User {
    id: string;
    name: string;
  }
  interface FetchContext {
    signal: AbortSignal;
  }
  class TodoCard extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class UserCard extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class PostPage extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class PostRow extends Component<{ item: { id: string; title: string } }> {
    [key: string]: any;
    render(): any;
  }

  const client: {
    peek<T>(key: unknown[]): { data?: T } | undefined;
    setData<T>(key: unknown[], value: T | ((previous: T | undefined) => T)): void;
    invalidate(key: unknown[]): void;
    remove(key: unknown[]): void;
  };
  const loadTodos: (...args: any[]) => any;
  const loadThing: (...args: any[]) => any;
  const payload: string;
  const title: string;
  const page: number;
  const tag: string;
  const waitFor: (...args: any[]) => any;
}
