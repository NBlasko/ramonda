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
  const sessionKey: RequestKey<unknown>;
}
