// This page builds a `Counter` HOOK, block by block. Elsewhere on the site `Counter` is a
// component, so the name is claimed here and only here.
export {};

declare global {
  class Counter extends Hook<any> {
    [key: string]: any;
  }
}
