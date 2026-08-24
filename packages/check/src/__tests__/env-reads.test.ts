import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const found = () => analyzeProject(join(here, "fixtures", "env-reads", "tsconfig.json")).findings["unexposed-env-read"];

/**
 * An `import.meta.env` name nothing exposes, which is always `undefined` and never reported at runtime.
 *
 * `@ramonda/build` exposes the `RAMONDA_PUBLIC_` prefix and the bundler's own five names, and nothing
 * else. **This is the migration hazard**: Vite's `envPrefix` REPLACES its default rather than adding to
 * it — measured, in `build` and in `dev` — so adopting Ramonda's build settings makes every `VITE_*` read
 * stop working, quietly.
 *
 * Unlike most rules about a value, this one is COMPLETE. It asks nothing about where a value came from or
 * whether one was set; it reads the NAME, which is written on the spot, and asks whether that name is in
 * the exposed set. The answer does not depend on an environment or a `.env` file, so there is no path it
 * has to go quiet for.
 */
describe("an environment variable read but never exposed", () => {
  test("every unexposed name is reported, with the name it should have", () => {
    expect(found().map((issue) => `${issue.name} -> ${issue.suggestion}`)).toEqual([
      "VITE_API_URL -> RAMONDA_PUBLIC_API_URL",
      "API_BASE -> RAMONDA_PUBLIC_API_BASE",
      "RAMONDA_API_BASE -> RAMONDA_PUBLIC_API_BASE",
    ]);
  });

  /**
   * The suggestion strips the OLD prefix, both of them. Keeping one would produce
   * `RAMONDA_PUBLIC_RAMONDA_API_BASE`, and `RAMONDA_` without `PUBLIC` is the case that most reads as if
   * it should already work — so it is the one where the suggestion has to be right.
   */
  test("the suggestion is a name somebody would actually use", () => {
    for (const issue of found()) {
      expect(issue.suggestion.startsWith("RAMONDA_PUBLIC_")).toBe(true);
      expect(issue.suggestion).not.toContain("PUBLIC_RAMONDA_");
      expect(issue.suggestion).not.toContain("PUBLIC_VITE_");
    }
  });

  test("it points at the name, on the line the name is written", () => {
    const issue = found().find((each) => each.name === "VITE_API_URL");
    expect(issue?.file).toBe(join(here, "fixtures", "env-reads", "app.tsx"));
    expect(issue?.line).toBe(9);
  });

  test("what stays silent, and why each one is silent", () => {
    const names = found().map((issue) => issue.name);
    // The exposed prefix.
    expect(names).not.toContain("RAMONDA_PUBLIC_API_BASE");
    // The bundler's own names, available whatever the prefix is — read off Vite's injected object.
    for (const builtIn of ["DEV", "PROD", "MODE", "BASE_URL", "SSR"]) expect(names).not.toContain(builtIn);
    // A computed key cannot be read, so it is not judged.
    expect(names).not.toContain("which");
    // And an author who said why: the annotation is this package's own and is honoured.
    expect(names).not.toContain("VITE_LEGACY");
  });
});

/**
 * `process.env` read from a member the browser also runs.
 *
 * `process` does not exist in a browser, so this is a `ReferenceError` on the page rather than an
 * `undefined` — and a development run can hide it, because a dev server may shim enough of `process`
 * to get through. The fault then waits for the production bundle.
 *
 * The asymmetry with `client-only-request-read`, which asks the opposite question of the same
 * decorators: **"not marked" means "the browser gets here".** `render()` runs on both sides, so does a
 * field initialiser, and the lifecycle family defaults to `shared`. Only `{ env: "server" }` excuses a
 * member.
 */
