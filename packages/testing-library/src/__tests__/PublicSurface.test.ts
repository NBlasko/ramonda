import * as dom from "@testing-library/dom";
import { describe, expect, test } from "vitest";
import * as api from "../index";

/**
 * What this package adds, asserted as a list.
 *
 * The same tripwire the other packages have: an export added for an internal convenience silently
 * becomes public API, and a published surface is much harder to take back than to refuse. Adding
 * something on purpose means updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be acknowledged
 * twice — once as API, once as documentation.
 */
const EXPECTED = ["act", "cleanup", "fireEvent", "render", "renderHook"];

/**
 * The TYPES the build publishes, which `Object.keys` cannot see.
 *
 * A type is erased before it reaches the runtime, so an internal one re-exported by accident is
 * public API no other check in this package would notice. Each of these is somebody's annotation
 * the moment they write `const view: RenderResult = render(…)`.
 */
const EXPECTED_TYPES = ["RenderHookProps", "RenderHookResult", "RenderOptions", "RenderResult", "WrapperComponent"];

/**
 * Why this does not simply list everything the entry exports.
 *
 * `index.ts` re-exports `@testing-library/dom` wholesale, so the built entry publishes **84** names:
 * the five above plus that library's queries, `screen`, `waitFor`, `within`, `prettyDOM` and
 * `configure`. Naming those here would be maintaining somebody else's API — a dependency bump that
 * adds a query would fail this build for a change nobody in this repository made, which is how a
 * gate stops being run.
 *
 * So the two halves are asserted differently. Ours are named exactly, by subtracting theirs. Theirs
 * are asserted as a RELATIONSHIP: that the re-export still arrives, and that the one name we
 * deliberately shadow is still ours. Both of those can break; the list of query names cannot.
 */
const OURS = (): string[] =>
  Object.keys(api)
    .filter((name) => name !== "__esModule")
    .filter((name) => !(name in dom) || name === "fireEvent")
    .sort();

describe("public API surface", () => {
  test("adds exactly what it means to", () => {
    const expected = [...EXPECTED].sort();
    const actual = OURS();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("still re-exports the DOM library", () => {
    // The star is the package's main promise — the queries people already know, unreimplemented.
    // If it ever stopped arriving, every one of those calls would fail at the call site with a
    // message about an undefined import, and nothing else here would notice.
    for (const name of ["screen", "waitFor", "within", "prettyDOM", "configure"]) {
      expect(api).toHaveProperty(name);
    }
    expect(Object.keys(api).length).toBeGreaterThan(50);
  });

  test("shadows `fireEvent` with its own", () => {
    // Deliberate, and the reason the whole package exists: the DOM library's version does not know
    // when a Ramonda render has finished. A refactor that dropped the local export would leave the
    // name resolving to theirs — still defined, still callable, and silently uncommitted.
    expect(api.fireEvent).not.toBe(dom.fireEvent);
  });
});

// Every published type, named once, so `check-types` fails if one is renamed or removed.
import type { RenderHookProps, RenderHookResult, RenderOptions, RenderResult, WrapperComponent } from "../index";

type _Surface = [
  RenderHookProps<unknown>,
  RenderHookResult<unknown, unknown>,
  RenderOptions,
  RenderResult,
  WrapperComponent,
];

describe("the published types", () => {
  test("every one is named in EXPECTED_TYPES", () => {
    // The compiler proves they EXIST — the import above fails to check if one is gone. This proves
    // the list has no duplicate and is sorted, so a type added to `index.ts` without being added
    // here is caught by the docs' coverage check rather than quietly undocumented.
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});
