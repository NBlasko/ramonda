import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "unknown-hook-option", "tsconfig.json"));

/**
 * A name in a hook's props bag that the hook does not take.
 *
 * Found by an agent building an app from the docs alone: `this.use(Head, () => ({ robots: "noindex" }))`
 * type-checked and rendered nothing, and it found out by fetching the served page. TypeScript checks
 * an object literal for names its type lacks only where nothing is inferred from it, and a props
 * callback is exactly where the hook's type is inferred from the bag — measured: `Head({ robots })`
 * and `Query({ staleTimee })` both pass `tsc`.
 */
describe("a name the hook does not take", () => {
  test("is reported wherever the bag is written, through every shape it is reached by", () => {
    const found = run().findings["unknown-hook-option"];
    expect(found.map((issue) => `${issue.hook}.${issue.option}`)).toEqual([
      "Poll.evry",
      "Poll.robots",
      "Fetching.staleTimee",
      "Poll.everyMs",
      "Poll.tick",
      "Poll.robots",
      "Poll.evrey",
      "Poll.paused",
      "Poll.interval",
      "ThemeProvider.color",
      "Poll.onTic",
    ]);
  });

  test("names the option it was probably meant to be, when one is close", () => {
    const found = run().findings["unknown-hook-option"];
    const meant = Object.fromEntries(found.map((issue) => [`${issue.line}:${issue.option}`, issue.meant]));
    expect(Object.values(meant)).toContain("every");
    expect(found.find((issue) => issue.option === "staleTimee")?.meant).toBe("staleTime");
    expect(found.find((issue) => issue.option === "color")?.meant).toBe("colour");
    expect(found.find((issue) => issue.option === "onTic")?.meant).toBe("onTick");
    // Nothing like any name it takes: no guess, and the report lists what it does take.
    const robots = found.find((issue) => issue.option === "robots");
    expect(robots?.meant).toBeUndefined();
    expect(robots?.takes).toEqual(["every", "onTick"]);
  });

  test("a bag reached from elsewhere says where it was written", () => {
    const found = run().findings["unknown-hook-option"];
    expect(found.find((issue) => issue.option === "tick")?.writtenIn).toBe("`bag`");
    expect(found.find((issue) => issue.option === "evrey")?.writtenIn).toBe("`pollingBag`");
  });

  /**
   * The silences. A hook whose props take any name, or whose type cannot be read, cannot be told a
   * name is wrong; a name either shape of a union takes is known; a computed name is not read; and a
   * bag that is not written as a literal — `self.bag` — may carry more than the hook takes by design.
   */
  test("is silent where the hook's type cannot say a name is wrong, or the name is not written", () => {
    const found = run().findings["unknown-hook-option"];
    expect(found.every((issue) => issue.component === "Reported")).toBe(true);
    expect(found).toHaveLength(11);
  });
});
