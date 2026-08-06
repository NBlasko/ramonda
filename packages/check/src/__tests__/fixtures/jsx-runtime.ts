/**
 * The automatic JSX runtime, stubbed — what `jsxImportSource` resolves to.
 *
 * The other fixtures use the CLASSIC runtime (`"jsx": "react"`, `"jsxFactory": "h"`), which the
 * framework no longer has: core exports `__h`, not `h`, and a real app is configured with
 * `jsxImportSource: "@ramonda/core"`. A checker only ever tested against a configuration nobody
 * uses proves nothing about the configuration everybody uses — TypeScript emits the same JSX AST
 * either way, but "should" is not "does", and this is what makes it a fact.
 */
export declare function jsx(type: unknown, props: unknown, key?: unknown): unknown;
export declare function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
export declare function jsxDEV(type: unknown, props: unknown, key?: unknown): unknown;
export declare const Fragment: unknown;