describe("process.env in code the browser runs", () => {
  const run = () => analyzeProject(join(here, "fixtures", "env-reads", "tsconfig.json"));
  const serverEnv = () => run().findings["server-env-in-shared-code"];

  /**
   * `globalThis.process.env` is the same read and was silent — the check required `process` to be a
   * bare identifier. A destructure and a bracketed key were already found, because the match is at
   * `process.env` rather than at the member; only the quoted text needed the key adding.
   */
  test("every read the browser can reach is named, with the member holding it", () => {
    expect(serverEnv().map((issue) => `${issue.component}.${issue.member}: ${issue.read}`)).toEqual([
      // The three spellings beside the dotted one. A destructure names `process.env` on its
      // right-hand side, which is what the report quotes; the other two carry the key.
      "OtherSpellings.render: process.env",
      'OtherSpellings.render: process.env["REGION"]',
      "OtherSpellings.render: globalThis.process.env.API_KEY",
      // An EMPTY directive buys nothing: reported, and the directive itself reported too.
      "ReadsWithNoReason.read: process.env.DATABASE_URL",
      "ReadsProcessInRender.render: process.env.DATABASE_URL",
      "ReadsProcessInAField.url: process.env.DATABASE_URL",
      "ReadsProcessInSharedCreate.read: process.env.REGION",
      "HelperAlsoCalledInRender.both: process.env.DATABASE_URL",
    ]);
  });

  /**
   * A helper reached only from a server-only lifecycle, which is the shape this rule's own advice
   * recommends once the read is factored out. Reporting it was a false positive at error severity, and
   * class rules get no `ramonda-check-ignore`, so there would have been no way out but restructuring
   * correct code.
   */
  /**
   * A FALSE REPORT at error severity, on correct code, until it was planted.
   *
   * The table of what each lifecycle does is a LOOKUP, so the LOCAL name is not merely a weaker key
   * than the exported one — it is the wrong key. `import { created as onCreate }` read as
   * `onCreate` found nothing in the table, so `@onCreate({ env: "server" })` excused nothing and the
   * read was reported as browser code. Measured both ways: reported without the fix, silent with it.
   */
  test("a server-only lifecycle said through an aliased decorator excuses the read", () => {
    expect(serverEnv().map((issue) => issue.component)).not.toContain("AliasedServerOnly");
  });

  /**
   * A CLASS rule could not be answered at all until the annotation reached every family.
   *
   * `server-env-in-shared-code` is an ERROR, and `ModuleContext.unlessAnnotated` was the only
   * escape there was — a mechanism three module rules called and thirty class rules could not. When
   * this rule was wrong, measured, the reader's only way out was restructuring code that was
   * already right.
   *
   * The reason is RECORDED, under the rule's own name, so it is printed on every run and cannot
   * quietly stop being true.
   */
  test("a class rule can be answered with a written reason", () => {
    const { findings, annotated } = run();

    expect(findings["server-env-in-shared-code"].map((issue) => issue.component)).not.toContain("ReadsWithAReason");
    expect(annotated.map((one) => `${one.what}: ${one.reason}`)).toContain(
      "server-env-in-shared-code: this bundle is built for the server only, and the plugin defines process",
    );
  });

  /**
   * An EMPTY directive buys nothing, which is a change and a deliberate one: it used to silence the
   * site and leave a note, and that made the note the price of switching a rule off. The package's
   * own sentence is that a silence is not a record.
   */
  test("an empty directive does not silence a class rule either", () => {
    const { findings, unresolved } = run();

    expect(findings["server-env-in-shared-code"].map((issue) => issue.component)).toContain("ReadsWithNoReason");
    expect(unresolved.filter((one) => one.what === "server-env-in-shared-code")).toHaveLength(1);
  });

  test("a helper only a server-only member calls is excused, however many hops away", () => {
    const names = serverEnv().map((issue) => issue.component);
    expect(names).not.toContain("DelegatesToAHelper");
    expect(names).not.toContain("DelegatesTwice");
  });

  /** And an excuse has to hold for EVERY caller: one of them is the browser, so it is not an excuse. */
  test("the same helper called from render as well is reported", () => {
    expect(serverEnv().map((issue) => `${issue.component}.${issue.member}`)).toContain("HelperAlsoCalledInRender.both");
  });

  /**
   * A file that shims `process` for browser code. The shim IS the fix, so reporting it would be
   * reporting the reader's own answer — the rule asks whether the name resolves to a declaration, which
   * is `browser-url`'s distinction between a global and a local of the same name.
   */
  test("a `process` that resolves to a declaration is not Node's", () => {
    expect(serverEnv().map((issue) => issue.component)).not.toContain("UsesAShim");
  });

  /**
   * The three shapes are three different reasons, and each has to be caught on its own: a render, a
   * field initialiser, and a lifecycle whose default nobody changed. Missing the last one would be the
   * easy mistake, because it LOOKS server-ish.
   */
  test("a bare @created() is not an excuse — the family defaults to shared", () => {
    const names = serverEnv().map((issue) => issue.component);
    expect(names).toContain("ReadsProcessInSharedCreate");
  });

  test('an explicit { env: "server" } is the one excuse there is', () => {
    expect(serverEnv().map((issue) => issue.component)).not.toContain("ReadsProcessOnTheServer");
  });

  /**
   * The excuse across a CLASS boundary, which was a false positive on the shape this rule's own
   * advice recommends — one class further along.
   *
   * `ConfigBase` holds `protected fromDb()`, and its only caller is a server-only lifecycle in the
   * subclass. Nothing in the base references it, and the stance for an unreferenced member was "it
   * may be called from anywhere" — true of a PUBLIC one, and not true of a `protected` one, whose
   * callers can only be this chain. The chain is walked upward here, never down.
   *
   * The miss this leaves is written down in the rule: a subclass calling such a helper from
   * `render()` is a real fault and is reported by nothing. A miss is the safe direction here; a
   * false ERROR on a working pattern is not.
   */
  test("a base's protected helper, called only from a server-only subclass member, is not reported", () => {
    expect(serverEnv().map((issue) => issue.component)).not.toContain("ConfigBase");
  });

  /**
   * The `#` spelling of the same privacy, which carries no MODIFIER — so a check that read modifiers
   * alone reported it, and named it `(anonymous)` while doing so because the shared `memberName`
   * treated a `#field` as unnameable. Both found in review, by planting the `#` form of a shape the
   * `private` form already handled.
   */
  test("a `#private` helper is excused like a `private` one, and is named when it is reported", () => {
    expect(serverEnv().map((issue) => issue.component)).not.toContain("ConfigBase");
    expect(serverEnv().map((issue) => issue.member)).not.toContain("(anonymous)");
  });

  /** The control: a private helper a render DOES call stays reported, referenced as it is. */
  test("a private helper a render calls is still reported", () => {
    expect(serverEnv().map((issue) => issue.component)).toContain("HelperAlsoCalledInRender");
  });
});

