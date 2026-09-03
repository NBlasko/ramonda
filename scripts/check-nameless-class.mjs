import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuses a bare `constructor.name` in the framework's own source.
 *
 * ## The fault it exists for
 *
 * A class expression assigned to nothing has a `constructor` whose `name` is the empty string — a
 * factory that returns a class, a test that builds one inline, an anonymous default export. Read
 * bare and interpolated, that prints a message with no subject: `<  /> called Math.random()`,
 * `<> needs a QueryClientProvider`, `Two rows rendered by .`
 *
 * `helpers/utils.ts`'s `displayName` answers `"Unknown"` for it, and for an instance with no
 * `constructor` at all. Every message and every dedup key goes through it.
 *
 * ## Why a gate rather than a sweep
 *
 * Because the sweep was done and MISSED most of them. On 2026-09-02 the sites with an explicit
 * fallback were fixed — `?? "Unknown"`, `|| "a component"` — by grepping for those operators. The
 * sites with NO fallback at all matched neither, so twenty-nine of them survived, and one was found
 * only by reading an unrelated function three days later.
 *
 * A grep for the operators cannot find a site that has none. A grep for the READ can, which is what
 * this is. Nothing has to be remembered: a new bare read fails here.
 *
 * ## The half it does NOT cover, said plainly because the commit that added it claimed otherwise
 *
 * This finds `constructor.name` — an INSTANCE's class. Several messages hold the CLASS itself
 * instead: the hook handed to `use()`, the component on a vnode, the constructor a class decorator
 * was applied to. A class expression assigned to nothing has an empty `name` there too, and seven
 * such sites were live while this file said the family was closed. They read `className()` from
 * `helpers/utils.ts` now.
 *
 * A gate over `${x.name}` in GENERAL is not possible cheaply: it is indistinguishable from an
 * ordinary data read — `${issue.name}`, `${graph.package.name}`, `${point.name}` — and an allowlist
 * for those would be longer than the rule.
 *
 * So it covers the three spellings this codebase uses for a class, by name: `ctor`, `hook`, and a
 * vnode's `name.name`. That is narrower than the fault and wider than nothing, and it is the
 * difference between catching six sites and missing them twice — which is what happened. A future
 * `cls.name` escapes it, and the honest reading of this check is "the shapes we have written",
 * not "every shape there is".
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The reads that are NOT a message, each with the reason, and each required to still be there.
 *
 * ONE entry, and that is the point: the two syntactic rules below do the rest. A read that is
 * COMPARED rather than printed is not a subject, and a read already answered by `?? "…"` or
 * `|| "…"` is answered — `displayName` itself, `holderName`, `listHostFor`'s label and `findAll`'s
 * comparison all fall out that way and need no exception.
 *
 * An allowlist that only skips rots into silence, in two ways, and both are closed. A listed site
 * must still CONTAIN a bare read, so an entry that stops being needed is reported. And the entry
 * describes the LINE it excuses, so a different bare read added to the same file is reported rather
 * than absorbed — the lesson `check-bare-import.mjs` learned about its own table.
 */
