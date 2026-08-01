import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * The property that matters most is the SILENCE: a build gate that cries wolf is one people
 * disable. So the passing cases are as much the point as the failing ones.
 */

describe("reports a path with no provider", () => {
  test("nobody provides the context at all", () => {
    const { issues } = run("missing");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
    expect(issues[0].context).toBe("Theme");
    expect(issues[0].path).toEqual(["App", "Reader"]);
  });

  test("THE REORDER: the provider exists, but not above this consumer", () => {
    const { issues } = run("reorder");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
    // Sidebar provides it — on its own branch. Reader's branch has nothing.
    expect(issues[0].path).toEqual(["App", "Reader"]);
  });
});

describe("stays quiet when the provider really is above", () => {
  test("provider on the root, consumer two levels down", () => {
    expect(run("ok").issues).toEqual([]);
  });

  test("consumer passed as children of the providing wrapper", () => {
    // The ownership rule: children of <Shell> mount UNDER Shell, so Shell's provider covers them.
    // Getting this wrong is the likeliest false positive there is.
    expect(run("children").issues).toEqual([]);
  });
});

describe("it can see the app at all", () => {
  test("counts what it found", () => {
    const { counts } = run("ok");
    expect(counts.contexts).toBe(1);
    expect(counts.roots).toBe(1);
    expect(counts.components).toBeGreaterThanOrEqual(3);
  });
});
