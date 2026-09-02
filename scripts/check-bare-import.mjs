import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/**
 * Imports every published package's built entry in a bare Node process, and fails if it throws.
 *
 * ## The fault it exists for
 *
 * `debug/logger.ts` called `window.addEventListener` at MODULE LOAD inside `if (__DEV__)`, with no
 * check for a DOM. The development build is the `default` export condition and replaces `__DEV__`
 * with `true`, so `import "@ramonda/core"` in a Node process with no DOM threw
 * `ReferenceError: window is not defined` before the caller's first line ran.
 *
 * Nothing in the repository could see it. Our own SSR installs its DOM shim first
 * (`@ramonda/server`'s `dom.ts`), the test suites run under jsdom, and `check-side-effects.mjs`
 * bundles the entry rather than executing it — a bundler never evaluates the module. What a user
 * does that we did not: a script, a CLI, a codegen step, a test runner in the node environment, or
 * an app that imports the framework before installing its shim.
 *
 * Found from the other side: `debug/timerGuard.ts` guards the same thing at the same moment and
 * always did, and its guard reads as dead because no suite can enter it. It is the one place that
 * had it right.
 *
 * ## What it checks
 *
 * Both builds, because they are different code: the development entry carries every `if (__DEV__)`
 * block and the production one has them stripped, so a module-load effect can exist in one and not
 * the other. The import is all that runs — nothing is called — because the claim is only that
 * loading the package cannot take a process down.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The packages that MUST throw, with the reason, and the check asserts they still do.
 *
 * An exception written as "skip" rots into silence: the day devtools stops needing a DOM at load,
 * or the day another package starts needing one, the table would say nothing. So a listed package
 * is required to fail, and one that stops failing is reported too.
 */
const BROWSER_ONLY = {
  "@ramonda/devtools": {
    why: "its entry registers the <ramonda-devtools> custom element, so it extends HTMLElement at module load",
    // The failure has to be the one written down. Asking only "did it still fail?" would let a broken
    // build — a SyntaxError, a missing dependency — read as "still browser-only, as expected", and the
    // table would be covering for it.
    expect: /HTMLElement is not defined/,
  },
};

/** Published means somebody installs it: a private package is never resolved by a consumer. */
function publishedPackages() {
  const out = [];
  for (const name of readdirSync(join(root, "packages"))) {
    const manifest = join(root, "packages", name, "package.json");
    if (!existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, "utf8"));
    if (json.private === true) continue;
    out.push({ name: json.name, dir: join(root, "packages", name) });
  }
  return out;
}

/** The two builds a consumer can resolve, when they exist. */
function entriesOf(dir) {
  return [
    { build: "development", file: join(dir, "dist", "index.js") },
    { build: "production", file: join(dir, "dist", "index.prod.js") },
  ].filter((entry) => existsSync(entry.file));
}

/**
 * How long one import may take before it counts as a failure.
 *
 * A gate that can HANG is worse than one that fails: CI spends the job's whole budget and says
 * nothing. And the shape it hangs on is the shape this hunts — a module-load `setInterval` keeps the
 * event loop alive, so the child never exits and `execFileSync` waits for ever. Measured: without
 * this it waited until something else killed it.
 *
 * Generous on purpose. A cold `import` of a built entry is tens of milliseconds here; the limit is
 * for a process that is never going to finish, not for a slow machine.
 */
const IMPORT_TIMEOUT_MS = 30_000;

