/**
 * Core's server entries, as much of them as the gate needs.
 *
 * The gate reads IMPORT statements and only looks at `@ramonda/*` specifiers, so a fixture proving
 * it has to import from the real name — the same shape `browser-url` uses for `@ramonda/router`.
 */
export declare function renderToString(vnode: unknown): Promise<string>;
export declare function renderPage(vnode: unknown): Promise<{ body: string }>;
export declare function hydrateRoot(vnode: unknown, el: unknown): void;
