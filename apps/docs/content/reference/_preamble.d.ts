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
  const sessionKey: RequestKey<unknown>;
}
