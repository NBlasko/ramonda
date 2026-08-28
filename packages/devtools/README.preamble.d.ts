// What this README's one example assumes. See `apps/docs/content/_preamble.d.ts` for the same idea
// on the docs side — the devtools pages need this exact declaration, and for the same reason.
export {};

declare global {
  /** Vite puts this on `import.meta`; the load line reads `DEV` off it. */
  interface ImportMeta {
    env: Record<string, any>;
  }
}
