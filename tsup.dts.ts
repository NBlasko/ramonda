/**
 * The `dts` option every package's `tsup.config.ts` takes.
 *
 * tsup's declaration build sets `baseUrl: "."` itself, whatever the tsconfig says (8.5.1,
 * `dist/rollup.js`), and TypeScript 6 refuses `baseUrl` as deprecated (TS5101): every package
 * build stopped there. No tsconfig in this repo sets it. So the deprecation is switched off in
 * that one compile, and `check-types` still reports every deprecation the code itself has.
 */
export const dts = { compilerOptions: { ignoreDeprecations: "6.0" } } as const;
