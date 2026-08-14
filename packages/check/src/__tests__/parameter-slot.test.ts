import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "parameter-slot", "tsconfig.json"));

/**
 * A prop and a parameter are the same fact through different doors: the caller decides.
 *
 * `<this.props.view />` has never been a defect. `__h(type, …)` inside a JSX runtime is the same
 * promise written differently, and reporting one and not the other made the framework apologise
 * for being a framework — thirteen escape hatches in this repository, eight of them this shape.
 */
describe("a value handed in by the caller", () => {
  test("is a slot naming what it waits on, not a hole", () => {
    const { graph } = run();
    const slots = graph.edges
      .filter((e) => e.kind === "unresolved" && e.via === "slot")
      .map((e) => e.slot)
      .sort();
    // A bare parameter, a parameter at depth, the same name behind a cast — and `this.use(hook)`,
    // which is the same promise about a HOOK rather than about a tag.
    expect(slots).toEqual(["hook", "options.wrapper", "type", "view"]);
  });

  test("and nothing is reported about it", () => {
    const { unresolved } = run();
    expect(unresolved).toEqual([]);
  });

  /**
   * The two shapes that stay holes, because reading either means running something: a call's
   * return value, and whatever a local binding was last assigned.
   */
  test("a call and a local binding are still holes needing a written reason", () => {
    const { annotated } = run();
    expect(annotated).toHaveLength(2);
    expect(annotated.map((a) => a.reason).sort()).toEqual([
      "a local binding holds whatever ran, and this fixture is about that line",
      "what a call returns cannot be read, and this fixture is about that line",
    ]);
  });
});

/**
 * The half of the exemption that is easy to lose: the site goes SILENT, it does not become
 * transparent.
 */
describe("a component whose hook came from a parameter", () => {
  test("still shields what is under it from a verdict", () => {
    const { issues } = run();
    // `Quiet` sits under `Host`, whose hook only its caller knows — it may well be providing.
    // `Loud` sits where nothing could be.
    expect(issues.map((i) => i.consumer)).toEqual(["Loud"]);
  });

  /**
   * But what it MOUNTS is written in its body and perfectly visible. The two questions shared one
   * early return, so everything under an opaque node was unreached, and the dead-declaration rule
   * read that as "nothing mounts this" with the tag one line above it in the same file.
   */
  test("is still walked, so what it mounts is not called dead", () => {
    const { unreachable } = run();
    expect(unreachable.map((d) => d.name)).toEqual([]);
  });
});
