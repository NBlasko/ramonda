import { hydrateRoot } from "@ramonda/core";
import { App } from "./App";

// Adopt the server's markup instead of throwing it away and re-rendering. The
// component tree is identical to the server's, so hydration claims the existing
// DOM and just attaches the behaviour.
const root = document.querySelector<HTMLDivElement>("#app");
if (root) hydrateRoot(<App />, root);
