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
 * A quoted export name in one of the lists below.
 *
 * The underscore is the whole point. This was `[A-Za-z][A-Za-z0-9]*`, which cannot match a name
 * containing one and cannot match a name starting with one — so `SAME_ITEM`, `PORTAL_TARGET_ATTR`
 * and `__h` were dropped from the expected list, silently, and were never checked against the
 * reference at all. Two of the three happened to be documented anyway; `__h` was not, and had been
 * public and absent from the API reference for as long as this check has existed.
 *
 * Nothing could have noticed. `atLeast` guards the list against coming back EMPTY, which is the
 * failure it was written for, and a list that comes back three names short is exactly as green.
 */
const NAME = /"([A-Za-z_][A-Za-z0-9_]*)"/g;

/**
 * Every quoted string in the slice, whether {@link NAME} could read it or not.
 *
 * The bug above was invisible because the parser had no way to say it had skipped something: it
 * matched what it could and returned a shorter list, and a shorter list is a passing build. So the
 * two counts are compared, and a name the reader cannot spell is a failure with the name in it.
 *
 * This is the check that would have caught the original, and it does not depend on knowing which
 * character was the problem next time.
 */
function readNames(slice, where) {
  const names = (slice.match(NAME) ?? []).map((quoted) => quoted.slice(1, -1));
  const quoted = (slice.match(/"[^"]*"/g) ?? []).map((token) => token.slice(1, -1));
  const dropped = quoted.filter((token) => !names.includes(token));

  if (dropped.length > 0) {
    throw new Error(
      `[docs] ${where} lists ${dropped.length} name(s) this script cannot read:\n` +
        dropped.map((name) => `        ${name}`).join("\n") +
        `\n\n        They would be skipped rather than checked, so the build would pass without\n` +
        `        ever asking whether they are documented. Widen NAME in check-api-coverage.mjs.`,
    );
  }
  return names;
}

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

  const names = readNames(surface.slice(start, end), `${pkg}'s EXPECTED in ${fileName}`);

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

  const names = readNames(surface.slice(start, end), `${pkg}'s EXPECTED_TYPES in ${fileName}`);

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
  // Core's TYPES, which `publicSurfaceOf` cannot see: types are erased, so the surface test reads them
  // from `EXPECTED_TYPES` rather than from `Object.keys`. This line was missing while `form`'s
  // equivalent was present, and that is how `HookMeta` was published and documented by nobody — ten
  // more were undocumented behind it, `LifecycleOptions` and the whole per-request family among them.
  ...publicTypesOf("core", 25),
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
  // `@ramonda/build`'s main entry. Its two adapters export a factory called `ramonda`, and that name
  // is deliberately NOT listed here: the matcher below allows a leading `@`, so `ramonda` is found
  // by any line that writes `@ramonda/anything` — every page on the site would satisfy it, and a
  // check that cannot fail is worse than no check. The adapters are guarded by their own surface
  // tests instead, and documented on /reference/build.
  ...publicSurfaceOf("build", 2),
  // `@ramonda/check`, and this line is the late one. While it was missing the package went from
  // five rules to twenty-seven, each adding a published issue type — and three of those were never
  // exported at all, reachable through `findings` and unnameable in an annotation. Nothing was
  // looking, which is the whole argument for this file.
  ...publicSurfaceOf("check", 5),
  ...publicTypesOf("check", 30),
];

const reference = readFileSync(join(root, "content", "reference", "api.md"), "utf8");

/**
 * Prove the check can fail before trusting that it passes — and prove each one SEPARATELY.
 *
 * With a single flag the first check threw and the second never ran, so its self-test proved nothing
 * about it. `DOCS_SELFTEST=api`, `=prefix`, `=diagnostics`, `=titles`, `=retired`,
 * `=twice`, `=sections`, or `=1` — which reaches only the first, since one process observes one
 * throw.
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

/**
 * A code being DEFINED — a key in one of the `SPECS` tables, `RMD044: {`.
 *
 * Kept apart from `codeInSource` because the two answer different questions: that one asks where a
 * code is used, this one asks where it is given a meaning. A code may be raised from a dozen
 * places; it may be defined exactly once.
 */
