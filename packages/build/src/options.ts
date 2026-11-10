/** What `ramonda()` can be told, from Vite and from esbuild alike. */
export interface RamondaOptions {
  /**
   * Compile JSX into templates and holes (see `compile.ts`). On unless set to `false`, which is for
   * telling whether a fault is the compiler's: the same app, built the way it was before it existed.
   */
  compile?: boolean;
}
