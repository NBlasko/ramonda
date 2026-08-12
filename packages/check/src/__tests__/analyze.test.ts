import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * The graph's edges as `from -> to (kind/via)`, sorted, with the fixture's directory stripped off
 * the front of every id.
 *
 * Strings and not a snapshot: a snapshot rots silently — it is rewritten by whoever runs the suite
 * with `-u` and nobody reads the diff — and this is the artifact other rules will be computed from.
 */
const edgesOf = (name: string): string[] => {
  const prefix = `@ramonda/check/src/__tests__/fixtures/${name}/`;
  const short = (id: string | undefined) => (id ?? "?").replace(prefix, "");
  return run(name)
    .graph.edges.map((e) => `${short(e.from)} -> ${short(e.to)} (${e.kind}/${e.via})`)
    .sort();
};

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

  test("a hook written with its type argument does not blind the walk below it", () => {
    /**
     * `this.use(Store<string>)` is an INSTANTIATION EXPRESSION rather than an identifier, and every
     * generic hook in the framework is documented to be written that way when the call site cannot
     * infer: `Form<typeof schema>`, `Query<Todo>`, `Field<string>`. Read as an identifier only, none of
     * them resolved — so the component holding one was marked opaque, and a component is opaque exactly
     * when the walk STOPS beneath it. Every consumer under a form or a query went unjudged.
     *
     * The fixture puts the pinned hook on `App` and the unprovided consumer under it, so the silence is
     * what fails.
     */
    const { issues } = run("pinned-hook");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
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
    // Exactly the three classes in the fixture. It was `toBeGreaterThanOrEqual` while any class
    // extending anything counted, which is a bound a wrong number also satisfies.
    expect(counts.components).toBe(3);
  });
});

/**
 * A component is a DECLARATION, not a name.
 *
 * This repository's own documentation app declares `class Page` seventy-five times, one per page,
 * and every one of them was the same node: one set of providers, one set of consumers, one set of
 * children. 146 component and hook classes were reported as 72.
 *
 * The fixture is that fault at its smallest — two classes called `Page`, one mounting the provider
 * and one not, both rendering the same consumer. Merged, the provider from the first covers the
 * second and the broken path is SILENT.
 */
describe("two components with one name are two components", () => {
  test("counts both, and finds the path that has no provider", () => {
    const { issues, counts } = run("same-name");
    // Reader, both Pages, App.
    expect(counts.components).toBe(4);
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
    // Both classes are called `Page`, so the path reads the same either way — the DATA is what
    // separates them, and only the branch through the provider-less one is reported.
    expect(issues[0].path).toEqual(["App", "Page", "Reader"]);
  });

  test("an import alias reaches the class it renames", () => {
    // `<Themed />` is `Page` under another name. Resolving a tag by name never found it at all,
    // which is the other half of the same fault: a missed edge is a walk that stops early.
    expect(run("same-name").issues[0].path[1]).toBe("Page");
  });
});

/**
 * Which classes are components.
 *
 * The membership test decided this by reading one heritage clause and saying yes to a class
 * extending ANYTHING. Every rule the composition graph is meant to carry reads this set — "a
 * component no root renders" would report `class MyError extends Error` as dead code — so it is
 * the first thing to be right about.
 */
describe("a class is a component only if its heritage chain reaches one", () => {
  test("counts the two components and neither of the plain classes", () => {
    // Base and Deep and App. Not MyError, not Plain, not Widget, not the mixin's Panel.
    expect(run("heritage").counts.components).toBe(3);
  });

  test("a subclass of a component is still a component, so the walk goes through it", () => {
    /**
     * The half that a tighter name check would break. `Deep extends Base extends Component`
     * consumes Theme with no provider above it, and that report exists only if `Deep` is in the
     * set at all — silence here means the fix went too far in the other direction.
     */
    const { issues } = run("heritage");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Deep");
    expect(issues[0].context).toBe("Theme");
    expect(issues[0].path).toEqual(["App", "Deep"]);
  });
});

/**
 * Function literals in class fields.
 *
 * The whole value of doing this in the SOURCE is the line between a function written in the field
 * and a function a call returned. At runtime they are the same thing — `bindInstanceMethods` has
 * put a bound function on the instance under every method's name by the time anything could look,
 * and `debounce(this.save, 200)` is a function there too. Only one of them is a mistake.
 */
