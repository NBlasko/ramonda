import { describe, test, expect } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * `index.ts` uses `export * from "./base/decorators"`, so an export added there
 * for internal reasons silently becomes public API. This is the tripwire: adding
 * something on purpose means updating this list, and adding it by accident fails
 * the build.
 *
 * It also pins the things that must NEVER be reachable. The signal attach/detach
 * symbols are the sharp ones — the list engine uses them to subscribe item
 * scopes, and a missing `detach` is exactly how the scope leak happened. An app
 * that could call them could leak the same way, with nothing to catch it.
 */

const EXPECTED = [
  // components and hooks
  "Component",
  "Hook",
  "list",
  "AsyncLoad",
  "ErrorBoundary",
  "createContext",
  "createRef",
  "Ref",
  "Head",
  // entry points
  "bootstrap",
  "unmount",
  "h",
  // server rendering
  "renderToString",
  "renderPage",
  "renderDocument",
  "hydrateRoot",
  "ServerRedirect",
  "captureServerRedirect",
  // decorators
  "state",
  "persist",
  "compute",
  "effect",
  "create",
  "mount",
  "destroy",
  "watchProp",
  "deferHydration",
  "shouldUpdateProps",
  "memoizedHandler",
  "onElement",
  "onWindow",
  "onDocument",
  "interval",
  "timeout",
  "Host",
  // building your own decorators
  "createSubscriptionDecorator",
];

/** Reactivity plumbing an app must not be able to touch. */
const FORBIDDEN = [
  "State",
  "attach",
  "detach",
  "trackerContainer",
  "reactivityScope",
  "GLOBAL_RUNTIME",
  "COMPONENT_RUNTIME",
  "HOOK_RUNTIME",
  "diffAndMerge",
  "mountNode",
  "createRamonda",
  "KEY_SYM",
  "IS_LIST",
  "CHILD_RECORD",
  "ORIGIN_SYM",
  "currentOrigin",
];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("reactivity plumbing is not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });
});
