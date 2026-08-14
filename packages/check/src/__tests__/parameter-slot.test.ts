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
  test("is an edge naming what it waits on, not a hole", () => {
    const { graph } = run();
    const slots = graph.edges
      .filter((e) => e.kind === "unresolved" && e.via === "parameter")
      .map((e) => e.slot)
      .sort();
    // A bare parameter, a parameter at depth, the same name behind a cast — and `this.use(hook)`
    // in both spellings, which is the same promise about a HOOK rather than about a tag.
    expect(slots).toEqual(["chosen", "hook", "hook", "options.wrapper", "type", "view"]);
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
    expect(
      annotated
        .filter((a) => a.what === "factory")
        .map((a) => a.reason)
        .sort(),
    ).toEqual([
      "a local binding holds whatever ran, and this fixture is about that line",
      "what a call returns cannot be read, and this fixture is about that line",
    ]);
  });

  /**
   * A directive on a site that has since become a slot is unnecessary — and reading it is not.
   * Returning before the directive was consulted left it out of the list the run prints on every
   * pass, which exists so the number cannot creep up unread, and let an EMPTY one through here
   * while it is refused everywhere else.
   */
  test("a directive left over on one of these still prints", () => {
    const { annotated } = run();
    const kept = annotated.filter((a) => a.what === "parameter");
    expect(kept.map((a) => a.reason)).toEqual([
      "written when this was still reported, and kept to prove it still prints",
    ]);
  });
});

/**
 * The half of the exemption that is easy to lose: the site goes SILENT, it does not become
 * transparent.
 */
describe("a component whose hook came from a parameter", () => {
  /**
   * Both spellings, because they take different branches and only one was covered.
   *
   * `this.use(hook as never)` leaves the name unresolvable, `this.use(hook)` resolves it to the
   * parameter's own symbol — and only the first branch marked the component opaque. The second
   * went silent without going opaque, which is the worst of both: no hole to point at, and a
   * consumer below reported against a component that may well have been providing for it.
   */
  test("still shields what is under it from a verdict, cast or not", () => {
    const { issues } = run();
    // `Quiet` is under `Host`, `Hushed` under `BareHost`; only `Loud` sits where nothing could be.
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

/**
 * The half of the change that crosses a package boundary, and the one that can INVENT a fault.
 *
 * A fragment's slot edges are filled from the bindings a JSX call site writes, which is right for a
 * prop and wrong for a parameter: the two live in different namespaces. `@acme/ui`'s `Frame` mounts
 * its own method argument `view`, the app writes `<Frame view={Rogue} />`, and the names have
 * nothing to do with each other. That is why a parameter carries its own `via` rather than a flag
 * on the same one — the splice reads `via`, and reading it wrong is a verdict on a mount nobody
 * wrote.
 */
describe("a parameter inside a spliced package", () => {
  test("is not filled from a prop that happens to share its name", () => {
    const { issues } = analyzeProject(join(here, "fixtures", "fragment", "tsconfig.json"));
    // `Rogue` is mounted under `Safe`, which provides Query. It must be judged there and nowhere
    // else; filling `Frame`'s parameter would judge it again where nothing provides.
    expect(issues.map((i) => i.consumer).sort()).toEqual(["HelperBody", "PagedBody"]);
  });
});
