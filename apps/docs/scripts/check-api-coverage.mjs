import { globSync, readFileSync } from "node:fs";
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

const expected = [...publicSurfaceOf("core", 20), ...publicSurfaceOf("lens", 1), ...publicSurfaceOf("query", 8)];

const reference = readFileSync(join(root, "content", "reference", "api.md"), "utf8");

/**
 * Prove the check can fail before trusting that it passes — and prove each one SEPARATELY.
 *
 * With a single flag the first check threw and the second never ran, so its self-test proved nothing
 * about it. `DOCS_SELFTEST=api`, `=diagnostics`, or `=1` for both.
 */
const selftest = process.env.DOCS_SELFTEST ?? "";
const selftesting = (which) => selftest === "1" || selftest === which;

if (selftesting("api")) expected.push("__DefinitelyNotDocumented__");

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

/**
 * The same tripwire for diagnostics, and it exists because one slipped through.
 *
 * `RMQ001` was raised in two places in `hashKey.ts` and documented nowhere — for however long, with
 * nothing to notice. A diagnostic that is not in the reference is worse than an undocumented export: the
 * message tells a reader to look it up, and the page it sends them to does not have it.
 *
 * Read from the SOURCE rather than from a list somebody maintains, so a new code is documented or the
 * build fails. The floor is the same idea as `atLeast` above: if the scan finds implausibly few codes,
 * the scan broke and a green build would be proving nothing.
 */
const codeInSource = /\[?(RM[DQ]\d{3})\]?/g;
const sources = ["core", "query"].flatMap((pkg) => [
  ...globSync("**/*.ts", { cwd: join(packages, pkg, "src") }).map((file) => join(packages, pkg, "src", file)),
]);

const raised = new Set();
for (const file of sources) {
  // Only where a code is REPORTED, not where a test asserts one: a test naming a retired code would
  // otherwise demand a section for something that no longer exists.
  if (file.includes("__tests__")) continue;
  for (const [, code] of readFileSync(file, "utf8").matchAll(codeInSource)) raised.add(code);
}

if (raised.size < 20) {
  throw new Error(
    `[docs] Found only ${raised.size} diagnostic codes in the packages' source, which cannot be right — ` +
      `the scan is broken, and every check below would pass against nothing.`,
  );
}

const diagnostics = readFileSync(join(root, "content", "reference", "diagnostics.md"), "utf8");
if (selftesting("diagnostics")) raised.add("RMD999");

const undocumented = [...raised].filter((code) => !new RegExp(`^## ${code} `, "m").test(diagnostics)).sort();

if (undocumented.length > 0) {
  throw new Error(
    `[docs] These diagnostics are raised in the source but have no section in the reference:\n` +
      undocumented.map((code) => `        ${code}`).join("\n") +
      `\n\n        Add "## ${undocumented[0]} — …" to content/reference/diagnostics.md.`,
  );
}

console.log(`[docs] Diagnostics reference covers all ${raised.size} codes the packages raise`);