/**
 * A one-sided global, ASKED ABOUT before it is touched.
 *
 * `process` does not exist in a browser, so isomorphic code checks first — and checking is the
 * correct way to write it. `server-env-in-shared-code` is an ERROR, and it reported five shapes
 * that cannot crash, including the two most standard spellings anybody uses. A build failing
 * against working code is the one thing this package cannot afford, so this is the fixture that
 * says so.
 *
 * The guard lives in `side-guard.ts` rather than in the rule, deliberately: two rules disagreeing
 * about one `typeof window` is exactly the drift the shared reader exists to prevent — and the
 * second one, `client-only-request-read`, was found to need the same answer.
 */
describe("a read behind a check that it only happens where it works", () => {
  const guarded = () =>
    analyzeProject(join(here, "fixtures", "env-guards", "tsconfig.json")).findings["server-env-in-shared-code"];

  test("every spelling of the guard is honoured", () => {
    /**
     * What is left is the whole list, which cannot go quiet the way a `not.toContain` can:
     *
     * - 38, a click handler, which IS the browser by definition;
     * - 46, a `@mounted` on a base class, which defaults to `shared`.
     *
     * Everything else in that fixture is guarded — a ternary (7), an `&&` (15),
     * `if (import.meta.env.SSR)` (23), `if (typeof window === "undefined")` (79), and the EARLY
     * RETURN (88), which is how a `render()` is written far more often than a nested `if`.
     */
    expect(
      guarded()
        .map((issue) => issue.line)
        .sort((a, b) => a - b),
    ).toEqual([38, 46]);
  });

  test("a subclass inheriting a shared member is not reported a second time", () => {
    // One fault, at the base that wrote it. `InheritsIt` adds nothing and says nothing.
    expect(guarded().map((issue) => issue.component)).toEqual(["InAHandler", "SharedBase"]);
  });

  test("and a subclass inherits the base's server-only marking too", () => {
    expect(guarded().map((issue) => issue.component)).not.toContain("InheritsTheMarking");
  });
});
