import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { report } from "../diagnostics";
import { FieldTree } from "../fieldTree";
import type { Path } from "../path";
import { pathKey, readAt } from "../path";
import type { FieldNode } from "../types";

/**
 * The records this package hands a collector, and the line between its two doors.
 *
 * Two of the three codes THROW, in every build, so what development adds for them is the record
 * and nothing else — printing as well would make development noisier than production for a fault
 * whose message is already in front of the reader. `RMF003` is the opposite: nothing throws, the
 * form has let go of the failure, and the console line is the only trace. That asymmetry is the
 * thing most likely to be "tidied" by someone who has not read why, so it is asserted.
 *
 * See https://ramonda.dev/reference/diagnostics#capturing-them.
 */

/** The least a `FieldTree` needs, which is all these two codes touch. */
function host(initial: unknown) {
  const values = initial;
  return {
    read: (path: Path) => readAt(values, path),
    write: () => {},
    isTouched: () => false,
    touch: () => {},
    messages: () => [] as readonly string[],
    rowIds: (path: Path) => [pathKey(path)],
  };
}

let records: RamondaDiagnostic[] = [];
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  records = [];
  globalThis.__RAMONDA_DIAGNOSTICS__ = (record) => records.push(record);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
});

describe("a refusal", () => {
  test("RMF001 records the assignment and throws, without printing", () => {
    const tree = new FieldTree(host({ email: "" }) as never);
    const fields = tree.root as unknown as { email: FieldNode<string> };

    expect(() => {
      (fields.email as unknown as { $: unknown }).$ = "a@b.c";
    }).toThrow(/RMF001/);

    expect(records).toHaveLength(1);
    expect(records[0].code).toBe("RMF001");
    expect(records[0].scope).toBe("ramonda/form");
    expect(records[0].severity).toBe("error");
    expect(records[0].fix).toContain("proxy over a path");
    expect(records[0].data).toEqual({ path: "email" });
    // The throw is the developer's channel here, so nothing is printed twice.
    expect(errors).not.toHaveBeenCalled();
  });

  test("RMF002 records the value it found and throws, without printing", () => {
    const tree = new FieldTree(host({ email: "a@b.c" }) as never);
    const fields = tree.root as unknown as { email: { $: { rows: unknown } } };

    expect(() => fields.email.$.rows).toThrow(/RMF002/);

    expect(records).toHaveLength(1);
    expect(records[0].code).toBe("RMF002");
    expect(records[0].data).toEqual({ path: "email", held: "string" });
    expect(errors).not.toHaveBeenCalled();
  });

  test("the thrown message names the package and the code", () => {
    const tree = new FieldTree(host({ email: "" }) as never);
    const fields = tree.root as unknown as { email: FieldNode<string> };

    // It ships, so it has to be legible on its own — a reader in production has the throw and
    // nothing else.
    expect(() => {
      (fields.email as unknown as { $: unknown }).$ = "a@b.c";
    }).toThrow(/^\[Ramonda form RMF001] A field cannot be assigned to\./);
  });

  test("every value in `data` is one a collector can hold for ever", () => {
    const tree = new FieldTree(host({ email: "a@b.c" }) as never);
    const fields = tree.root as unknown as { email: { $: { rows: unknown } } };

    expect(() => fields.email.$.rows).toThrow();

    for (const value of Object.values(records[0].data ?? {})) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });

  test("a refusal still throws with no collector installed", () => {
    globalThis.__RAMONDA_DIAGNOSTICS__ = undefined;
    const tree = new FieldTree(host({ email: "a@b.c" }) as never);
    const fields = tree.root as unknown as { email: { $: { rows: unknown } } };

    expect(() => fields.email.$.rows).toThrow(/RMF002/);
    expect(records).toEqual([]);
  });
});

describe("the other door", () => {
  test("a diagnostic prints as well, because nothing else says it happened", () => {
    report("RMF003", "`onSubmit` threw.", { reason: "network" });

    expect(records).toHaveLength(1);
    expect(records[0].code).toBe("RMF003");
    expect(records[0].scope).toBe("ramonda/form");
    expect(records[0].fix).toContain("Catch it inside the handler");
    // The half a refusal skips: here the console line is the only trace a developer gets.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("[Ramonda form RMF003]");
  });

  /**
   * The asymmetry most likely to be "tidied" by someone who has not read why.
   *
   * The console is given the Error itself, because a stack a developer can click is the useful half
   * and `String(error)` is not one. The record is given text, because a collector keeps a bounded
   * history and an Error holds its stack, which holds the scope it was thrown from — one of these in
   * a vault keeps a whole submit alive.
   */
  test("the Error goes to the console and never into the record", () => {
    const thrown = new Error("network");
    report("RMF003", "`onSubmit` threw.", { reason: thrown.message }, thrown);

    expect(errors.mock.calls[0][1]).toBe(thrown);

    expect(records[0].data).toEqual({ reason: "network" });
    for (const value of Object.values(records[0].data ?? {})) {
      expect(typeof value).toBe("string");
    }
  });
});
