import { describe, expect, test } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * The same tripwire the other packages have: an export added for an internal convenience silently
 * becomes public API, and a published surface is much harder to take back than to refuse. Adding
 * something on purpose means updating this list; adding it by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be acknowledged
 * twice — once as API, once as documentation.
 *
 * Two values, and the entry is mostly not about them: importing this package REGISTERS
 * `<ramonda-devtools>` and installs the diagnostics bridge, which is why its `sideEffects` is
 * `keeps` (see `packaging.test.ts`). The list below is the part a consumer calls by name.
 */
const EXPECTED = ["installDiagnostics", "panelRegistry"];

/**
 * The TYPES the build publishes, which `Object.keys` cannot see.
 *
 * These are the whole authoring surface for a panel — the plugin, its snapshot, and the row shapes
 * a panel renders. Somebody writing one in TypeScript annotates with every one of them, so they are
 * API in the fullest sense while being invisible to a runtime check.
 */
const EXPECTED_TYPES = [
  "PanelPlugin",
  "PanelRegistry",
  "PanelRow",
  "PanelSnapshot",
  "RowAction",
  "RowField",
  "RowGroup",
  "RowStatus",
  "RowValue",
];

/**
 * The internals a consumer must not reach.
 *
 * The panel's own machinery. A caller able to reach the element class or the session store could
 * drive the panel directly instead of through a plugin, which is the contract that lets the panel
 * be rewritten without breaking anybody's tab.
 */
const FORBIDDEN = [
  "PANEL_CSS",
  "ValueView",
  "ProfileTab",
  "PluginTabs",
  "ComponentsTab",
  "read",
  "write",
  "resolveOriginal",
];

describe("public API surface", () => {
  test("exports exactly what it means to", () => {
    const actual = Object.keys(api).sort();
    const expected = [...EXPECTED].sort();

    const added = actual.filter((name) => !expected.includes(name));
    const removed = expected.filter((name) => !actual.includes(name));

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  test("the internals are not reachable", () => {
    for (const name of FORBIDDEN) {
      expect(api).not.toHaveProperty(name);
    }
  });

  test("every published type is named in EXPECTED_TYPES", () => {
    expect(new Set(EXPECTED_TYPES).size).toBe(EXPECTED_TYPES.length);
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});

// Every published type, named once, so `check-types` fails if one is renamed or removed.
import type {
  PanelPlugin,
  PanelRegistry,
  PanelRow,
  PanelSnapshot,
  RowAction,
  RowField,
  RowGroup,
  RowStatus,
  RowValue,
} from "../index";

// Exported because this package sets `noUnusedLocals`, and a tuple that only has to COMPILE has
// no other use. Exporting it is what makes "this type still exists" a check rather than dead code.
export type _Surface = [
  PanelPlugin,
  PanelRegistry,
  PanelRow,
  PanelSnapshot,
  RowAction,
  RowField,
  RowGroup,
  RowStatus,
  RowValue,
];
