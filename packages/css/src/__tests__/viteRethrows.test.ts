import { describe, expect, test, vi } from "vitest";

/**
 * A failure that is NOT a refusal must not be dressed up as a fault in the author's block.
 *
 * The plugin catches what the transform throws so an unreadable block becomes an error Vite can
 * point at. That catch is also where a bug in this package could be swallowed — reported as "your
 * block is wrong" at some position, on a block that is fine. The same guard `check.ts` has, and the
 * same reason.
 */
vi.mock("../compiler/transform", async (importOriginal) => {
  const real = await importOriginal<typeof import("../compiler/transform")>();
  return {
    ...real,
    transform: () => {
      throw new TypeError("a bug in the transform, not a fault in the source");
    },
  };
});

describe("an error that is not a refusal", () => {
  test("comes out as itself, with no position attached", async () => {
    const { ramondaCss } = await import("../vite");
    const plugin = ramondaCss();
    const transform = plugin.transform as (this: unknown, code: string, id: string) => unknown;

    expect(() => transform.call({}, `const a = <div css=@@( display: flex; )>x</div>;\n`, "/src/Card.tsx")).toThrow(
      TypeError,
    );
  });
});
