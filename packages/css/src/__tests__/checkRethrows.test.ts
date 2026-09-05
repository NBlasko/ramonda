import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * A failure that is NOT a refusal must not be dressed up as one of the author's faults.
 *
 * The check catches what the parser throws so an unreadable block becomes a finding rather than a
 * stack trace. That catch is also the place a bug in this package could be swallowed — reported as
 * "your block is wrong" at some position, on a block that is fine. So it rethrows anything that is
 * not a refusal, and this is what keeps that true.
 */
vi.mock("../compiler/virtual", async (importOriginal) => {
  const real = await importOriginal<typeof import("../compiler/virtual")>();
  return {
    ...real,
    virtualFile: () => {
      throw new TypeError("a bug in the transform, not a fault in the source");
    },
  };
});

const projects: string[] = [];
afterEach(() => {
  for (const each of projects.splice(0)) rmSync(each, { recursive: true, force: true });
});

describe("an error that is not a refusal", () => {
  test("comes out as itself", async () => {
    const { checkProject } = await import("../check");

    const root = mkdtempSync(join(tmpdir(), "ramonda-css-"));
    projects.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "Card.tsx"), `const a = <div css=@@( display: flex; )>x</div>;\n`);
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { types: [] }, include: ["src"] }));

    expect(() => checkProject(join(root, "tsconfig.json"))).toThrow(TypeError);
  });
});
