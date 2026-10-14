// In your own code, use `import.meta.env.DEV` for a development-only branch — it is what the
// documentation and `src/entry-client.tsx` use. `@ramonda/build` defines it on both halves, so it
// reads alike under Vite in development and esbuild in production, and a production build compiles
// the branch out.
//
// `__DEV__` is declared only because the build defines it: it is what `@ramonda/core` itself is
// compiled against. You do not need it.
//
// The JSX factory used to be declared here too; it is not any more, because the compiler imports
// Ramonda's automatic runtime per file.
declare const __DEV__: boolean;

/**
 * What `import.meta.env` holds, which nothing else here declares.
 *
 * The SPA template gets this from `/// <reference types="vite/client" />`; this project is built by
 * esbuild and has no Vite types to reference, so it says it itself. Add the `RAMONDA_PUBLIC_` names your
 * app reads and a typo becomes a build error — see /reference/build.
 */
interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
