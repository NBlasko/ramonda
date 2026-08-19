// Replaced by esbuild's `--define` per build: true for `dev`, false for `build`. The devtools
// import is behind it, so a production bundle never carries the panel.
//
// `__DEV__` is what `@ramonda/core` itself is compiled against, which is why the build defines it and
// why it is declared here. For your own code `import.meta.env.DEV` says the same thing and is what the
// documentation uses — `@ramonda/build` defines it on both halves, so it reads alike under Vite in
// development and esbuild in production. Either is a literal at build time, so either compiles a
// development-only branch out.
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
