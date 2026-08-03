// esbuild `inject` (via tsup): supplies `h` to every module that uses JSX
// without importing it. Router's components compile `<Link/>` to `h(Link)`, and
// `h` comes from core — kept external, so consumers share the one runtime.
export { h as __ramondaH } from "@ramonda/core";