describe("function literals held in class fields", () => {
  const found = () => run("arrows").arrowFields;

  test("reports an arrow, a function expression, and nothing else", () => {
    expect(found().map((f) => `${f.component}.${f.field}`)).toEqual([
      "Panel.onPick",
      "Panel.format",
      "Panel.legacy",
      "Counter.tick",
    ]);
  });

  test("a field initialised from a CALL is left alone", () => {
    // `debounce(this.persist, 200)` and `memoize(this.compute)` are functions, and both are
    // legitimate: a wrapper cannot be written as a method. This is the case a runtime check
    // cannot tell apart, and the reason this one reads the source.
    const names = found().map((f) => f.field);
    expect(names).not.toContain("save");
    expect(names).not.toContain("cheap");
  });

  test("a value that is not a function is not a finding", () => {
    const names = found().map((f) => f.field);
    expect(names).not.toContain("label");
    expect(names).not.toContain("rows");
  });

  test("a static field is one per class, so it is not a finding", () => {
    expect(found().map((f) => f.component)).not.toContain("Statics");
  });

  test("a class that is not a component or a hook is not this check's business", () => {
    expect(found().map((f) => f.component)).not.toContain("Plain");
  });

  test("says whether it reads `this`, because that decides the fix", () => {
    const by = Object.fromEntries(found().map((f) => [f.field, f]));
    // Reads the instance → it wants to be a method, which Ramonda binds for you.
    expect(by["onPick"].readsThis).toBe(true);
    expect(by["tick"].readsThis).toBe(true);
    // Reads nothing of the instance → it wants to leave the class entirely.
    expect(by["format"].readsThis).toBe(false);
  });

  test("names the file and the line, so the report is a place to go", () => {
    const first = found()[0];
    expect(first.file).toMatch(/fixtures\/arrows\/app\.tsx$/);
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });

  test("the other fixtures have none, so the check is silent on ordinary code", () => {
    for (const name of ["ok", "missing", "reorder", "children"]) {
      expect(run(name).arrowFields, name).toEqual([]);
    }
  });
});

/**
 * Single-use decorators declared twice on one class.
 *
 * The framework reports what it can once a component mounts (RMD032 for `@catchError`), which is
 * exactly the gap this package exists for: a class behind a condition nobody clicked ships with the
 * fault and nothing has said a word. The line that matters is the same one as everywhere else here
 * — a SUBCLASS declaring its own is an override, not a duplicate, and reporting it would be advice
 * to delete the line doing the work.
 */