const codeDefinedInSource = /^\s+(RM[A-Z]\d{3}): \{/gm;

/** Every place a code is given a meaning, so a second one can be reported rather than silently win. */
const defined = new Map();

for (const [pkg, prefix] of Object.entries(PREFIX_OF)) {
  for (const file of tsFilesIn(join(packages, pkg, "src"))) {
    // Only where a code is REPORTED, not where a test asserts one: a test naming a retired code would
    // otherwise demand a section for something that no longer exists.
    if (file.includes("__tests__")) continue;
    const text = readFileSync(file, "utf8");
    for (const [, code] of text.matchAll(codeInSource)) {
      raised.add(code);
      if (!code.startsWith(prefix)) misprefixed.push({ code, pkg, prefix, file: relative(root, file) });
    }
    for (const [, code] of text.matchAll(codeDefinedInSource)) {
      if (!defined.has(code)) defined.set(code, []);
      defined.get(code).push(relative(root, file));
    }
  }
}

/**
 * A code defined twice, which JavaScript will not tell you about.
 *
 * `SPECS` is an object literal, so `RMD053: { … }` written twice is not an error and not a warning
 * — the second silently replaces the first, and a diagnostic that somebody wrote, documented and
 * tested simply stops existing. Nothing downstream notices: the code is still raised, still has a
 * section, and still reports. It reports the OTHER fault.
 *
 * This exists because it happened. Two branches minted `RMD053` for two different faults on the
 * same day — one for a request read with no scope installed, one for a swallowed post-commit
 * failure — and the only thing that caught it was a person reading a merge conflict. The next
 * collision will not come with a conflict to read, because the two halves will be in different
 * files.
 */
if (selftesting("twice")) defined.set("RMD001", ["(selftest) a.ts", "(selftest) b.ts"]);

const twice = [...defined].filter(([, files]) => files.length > 1 || new Set(files).size > 1);

if (twice.length > 0) {
  throw new Error(
    `[docs] These diagnostic codes are defined more than once:\n` +
      twice.map(([code, files]) => `        ${code} — ${[...new Set(files)].join(", ")}`).join("\n") +
      `\n\n        A code names one fault. Two definitions means one of them silently wins and the\n` +
      `        other diagnostic stops existing. Give the newer fault the next free code.`,
  );
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

/**
 * The same rule from the reference's side: one section per code.
 *
 * The check above reads the source, and this reads the page, because a collision can arrive on
 * either — and the one that actually happened arrived here. Two branches each wrote a `## RMD053`
 * section for a different fault; the page rendered both, one under the other, and the only thing
 * between that and a release was somebody reading a merge conflict.
 */
const sections = new Map();
for (const [, code] of documented) sections.set(code, (sections.get(code) ?? 0) + 1);
if (selftesting("sections")) sections.set("RMD002", 2);

const repeated = [...sections].filter(([, times]) => times > 1).map(([code]) => code);

if (repeated.length > 0) {
  throw new Error(
    `[docs] These diagnostics have more than one section in the reference:\n` +
      repeated.map((code) => `        ${code}`).join("\n") +
      `\n\n        One code, one section. Two means two faults are wearing the same name, and a\n` +
      `        reader sent to look one up finds the other first.`,
  );
}

/**
 * The WORDING, and this is the check that was missing for as long as this file has existed.
 *
 * Everything above asks whether a code has a section. Nothing asked whether the section is about the
 * same fault: `RMD041` drifted until the shipped message blamed a decorator that had been removed
 * while this page blamed a selector the framework never had — two different wrong explanations of
 * one code, each convincing on its own. A rename left three more sections describing a check that no
 * longer worked that way, and `RML001` was still called "a warning rather than an error" after it was
 * made to throw.
 *
 * The TITLE is what makes a cheap check possible, because there is exactly one right answer: the
 * words the code prints. Comparing the advice PROSE has no right answer — this page is meant to
 * explain at more length than a console line — so a gate over the paragraphs would be either wrong
 * or ignored. A reader arrives here having just read the title, and the heading has to be the
 * sentence they read.
 *
 * Only core is compared, and the limit is worth naming: `lens`, `query` and `form` carry no `title`
 * in their spec tables — their message is written at the call site, so one code has several — and
 * there is nothing single to compare a heading against. Their headings are guarded only by existing.
 */
function shippedTitles() {
  const source = readFileSync(join(packages, "core", "src", "debug", "diagnostics.ts"), "utf8");
  const lines = source.split("\n");

  /**
   * Entry boundaries first, then the title inside one entry.
   *
   * A single lazy regex over the whole file — `RMD\d+:[\s\S]*?title:` — pairs a code with a LATER
   * entry's title whenever an entry has no title of its own, and every comparison then reads as a
   * confident mismatch about the wrong code. Slicing between boundaries cannot do that: a title
   * found in the slice belongs to the code that opened it, or there is none.
   */
  const starts = [];
  lines.forEach((line, index) => {
    const match = /^ {2}(RMD\d{3}): \{$/.exec(line);
    if (match) starts.push({ code: match[1], index });
  });

  const titles = new Map();
  for (let k = 0; k < starts.length; k++) {
    const upto = k + 1 < starts.length ? starts[k + 1].index : lines.length;
    const line = lines.slice(starts[k].index, upto).find((text) => /^\s+title:/.test(text));
    if (line === undefined) continue;

    // The whole value on one line, ending in its comma. A title built by concatenation or spanning
    // two lines would otherwise be read HALF, and half a title compared against a full heading is a
    // failure that blames the page for the parser's shortcoming.
    const value = /^\s+title:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`),$/.exec(line);
    if (value === null) {
      throw new Error(
        `[docs] ${starts[k].code}'s title is not a single-line string this script can read:\n` +
          `        ${line.trim()}\n\n        Teach shippedTitles() in check-api-coverage.mjs to read it, or\n` +
          `        the comparison below would run against half a sentence.`,
      );
    }
    if (value[1].includes("\\")) {
      throw new Error(
        `[docs] ${starts[k].code}'s title contains an escape this script does not unescape:\n` +
          `        ${line.trim()}`,
      );
    }
    titles.set(starts[k].code, value[1].slice(1, -1));
  }

  // The same floor as everywhere else in this file: a renamed field or a reformatted table would
  // leave the map empty, and an empty map agrees with every page.
  if (titles.size < 40) {
    throw new Error(
      `[docs] Read only ${titles.size} diagnostic titles from core's SPECS, which cannot be right — ` +
        `the parser is broken and the wording check below would pass against nothing.`,
    );
  }
  return titles;
}

/** The same sentence on both sides: markdown emphasis removed, runs of whitespace flattened. */
const plain = (text) => text.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();

const titles = shippedTitles();
const headings = new Map(documented.map(([, code, rest]) => [code, rest]));
if (selftesting("titles")) titles.set("RMD001", "Something else entirely");

const reworded = [...titles]
  .filter(([code]) => headings.has(code))
  .filter(([code, title]) => {
    // Everything after the FIRST em dash, so a title carrying one of its own survives intact.
    const heading = headings.get(code).split(" — ").slice(1).join(" — ");
    return plain(heading) !== plain(title);
  });

if (reworded.length > 0) {
  throw new Error(
    `[docs] These diagnostics are described differently by the code and by the reference:\n` +
      reworded
        .map(
          ([code, title]) =>
            `        ${code}\n          reports: ${title}\n          heading: ## ${code}${headings.get(code)}`,
        )
        .join("\n") +
      `\n\n        A reader arrives having just read the title. Write the heading as\n` +
      `        "## CODE — <the words the code reports>" in content/reference/diagnostics.md.`,
  );
}

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
    `(${documented.length - raised.size} retired), and names ${titles.size} of them in the ` +
    `words the code reports`,
);
