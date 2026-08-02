// esbuild `--inject`: supplies `h` to every module that uses it without one.
// A file, not a config string, because that is the only shape esbuild takes.
export { h as __ramondaH } from "@ramonda/core";