describe("single-use decorators declared twice", () => {
  const found = () => run("duplicate-decorators").duplicateDecorators;

  test("reports a method decorator and a class decorator, once each", () => {
    expect(found().map((d) => `${d.component}.@${d.decorator}x${d.count}`)).toEqual([
      "Twice.@catchError x2".replace(" ", ""),
      "GatedTwice.@ShouldUpdateOnPropsChange x2".replace(" ", ""),
      "RedundantTwice.@state x2".replace(" ", ""),
      "RedundantTwice.@compute x2".replace(" ", ""),
      "HostTwice.@Host x2".replace(" ", ""),
      "StableTwice.@StableProps x2".replace(" ", ""),
    ]);
  });

  /**
   * Two faults share this report and they need different advice.
   *
   * Four, one per behaviour core actually has, each measured there rather than assumed here:
   * `@Host` REFUSES (throws, RMD045), `@catchError` and `@ShouldUpdateOnPropsChange` DISPLACE (one wins,
   * the rest are dead code), `@StableProps` MERGES (both take effect, RMD046), and `@state`/`@compute`
   * are REDUNDANT (a doubled `@state` renders once per write with the right value). Saying "one of them
   * never runs" is true of exactly one of the four, and sends a reader after a difference that is not
   * there for the other three.
   */
  test("each report says what the second declaration does", () => {
    expect(found().map((d) => `${d.decorator}:${d.effect}`)).toEqual([
      "catchError:displaces",
      "ShouldUpdateOnPropsChange:displaces",
      "state:redundant",
      "compute:redundant",
      "Host:refuses",
      "StableProps:merges",
    ]);

    // All four, so no behaviour is described by a sentence nothing exercises.
    expect(new Set(found().map((d) => d.effect))).toEqual(new Set(["displaces", "redundant", "refuses", "merges"]));
  });

  /**
   * The kind is what decides which of the duplicates is in effect, and the two are opposite: a member
   * decorator initialises top-to-bottom so the lowest wins, a class decorator applies bottom-up so the
   * highest does. Measured in core (`CatchErrorDecorator.test.tsx`, `PropsGateInheritance.test.tsx`);
   * carried here so the CLI can name the right declaration instead of guessing one for both.
   *
   * Read off the NODE the decorator was found on, not from a table of names — `@ShouldUpdateOnPropsChange`
   * was a member decorator before it was a class one, and a table would still be saying so.
   */
  test("each report says where the decorator sits", () => {
    expect(found().map((d) => `${d.decorator}:${d.kind}`)).toEqual([
      "catchError:member",
      "ShouldUpdateOnPropsChange:class",
      "state:member",
      "compute:member",
      "Host:class",
      "StableProps:class",
    ]);
  });

  test("a subclass declaring its own is silent, and so is one of each", () => {
    const names = found().map((d) => d.component);
    expect(names).not.toContain("Sub");
    expect(names).not.toContain("Base");
    expect(names).not.toContain("Fine");
  });

  /**
   * The regression that mattered: several fields each carrying ONE `@state` is what every component
   * looks like, and counting the redundant kind per CLASS reported `declares @state 3 times`. It showed
   * up against this repository's own documentation app, not in a fixture — five on one class there.
   *
   * So the redundant kind counts per MEMBER, and the report names the member.
   */
  test("one decorator each on several members is silent, and a real duplicate names its member", () => {
    expect(found().map((d) => d.component)).not.toContain("ManyFields");

    const redundant = found().filter((d) => d.effect === "redundant");
    expect(redundant.map((d) => `${d.component}.${d.member}@${d.decorator}`)).toEqual([
      "RedundantTwice.n@state",
      "RedundantTwice.doubled@compute",
    ]);
    // Named only where the count is per member — for `displaces` it is per class, and naming one
    // method there would point at the wrong thing.
    expect(
      found()
        .filter((d) => d.effect === "displaces")
        .every((d) => d.member === undefined),
    ).toBe(true);
  });

  test("the analyzer walks the tree under the AUTOMATIC jsx runtime", () => {
    /**
     * The proof that this fixture's configuration is understood, not merely tolerated.
     *
     * Every fixture used to be on the classic runtime, naming a factory the framework does not
     * export (`jsxFactory: "h"`), so nothing had ever run against `jsx: "react-jsx"` +
     * `jsxImportSource` — which is what a real project has. They are all on it now, and this is the
     * assertion that says so: finding a missing provider needs the JSX tree, and the PATH is what
     * says the walk really happened. An analyzer that could not see the elements would report
     * nothing at all.
     */
    const { issues } = run("duplicate-decorators");
    expect(issues).toHaveLength(1);
    expect(issues[0].consumer).toBe("Reader");
    expect(issues[0].context).toBe("Theme");
    expect(issues[0].path).toEqual(["App", "Reader"]);
  });

  test("it points at the declaration", () => {
    const first = found()[0];
    expect(first.file).toMatch(/duplicate-decorators\/app\.tsx$/);
    expect(first.line).toBeGreaterThan(0);
    expect(first.column).toBeGreaterThan(0);
  });
});

describe("a form field read by a component that does not watch it", () => {
  /**
   * The silent one. Such a component never re-renders: the field node is one cached object for the
   * life of the form, so its props never change, and the form's `@state` belongs to the form's owner.
   * Nothing at runtime can report it — the form cannot see who is rendering — so this is the gate.
   */
  test("reports the read, however it is written", () => {
    const { unwatchedFields } = run("unwatched-field");
    expect(unwatchedFields.map((issue) => issue.component).sort()).toEqual(["Broken", "BrokenViaLocal"]);
  });

  test("stays quiet for the shapes that are correct as written", () => {
    // Named in the negative on purpose: each of these is a false positive waiting to happen, and the
    // fixture holds one of each — the watcher, the write-only handler, the layout that only passes the
    // field down, and the owner reading its own fields.
    const reported = new Set(run("unwatched-field").unwatchedFields.map((issue) => issue.component));
    for (const quiet of ["Watched", "WriteOnly", "Layout", "Page"]) {
      expect(reported.has(quiet)).toBe(false);
    }
  });

  test("says which member would never update, and where", () => {
    const { unwatchedFields } = run("unwatched-field");
    const broken = unwatchedFields.find((issue) => issue.component === "Broken");
    expect(broken?.member).toBe("bind");
    expect(broken?.line).toBeGreaterThan(0);
    expect(broken?.file.endsWith("app.tsx")).toBe(true);
  });
});