const DECIDED = {
  "packages/core/src/debug/sourceLocation.ts": {
    why: '`recordDefinition` reads the name and BRANCHES on it being empty — a nameless class gets no source location, deliberately. `className()` answers `"Unknown"`, which is truthy, so putting it here would make that check never fire and hand every nameless class a bogus definition. Nearly done while fixing the others',
    expect: /const name = ctor\.name;/,
  },
  "packages/query/src/context.ts": {
    why: "the name is handed to `requireClient`, which answers for an empty one at the single place it is printed — and core's `displayName` is not published, so there is nothing to call here",
    expect: /requireClient\(this\.ctx\.client/,
  },
};

/** Every `.ts`/`.tsx` under a directory, walked by hand — `fs.globSync` landed in Node 22 and CI runs 20. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The code, with comments blanked out.
 *
 * Prose ABOUT the pattern is not the pattern, and there is a lot of it — every fix left a note
 * explaining what an empty name does. Matching the raw text would report the explanations and
 * nothing else would ever be believed. Line lengths are preserved so a report still points at the
 * right line.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (line) => " ".repeat(line.length));
}

const READ = /\.constructor(?:\?)?\.name\b/;

/**
 * The three spellings a CLASS's name is written in here.
 *
 * `ctor` and `hook` are the receivers this codebase uses when it holds a class rather than an
 * instance, and `vnode.name.name` is the component on a vnode. Matched by name because there is
 * nothing else to match on — a class's `.name` reads exactly like a data field's.
 *
 * **`cls` is deliberately not in the set**, and it was, for one run: in `@ramonda/check` a `cls` is
 * an AST NODE, so `cls.name?.text` is an identifier node and has nothing to do with a class value.
 * Measured — it reported `row-reads-a-plain-field.ts:221`, which was already answered with
 * `?? "(anonymous)"`.
 *
 * The lookahead is the other half of that lesson: a `.name` followed by another property is a
 * chain into something else, never the class name itself. `vnode.name.name` is the one chain that
 * IS it, and it is named rather than inferred.
 */
const CLASS_READ = /\b(?:ctor|hook)\.name\b(?!\s*[.?])|\bvnode\.name\.name\b/;

/** A read used to COMPARE rather than to name something. `=== name`, `!== other`. */
const COMPARISON = /\.constructor(?:\?)?\.name\s*(?:===|!==|==|!=)/;

/** A read whose absence is already answered: `?? "…"`, `|| "…"`. */
const GUARDED = /\.constructor(?:\?)?\.name\s*(?:\?\?|\|\|)/;

const selftest = (which) => process.env.SELFTEST === which;

function run() {
  const packages = join(root, "packages");
  const bare = [];
  const decidedSeen = new Set();
  let scanned = 0;

  for (const name of readdirSync(packages)) {
    const src = join(packages, name, "src");
    if (!existsSync(src)) continue;

    for (const file of sourceFiles(src)) {
      scanned += 1;
      const where = relative(root, file);
      const code = withoutComments(readFileSync(file, "utf8"));

      code.split("\n").forEach((line, index) => {
        if (!READ.test(line) && !CLASS_READ.test(line)) return;
        if (COMPARISON.test(line) || GUARDED.test(line)) return;
        const decided = DECIDED[where];
        if (decided !== undefined && decided.expect.test(line)) {
          decidedSeen.add(where);
          return;
        }
        // A file in the table is excused for the LINE the table describes and nothing else: an
        // entry keyed on the file alone would go on covering for whatever is added to it next.
        bare.push({ where, line: index + 1, text: line.trim() });
      });
    }
  }

  if (scanned < 100) {
    throw new Error(
      `[nameless] Scanned only ${scanned} source files, which cannot be right — the walk is broken ` +
        `and this check would pass against nothing.`,
    );
  }

  if (selftest("bare")) bare.push({ where: "(selftest)", line: 1, text: "const n = x.constructor.name;" });
  if (selftest("stale")) decidedSeen.delete(Object.keys(DECIDED)[0]);

  if (bare.length > 0) {
    throw new Error(
      `[nameless] These read \`constructor.name\` bare and put it where a reader will see it:\n` +
        bare.map(({ where, line, text }) => `        ${where}:${line}  ${text}`).join("\n") +
        `\n\n        A class expression assigned to nothing has an empty one, so the message loses its\n` +
        `        subject. Use \`displayName()\` from \`helpers/utils.ts\`, or — if the read is a\n` +
        `        comparison rather than a subject — add the file to DECIDED in\n` +
        `        scripts/check-nameless-class.mjs with the reason.`,
    );
  }

  const stale = Object.keys(DECIDED).filter((where) => !decidedSeen.has(where));
  if (stale.length > 0) {
    throw new Error(
      `[nameless] These are listed as deliberate and no longer read it:\n` +
        stale.map((where) => `        ${where} — listed because ${DECIDED[where].why}`).join("\n") +
        `\n\n        Good news, and the table has to say so: remove the entry, so the next bare read\n` +
        `        in that file is reported.`,
    );
  }

  console.log(
    `[nameless] ${scanned} source files, no bare \`constructor.name\` in a message ` +
      `(${Object.keys(DECIDED).length} decided otherwise, and still are)`,
  );
}

const planted = ["bare", "stale"].find((which) => selftest(which));

if (planted === undefined) {
  run();
} else {
  try {
    run();
  } catch {
    console.log(`[nameless] SELFTEST ${planted}: the planted fault was reported, as it must be`);
    process.exit(0);
  }
  console.error(`[nameless] SELFTEST ${planted}: the planted fault was NOT reported — this check is asleep`);
  process.exit(1);
}
