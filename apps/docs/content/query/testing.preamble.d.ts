// This page builds its own `mount()` helper in one block and uses it in the next. `mount` is also a
// Ramonda lifecycle decorator, and here the page means its helper — which is what a page-level
// preamble is for.
export {};

declare global {
  const mount: (...args: any[]) => {
    client: {
      peek<T>(key: unknown[]): { data?: T } | undefined;
      setData<T>(key: unknown[], value: T): void;
      invalidate(key: unknown[]): void;
    };
    [key: string]: any;
  };
}
