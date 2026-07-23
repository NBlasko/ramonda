import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails the build if a public export is missing from the API reference.
 *
 * The reference page is the most rot-prone thing on the site: an export added
 * for a good reason is documented on its concept page and forgotten here, and
 * nothing notices — a reference that is quietly incomplete is worse than one
 * that says so, because a reader trusts it.
 *
 * The source of truth is core's own `PublicSurface.test.ts`, which already fails
 * when an export is added without being declared. So this checks the docs against
 * the same list, and the two tripwires together mean a new export has to be
 * acknowledged twice — once as API, once as documentation.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const packages = join(root, "..", "..", "packages");

/**
 * Reads one package's declared public surface.
 *
 * `atLeast` is not decoration. The list is read by slicing between two markers,
 * so a rename in the test file would leave the slice empty and every check below
 * would pass against nothing — a green build proving only that the parser broke.
 */
function publicSurfaceOf(pkg, atLeast) {
  const file = join(packages, pkg, "src", "__tests__", "PublicSurface.test.ts");
  const surface = readFileSync(file, "utf8");
  const start = surface.indexOf("const EXPECTED");
  const end = surface.indexOf("/**", start);

  const names =
    surface
      .slice(start, end)
      .match(/"([A-Za-z][A-Za-z0-9]*)"/g)
      ?.map((quoted) => quoted.slice(1, -1)) ?? [];

  if (names.length < atLeast) {
    throw new Error(
      `[docs] Could not read the export list from ${pkg}'s PublicSurface.test.ts — found ` +
        `${names.length} names, expected at least ${atLeast}. That would make every check ` +
        `below pass vacuously.`,
    );
  }
  return names;
}

const expected = [...publicSurfaceOf("core", 20), ...publicSurfaceOf("lens", 1)];

const reference = readFileSync(join(root, "content", "reference", "api.md"), "utf8");

// Prove the check can fail before trusting that it passes.
if (process.env.DOCS_SELFTEST === "1") expected.push("__DefinitelyNotDocumented__");

const missing = expected.filter((name) => {
  // A decorator is written `@state` in the reference; a class is written `Class`.
  const pattern = new RegExp(`(^|[^A-Za-z0-9_@])@?${name}([^A-Za-z0-9_]|$)`);
  return !pattern.test(reference);
});

if (missing.length > 0) {
  throw new Error(
    `[docs] These exports are public but missing from the API reference:\n` +
      missing.map((name) => `        ${name}`).join("\n") +
      `\n\n        Add them to content/reference/api.md.`,
  );
}

console.log(`[docs] API reference covers all ${expected.length} public exports`);