/**
 * The composition graph.
 *
 * The issues above are ONE reading of it, and it is a projection of the same pass rather than a
 * second walk, so the two cannot drift apart. What it holds is facts — nodes and edges, including
 * the edges that resolved to nothing — and never conclusions: no issues in it, and no paths, since
 * the graph is small while the set of paths through it is not.
 */
describe("the composition graph", () => {
  test("every edge of an ordinary app, with how it was written", () => {
    expect(edgesOf("ok")).toEqual([
      "app.tsx#App -> app.tsx#Shell (renders/tag)",
      "app.tsx#App -> app.tsx#ThemeProvider (provides/use)",
      "app.tsx#Reader -> app.tsx#ThemeProvider (consumes/use)",
      "app.tsx#Shell -> app.tsx#Reader (renders/tag)",
      "app.tsx#bootstrap -> app.tsx#App (renders/bootstrap)",
    ]);
  });

  /**
   * `kind` is what a walk reads and `via` is only how it was written. The pair is what lets a new
   * way of naming a component arrive as a `via` value that no reader has to know about.
   */
  test("a consumer passed as children is an edge from the wrapper, marked as children", () => {
    // <Shell><Reader /></Shell> — Reader mounts under Shell, and the tag is written in App's body.
    expect(edgesOf("children")).toContain("app.tsx#Shell -> app.tsx#Reader (renders/children)");
    expect(edgesOf("children")).toContain("app.tsx#App -> app.tsx#Shell (renders/tag)");
  });

  test("two classes with one name are two nodes, and an alias reaches the one it renames", () => {
    expect(edgesOf("same-name")).toEqual([
      "app.tsx#App -> plain.tsx#Page (renders/tag)",
      "app.tsx#App -> themed.tsx#Page (renders/tag)",
      "app.tsx#bootstrap -> app.tsx#App (renders/bootstrap)",
      "plain.tsx#Page -> reader.tsx#Reader (renders/tag)",
      "reader.tsx#Reader -> context.ts#ThemeProvider (consumes/use)",
      "themed.tsx#Page -> context.ts#ThemeProvider (provides/use)",
      "themed.tsx#Page -> reader.tsx#Reader (renders/tag)",
    ]);
  });

  /**
   * What it could NOT resolve is recorded, with the reason and the place.
   *
   * Leaving it out would make the graph a map with unmarked blanks, which is worse than no map
   * because it is trusted. Every rule computed from this reads the same holes.
   */
  test("a component held in a variable is a recorded hole, not a missing edge", () => {
    const graph = run("holes").graph;
    const hole = graph.edges.find((e) => e.kind === "unresolved");
    expect(hole?.via).toBe("tag");
    expect(hole?.to).toBeUndefined();
    expect(hole?.why).toContain("`Alias`");
    expect(hole?.why).toContain("not to a component class");
    // And the place is on the edge, so a rule can name it without going back to the source.
    expect(hole?.at).toMatch(/app\.tsx:21:12$/);
  });

  test("the envelope says what the graph is and what it was read from", () => {
    const graph = run("ok").graph;
    expect(graph.schema).toBe(1);
    // It has a root, so it can be judged whole. A package has none and emits a fragment instead.
    expect(graph.scope).toBe("app");
    expect(graph.package.name).toBe("@ramonda/check");
    expect(graph.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("the same sources produce the same bytes", () => {
    // Nodes and edges are sorted for exactly this: a diff between two commits is the change, not
    // the order the walk happened to visit things in.
    expect(JSON.stringify(run("ok").graph)).toEqual(JSON.stringify(run("ok").graph));
  });

  test("a hook is a node of its own, and using one is an edge", () => {
    // A hook mounts no children, so it is not a component — but it can carry a context for its
    // owner, which is why it is in the graph rather than folded into whoever used it.
    expect(edgesOf("holes")).toContain("app.tsx#App -> app.tsx#Counter (uses/use)");
    expect(run("holes").graph.nodes.find((n) => n.name === "Counter")?.kind).toBe("hook");
  });

  test("a context node carries the pair's names, so a message can say what to mount", () => {
    const context = run("ok").graph.nodes.find((n) => n.kind === "context");
    expect(context?.label).toBe("Theme");
    expect(context?.provider).toBe("ThemeProvider");
    expect(context?.consumer).toBe("ThemeConsumer");
    expect(context?.optional).toBe(false);
  });
});
