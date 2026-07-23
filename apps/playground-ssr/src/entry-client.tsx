import { hydrateRoot } from "@ramonda/core";
import { App } from "./App";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) hydrateRoot(<App />, root);
