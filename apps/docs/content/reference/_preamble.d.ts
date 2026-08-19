// The reference pages point at one API at a time, so they name the reader's schema and their own
// components without building either.
export {};

declare global {
  /**
   * What the build page's environment example assumes: Node's `process`, the reader's own database
   * connect, and a component of theirs that takes a URL. None of the three is Ramonda's, and naming
   * them here is what keeps the example about the variables.
   */
  const process: { env: Record<string, string | undefined> };
  const connect: (url: string | undefined) => void;
  class Feed extends Component<{ from: string }> {
    [key: string]: any;
    render(): any;
  }
  /** The app's own declaration of what it reads — shown on the build page, and needed to type it. */
  interface ImportMetaEnv {
    readonly RAMONDA_PUBLIC_API_BASE: string;
  }
  interface Signup {
    email: string;
    password: string;
  }
  class List extends Hook<any> {
    [key: string]: any;
  }
  /** The reader's own hook, for the RMD055 examples. */
  class Counter extends Hook<any> {
    [key: string]: any;
  }
  const f: any;
  const register: (...args: any[]) => any;
  /** The reader's own lookup, for the async-validation examples. */
  const taken: (value: string) => Promise<boolean>;
  /** A module path the reader computed, for the dynamic-import examples on the check page. */
  const specifier: string;
  const sessionKey: RequestKey<unknown>;
  /** The reader's own request key and their own loader, for the RMD053 examples. */
  const currentUser: RequestKey<string>;
  const fetchPosts: () => Promise<unknown[]>;
}
