import { h } from "@ramonda/core";
import { configureDev } from "@ramonda/core";

// JSX in tests compiles to `__ramondaH(...)`; expose it globally like the core and router
// setups do. The name is deliberately unusable — see core's `global.ts`.
(globalThis as unknown as { __ramondaH: typeof h }).__ramondaH = h;

// RMD020 renders every component twice in a development build to catch values built
// in place. This suite asserts lifecycle ORDER by logging from `render()` — which is
// exactly the impurity the check reports — so a doubled render doubles those entries.
// Off here; core's own RMD020 tests turn it back on for themselves.
configureDev({ strictRender: false });
