/**
 * Whether this run's JSX went through the compiler (`vitest.compiled.config.ts`). A test that describes
 * what the `jsx()` path does — the operations it costs, a static child it puts back — is that path's
 * alone: a compiled template does the same work with fewer operations, and never checks its static
 * parts again (`core/block.ts`).
 */
export const COMPILED = process.env.RAMONDA_COMPILED === "1";
