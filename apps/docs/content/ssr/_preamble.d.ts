// A server, a route table and the pages it renders — plus the store an ISR example bakes into.
export {};

declare global {
  // These stand in for the READER's server, routes and loaders. They are deliberately `any`: their
  // shape is not what these pages teach, and a type written here would only be a second, wrong copy
  // of one that lives in the app.

  class About extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Account extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Table extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Cards extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Chart extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class RealChart extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Skeleton extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Client extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Server extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  interface User {
    id: string;
    name: string;
  }
  const currentUser: RequestKey<{ name: string; id: string }>;
  const getUser: (...args: any[]) => any;
  const resolveUser: (...args: any[]) => any;

  const routes: any;
  const createRoutes: (...args: any[]) => any;
  const defineServer: (...args: any[]) => any;
  const server: any;
  const req: { url?: string; headers: Record<string, string | undefined> };
  /** The reader's own loader, for the late-read example. */
  const fetchPosts: () => Promise<unknown[]>;
  const write: any;
  const extra: any;
  const needsData: any;

  /** The ISR cache in the modes page — the client the example's store is written over. */
  const redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    del(key: string): Promise<void>;
  };
  const bakePath: (path: string) => Promise<string>;
}
