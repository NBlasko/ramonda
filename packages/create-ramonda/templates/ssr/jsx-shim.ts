// esbuild `--inject`: supplies `h` to every module that uses it, the way Vite's
// `jsxInject` does for the SPA template. A file, not a config string, because
// that is the only shape esbuild's `--inject` takes.
export { h as __ramondaH } from "@ramonda/core";
