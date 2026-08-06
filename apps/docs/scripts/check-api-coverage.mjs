import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
function publicSurfaceOf(pkg, atLeast, fileName = "PublicSurface.test.ts") {
  const file = join(packages, pkg, "src", "__tests__", fileName);
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

/**
 * The TYPES a package publishes, read from `EXPECTED_TYPES` in the same file.
 *
 * Types are erased, so the runtime surface test cannot see them and neither can `Object.keys`.
 * A published type is API all the same — someone writes it in an annotation — so the reference
 * has to name it or the build fails, exactly as for a value.
 */
function publicTypesOf(pkg, atLeast, fileName = "PublicSurface.test.ts") {
  const file = join(packages, pkg, "src", "__tests__", fileName);
  const surface = readFileSync(file, "utf8");
  const start = surface.indexOf("const EXPECTED_TYPES");
  if (start === -1) throw new Error(`[docs] ${pkg} declares no EXPECTED_TYPES list.`);
  const end = surface.indexOf("];", start);

  const names =
    surface
      .slice(start, end)
      .match(/"([A-Za-z][A-Za-z0-9]*)"/g)
      ?.map((quoted) => quoted.slice(1, -1)) ?? [];

  if (names.length < atLeast) {
    throw new Error(
      `[docs] Could not read the type list from ${pkg}'s PublicSurface.test.ts — found ` +
        `${names.length} names, expected at least ${atLeast}.`,
    );
  }
  return names;
}

const expected = [
  ...publicSurfaceOf("core", 20),
  ...publicSurfaceOf("lens", 1),
  ...publicSurfaceOf("query", 8),
  // Form publishes one VALUE and twenty-odd types. `publicSurfaceOf` slices the first list in
  // the file, which is `EXPECTED` — so the floor is 1, and the types are covered separately
  // below from `EXPECTED_TYPES`, because a type never appears in `Object.keys`.
  ...publicSurfaceOf("form", 1),
  ...publicTypesOf("form", 20),
  // A SECOND entry point is API too. `@ramonda/form/bguard` has its own surface test, and its
  // exports were documented by hand and guarded by nothing until this line.
  ...publicSurfaceOf("form", 2, "BguardSurface.test.ts"),
  ...publicTypesOf("form", 2, "BguardSurface.test.ts"),
];

const reference = readFileSync(join(root, "content", "reference", "api.md"), "utf8");

/**
 * Prove the check can fail before trusting that it passes — and prove each one SEPARATELY.
 *
 * With a single flag the first check threw and the second never ran, so its self-test proved nothing
 * about it. `DOCS_SELFTEST=api`, `=prefix`, `=diagnostics`, `=retired`, or `=1` — which reaches only
 * the first, since one process observes one throw.
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
/**
 * A code where it is RAISED, not where it is mentioned.
 *
 * The quote is what makes the difference, and it has to be there: a code reaches a reporter as a
 * string — `diagnose("RMD001", …)`, `report("RML004", …)`, `"[RMF001] A field cannot be assigned"` —
 * while a doc comment referring to another package's diagnostic writes it bare, as prose. Measured
 * across the four packages: matching bare finds eighteen occurrences of `RMD` inside `@ramonda/form`
 * and `@ramonda/query`, every one of them a sentence explaining how core's check interacts with
 * theirs. Requiring the quote finds the same 45 codes and none of the sentences, which is what lets
 * the prefix check below mean anything.
 */
const codeInSource = /["'`]\[?(RM[A-Z]\d{3})\]?/g;

/**
 * Which prefix belongs to which package.
 *
 * A code says which package raised it, and that is only true if it is enforced: a diagnostic
 * copied from core into another package keeps `RMD`, and then the code lies about its origin
 * while the reference still has a section for it — so nothing above would notice.
 */
const PREFIX_OF = { core: "RMD", query: "RMQ", form: "RMF", lens: "RML" };

/**
 * Every `.ts` under a directory, walked by hand.
 *
 * `fs.globSync` is the obvious way to write this and the reason it is not written that way: it landed in
 * Node 22, CI runs Node 20, and the failure is a SyntaxError at import time — the whole docs build, dead
 * before its first line. It passed locally on Node 24 and broke on the first push, which is the shape of
 * bug a local gate cannot catch, because the difference is the runtime rather than the code.
 *
 * So: `readdirSync` with `withFileTypes`, which has worked since Node 10.
 */
function tsFilesIn(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesIn(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const raised = new Set();
const misprefixed = [];

for (const [pkg, prefix] of Object.entries(PREFIX_OF)) {
  for (const file of tsFilesIn(join(packages, pkg, "src"))) {
    // Only where a code is REPORTED, not where a test asserts one: a test naming a retired code would
    // otherwise demand a section for something that no longer exists.
    if (file.includes("__tests__")) continue;
    for (const [, code] of readFileSync(file, "utf8").matchAll(codeInSource)) {
      raised.add(code);
      if (!code.startsWith(prefix)) misprefixed.push({ code, pkg, prefix, file: relative(root, file) });
    }
  }
}

if (selftesting("prefix")) {
  misprefixed.push({ code: "RMZ001", pkg: "lens", prefix: "RML", file: "(selftest)" });
}

if (misprefixed.length > 0) {
  throw new Error(
    `[docs] These diagnostics are raised by a package whose prefix they do not carry:\n` +
      misprefixed
        .map(({ code, pkg, prefix, file }) => `        ${code} in ${file} — ${pkg} raises ${prefix}###`)
        .join("\n") +
      `\n\n        A code names the package that raised it. Give it this package's prefix, or move it.`,
  );
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

/**
 * The other direction, which nothing checked: a section for a code no longer raised.
 *
 * A code is never reused, so a removed check keeps its section — a reader who hits an old message in
 * an old build still lands somewhere. What that section must not do is keep describing a live check.
 * `RMD012` is the precedent and the format: its title says `retired`, which is the one thing this
 * looks for.
 */
const documented = [...diagnostics.matchAll(/^## (RM[A-Z]\d{3})(.*)$/gm)];
const stale = documented
  .filter(([, code]) => !raised.has(code))
  .filter(([, , rest]) => !/retired/i.test(rest))
  .map(([, code]) => code);

if (selftesting("retired")) stale.push("RMD001");

if (stale.length > 0) {
  throw new Error(
    `[docs] These diagnostics have a section but are raised nowhere:\n` +
      stale.map((code) => `        ${code}`).join("\n") +
      `\n\n        A code is never reused, so keep the section and mark it: "## ${stale[0]} — retired".`,
  );
}

console.log(
  `[docs] Diagnostics reference covers all ${raised.size} codes the packages raise ` +
    `(${documented.length - raised.size} retired)`,
);
