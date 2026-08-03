import { describe, expect, test } from "vitest";
import * as api from "../index";

/**
 * What the package exports, asserted as a list.
 *
 * The same tripwire core, lens and query have, and for the same reason: an export added for
 * an internal convenience silently becomes public API, and a published surface is much harder
 * to take back than to refuse. Adding something on purpose means updating this list; adding it
 * by accident fails the build.
 *
 * The docs' `check-api-coverage.mjs` reads this list too, so a new export has to be
 * acknowledged twice — once as API, once as documentation.
 *
 * Only `Form` is a VALUE. Everything else is a type, so `Object.keys` cannot see it — the type
 * names are listed below and checked by the compiler instead, which is the only thing that can
 * check them.
 */
const EXPECTED = ["Form"];

/**
 * The types the package publishes.
 *
 * Erased at runtime, so this list is here for the docs check to read and for the `import type`
 * below to prove: if one of these is dropped or renamed, `check-types` fails on this file.
 */
const EXPECTED_TYPES = [
  "ArrayApi",
  "ArrayNode",
  "Bind",
  "CheckboxBind",
  "Collision",
  "CommonBind",
  "DateBind",
  "FieldApi",
  "FieldNode",
  "FormProps",
  "InferIn",
  "InferOut",
  "LeafApi",
  "LeafNode",
  "NumberBind",
  "ObjectNode",
  "Row",
  "StandardIssue",
  "StandardResult",
  "StandardSchemaV1",
  "TextBind",
  "ValidateOn",
];

/**
 * The internals a consumer must not reach.
 *
 * `FieldTree` and the path helpers are the sharp ones: they are the machinery behind `f.a.b.$`,
 * and reaching them directly would let an app build a field node the form does not know about,
 * so its edits would never reach the values or the validation.
 */
const FORBIDDEN = ["FieldTree", "FieldHandle", "pathToString", "parsePath", "readAt", "writeAt", "validate"];

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
    // The compiler proves the types EXIST — see the import below, which fails to check if one
    // is gone. This proves the LIST is the same length, so a type added to `index.ts` without
    // being added here is caught rather than quietly undocumented.
    const exported = new Set(EXPECTED_TYPES);
    expect(exported.size).toBe(EXPECTED_TYPES.length);
    expect(EXPECTED_TYPES).toEqual([...EXPECTED_TYPES].sort());
  });
});

// Every published type, named once, so `check-types` fails if one is renamed or removed.
import type {
  ArrayApi,
  ArrayNode,
  Bind,
  CheckboxBind,
  Collision,
  CommonBind,
  DateBind,
  FieldApi,
  FieldNode,
  FormProps,
  InferIn,
  InferOut,
  LeafApi,
  LeafNode,
  NumberBind,
  ObjectNode,
  Row,
  StandardIssue,
  StandardResult,
  StandardSchemaV1,
  TextBind,
  ValidateOn,
} from "../index";

type _Surface = [
  ArrayApi<string, string[]>,
  ArrayNode<unknown, unknown[]>,
  Bind<string>,
  CheckboxBind,
  Collision,
  CommonBind,
  DateBind,
  FieldApi<string>,
  FieldNode<string>,
  FormProps<StandardSchemaV1>,
  InferIn<StandardSchemaV1>,
  InferOut<StandardSchemaV1>,
  LeafApi<string>,
  LeafNode<string>,
  NumberBind,
  ObjectNode<{ a: string }>,
  Row<string>,
  StandardIssue,
  StandardResult<string>,
  StandardSchemaV1,
  TextBind,
  ValidateOn,
];
