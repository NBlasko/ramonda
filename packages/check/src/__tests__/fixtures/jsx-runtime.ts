/**
 * The automatic JSX runtime, stubbed — what `jsxImportSource` resolves to.
 *
 * Every fixture is on this runtime, because every real project is: `"jsx": "react-jsx"` with
 * `jsxImportSource: "@ramonda/core"`. They used to be on the classic one (`"jsx": "react"`,
 * `"jsxFactory": "h"`), naming a factory the framework does not export — core has `__h` — so the
 * checker was only ever proved against a configuration nobody uses. TypeScript emits the same JSX
 * AST either way, but "should" is not "does".
 */
export declare function jsx(type: unknown, props: unknown, key?: unknown): unknown;
export declare function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
export declare function jsxDEV(type: unknown, props: unknown, key?: unknown): unknown;
export declare const Fragment: unknown;
