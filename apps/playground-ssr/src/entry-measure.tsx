/**
 * The measurement entry: the same App the client hydrates, re-exported together
 * with `hydrateRoot` so a Node script can drive one hydration and watch what it
 * reports. See measure-hydration.mjs.
 */
export { hydrateRoot } from "@ramonda/core";
import { App } from "./App";

/** A fresh <App /> vnode — the JSX has to be built here, where h() is injected. */
export const appNode = () => <App />;
