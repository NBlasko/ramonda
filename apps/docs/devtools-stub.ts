/**
 * Core dynamically imports the devtools in DEV. The docs site builds with
 * `__DEV__=false` so the import is dead code, but esbuild still has to resolve
 * the specifier — so it is pointed at nothing.
 */
export {};
