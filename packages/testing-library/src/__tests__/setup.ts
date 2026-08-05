import { configureDev } from "@ramonda/core";

// RMD020 renders every component twice in a development build to catch values built
// in place. This suite asserts lifecycle ORDER by logging from `render()` — which is
// exactly the impurity the check reports — so a doubled render doubles those entries.
// Off here; core's own RMD020 tests turn it back on for themselves.
configureDev({ strictRender: false });
