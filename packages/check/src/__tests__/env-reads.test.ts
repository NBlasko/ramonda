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
    expect(issue?.line).toBe(6);
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
