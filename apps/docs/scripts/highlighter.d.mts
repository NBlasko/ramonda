import type { Highlighter } from "shiki";

/**
 * `highlighter.mjs` is a build script — node runs it as it is, so it cannot be TypeScript. This is
 * the shape it hands back, and it exists so the test that measures the colours is type-checked like
 * everything else rather than sliding in as `any`.
 */
export declare const highlighter: Highlighter;
