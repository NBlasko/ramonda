import { h } from "@ramonda/core";

// JSX in tests compiles to `__ramondaH(...)`; expose it globally like the core setup does.
// The name is deliberately unusable — see core's `global.ts`.
(globalThis as unknown as { __ramondaH: typeof h }).__ramondaH = h;