/** Imports one file in its own process, and answers with what went wrong or `undefined`. */
function importFails(file) {
  try {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(file).href)})`],
      {
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf8",
        timeout: IMPORT_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );
    return undefined;
  } catch (error) {
    // A timeout is its own answer, and it has to say so: `stderr` is empty for one, so the branch
    // below would report "exited non-zero" about a process that never exited at all.
    if (error.killed === true || error.signal !== null) {
      return `did not finish importing within ${IMPORT_TIMEOUT_MS / 1000}s — something at module load is keeping the process alive`;
    }
    const stderr = String(error.stderr ?? "");
    return (
      stderr
        .split("\n")
        .find((line) => /Error/.test(line))
        ?.trim() ?? "exited non-zero"
    );
  }
}

const selftest = (which) => process.env.SELFTEST === which;

function run() {
  const packages = publishedPackages();
  if (packages.length < 5) {
    throw new Error(
      `[bare-import] Found only ${packages.length} published packages, which cannot be right — the ` +
        `scan is broken and every check below would pass against nothing.`,
    );
  }

  const broke = [];
  const noLongerBrowserOnly = [];
  const unbuilt = [];
  let checked = 0;

  for (const pkg of packages) {
    const browserOnly = BROWSER_ONLY[pkg.name];
    const entries = entriesOf(pkg.dir);
    // A package with no built entry is SKIPPED, and a skip is what this must not do quietly: the
    // floor below counts entries, so one package dropping out of the run leaves it comfortably
    // above the limit and the report reads exactly as it does today. Every published package has a
    // development entry — measured, all eleven — so the absence of one is a build that did not run.
    if (entries.length === 0) unbuilt.push(pkg.name);
    for (const entry of entries) {
      checked += 1;
      let failure = importFails(entry.file);
      if (selftest("import") && pkg.name === "@ramonda/core" && entry.build === "development") {
        failure = "ReferenceError: (selftest) window is not defined";
      }
      if (selftest("browser") && browserOnly !== undefined) failure = undefined;
      if (selftest("reason") && browserOnly !== undefined) failure = "SyntaxError: (selftest) something else";

      if (browserOnly === undefined) {
        if (failure !== undefined) broke.push({ pkg: pkg.name, build: entry.build, failure });
      } else if (failure === undefined) {
        noLongerBrowserOnly.push({ pkg: pkg.name, build: entry.build, why: browserOnly.why });
      } else if (!browserOnly.expect.test(failure)) {
        // Listed, still failing, and failing at something else — which the table must not absorb.
        broke.push({
          pkg: pkg.name,
          build: entry.build,
          failure: `${failure}\n          (listed as browser-only for ${browserOnly.expect}, which this is not)`,
        });
      }
    }
  }

  if (selftest("unbuilt")) unbuilt.push("(selftest) @ramonda/nothing");

  if (unbuilt.length > 0) {
    throw new Error(
      `[bare-import] These published packages have no built entry to import:\n` +
        unbuilt.map((name) => `        ${name}`).join("\n") +
        `\n\n        Run \`turbo run build\` first. A package with nothing to import is skipped, and a\n` +
        `        skip here looks exactly like a pass.`,
    );
  }

  if (checked < 8) {
    throw new Error(
      `[bare-import] Only ${checked} built entries were found. Run \`turbo run build\` first — with ` +
        `nothing to import, this check passes without importing anything.`,
    );
  }

  if (broke.length > 0) {
    throw new Error(
      `[bare-import] These built entries cannot be imported in a Node process with no DOM:\n` +
        broke.map(({ pkg, build, failure }) => `        ${pkg} (${build}) — ${failure}`).join("\n") +
        `\n\n        Importing a package must not run anything that needs a browser. A module-load\n` +
        `        effect belongs behind \`typeof window !== "undefined"\`, the way\n` +
        `        core's debug/timerGuard.ts does it.`,
    );
  }

  if (noLongerBrowserOnly.length > 0) {
    throw new Error(
      `[bare-import] These are listed as browser-only and now import cleanly:\n` +
        noLongerBrowserOnly
          .map(({ pkg, build, why }) => `        ${pkg} (${build}) — listed because ${why}`)
          .join("\n") +
        `\n\n        Good news, and the table has to say so: remove the entry from BROWSER_ONLY in\n` +
        `        scripts/check-bare-import.mjs so the next regression is caught.`,
    );
  }

  console.log(
    `[bare-import] ${checked} built entries across ${packages.length} published packages import ` +
      `cleanly with no DOM (${Object.keys(BROWSER_ONLY).length} browser-only, and still are)`,
  );
}

const planted = ["import", "browser", "reason", "unbuilt"].find((which) => selftest(which));

if (planted === undefined) {
  run();
} else {
  try {
    run();
  } catch {
    console.log(`[bare-import] SELFTEST ${planted}: the planted fault was reported, as it must be`);
    process.exit(0);
  }
  console.error(`[bare-import] SELFTEST ${planted}: the planted fault was NOT reported — this check is asleep`);
  process.exit(1);
}
