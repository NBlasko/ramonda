import { h } from "@ramonda/core";
import { configureDev } from "@ramonda/core";

// JSX in tests compiles to `h(...)`; expose it globally like the core setup does.
(globalThis as unknown as { h: typeof h }).h = h;

// RMD020 renders every component twice in a development build to catch values built
// in place. These suites deliberately log from `render()` to observe render ORDER —
// which is exactly the impurity the check reports — so a doubled render would double
// those logs and break assertions that count them. Off here; the RMD020 tests turn
// it back on for themselves.
configureDev({ strictRender: false });
