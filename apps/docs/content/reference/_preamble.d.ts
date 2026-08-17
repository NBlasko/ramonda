// The reference pages point at one API at a time, so they name the reader's schema and their own
// components without building either.
export {};

declare global {
  interface Signup {
    email: string;
    password: string;
  }
  class List extends Hook<any> {
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
