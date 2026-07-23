import { h } from "@ramonda/core";

// JSX in tests compiles to `h(...)`; expose it globally like the core and router
// setups do.
(globalThis as unknown as { h: typeof h }).h = h;
