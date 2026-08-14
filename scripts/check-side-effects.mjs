/**
 * Checks every published package's `sideEffects` declaration against what a bundler does with it.
 *
 * ## The fault it exists for
 *
 * `@ramonda/devtools` declared `"sideEffects": false` while its entry registers `<ramonda-devtools>`
 * and installs the diagnostics bridge. A bundler is entitled to act on that, and does: bundling a bare
 * import of the built entry produced **0 bytes** — not a missing registration, the whole package. It
 * would have surfaced as "the devtools do not appear" in one configuration, with nothing to blame,
 * because nothing bundles that package that way in development.
 *
 * Nobody had looked at the field since it was written. That is what this exists to change.
 *
 * ## What it checks, and what it deliberately does not
 *
 * It does NOT try to answer "does this package have side effects" from the code. That was the first
 * design and it cannot be done reliably: `var ROOT = Object.freeze([])` is a call at module scope that
 * no consumer can observe, esbuild's own interop prologue (`__export`, `__decorateElement`) is a
 * top-level call in most bundles, and a real effect can sit inside an `if (__DEV__)` block where no
 * line-anchored pattern will find it. Three heuristics were tried and each one both missed real effects
 * and flagged harmless ones.
 *
 * So the decision lives in the table below, one line per package with the reason, and this script
 * enforces two things a tool can actually know:
 *
 * 1. **The declaration is the one we decided on.** A change to any package.json's `sideEffects` fails
 *    here until the table changes with it — the same "acknowledged twice" rule the public API surface
 *    has. A new published package with no entry fails too, which is how a field nobody looked at
 *    stopped being possible.
 *
 * 2. **The declaration does what it is meant to do**, asked of a real bundler rather than assumed.
 *    A package marked `pure` must bundle to nothing on a bare import; one marked `keeps` must not.
 *    This is the half that catches the devtools bug and every shape of it — a malformed value
 *    (`"false"` as a string), a glob that stopped matching after a rename (`./index.js` where the
 *    build now emits `./dist/index.js`), a package that gained an import-time registration since the
 *    field was written.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every published package, what its `sideEffects` says, and why.
 *
 * `pure` means the field is `false`: importing the entry does nothing a consumer can observe, so a
 * bundler may drop it whole when nothing is used from it. `keeps` means the entry does work at import
 * and must survive — declared either as a list naming the entry, or by leaving the field out, which is
 * the ecosystem's way of saying "assume there are side effects".
 */
const DECIDED = {
  core: {
    keeps: true,
    expect: undefined,
    why: "No field at all, and correct: the logger attaches a `ramonda:devtools-ready` listener at module scope, so a consumer that dropped this package would lose the devtools log replay.",
  },
  devtools: {
    keeps: true,
    expect: ["./dist/index.js"],
    why: "The entry registers `<ramonda-devtools>` and installs the diagnostics bridge. Declared as a list rather than `true` so only the entry is marked and the rest of the emitted files stay shakeable.",
  },
  lens: {
    keeps: false,
    expect: false,
    why: "Every export is a function and nothing runs on import. Earns the claim, and is the control in `@ramonda/devtools`'s packaging test for exactly that reason.",
  },
  form: {
    keeps: false,
    expect: false,
    why: "Classes and functions; the devtools announcement happens when a form mounts, not when the module loads.",
  },
  query: {
    keeps: false,
    expect: false,
    why: "Same shape as form: the cache is created by a provider, not by importing the module.",
  },
  router: {
    keeps: false,
    expect: false,
    why: "Same shape again. The router installs its listeners when the hook mounts.",
  },
  "testing-library": {
    keeps: true,
    expect: undefined,
    why: "No field, and left that way on purpose: it is a devDependency of test files that import it for its helpers, so nothing is gained by making it droppable and the safe default costs those consumers nothing.",
  },
  check: {
    keeps: true,
    expect: undefined,
    why: "A CLI, consumed through its `bin` rather than by importing it. Tree-shaking never enters the picture, and the safe default is the honest declaration.",
  },
  build: {
    keeps: false,
    expect: false,
    why: "Two plugin factories and a constant, imported by a config file that a bundler never bundles. Nothing runs on import, and the claim costs nothing to keep true.",
  },
  server: {
    keeps: false,
    expect: false,
    why: "Functions only. `installDom` writes globals, which is emphatically a side effect — but it happens when a render CALLS it, not when the module loads, and that is the distinction this field is about. Imported by a Node server that no bundler touches either way.",
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
    out.push({ name, json, entry: join(root, "packages", name, "dist", "index.js") });
  }
  return out;
}

/**
 * Prove each half can fail, and prove them SEPARATELY.
 *
 * One process observes one throw, so a single flag would leave the second check's self-test proving
 * nothing about it — the same trap `apps/docs/scripts/check-api-coverage.mjs` records.
 * `SELFTEST=table` plants a declaration the table disagrees with; `SELFTEST=honoured` plants a package
 * that bundles to nothing while claiming to keep its side effects, which is the devtools bug exactly.
 *
 * In either mode the planted fault MUST be reported, so the script exits 0 when the check fails and 1
 * when it does not — which is what lets CI chain the self-tests before the real run, the way
 * `check-workflows.mjs` does.
 */
const selftest = (which) => process.env.SELFTEST === which;

function run() {
  const packages = publishedPackages();
  if (packages.length < 8) {
    throw new Error(
      `[side-effects] Found only ${packages.length} published packages, which cannot be right — the scan ` +
        `is broken and every check below would pass against nothing.`,
    );
  }

  /* ── 1. the declaration is the one we decided on ───────────────────────────────────────────────── */

  const undecided = [];
  const changed = [];

  for (const { name, json } of packages) {
    const decision = DECIDED[name];
    if (decision === undefined) {
      // A package with no `main`/`exports` is not something a bundler ever resolves — `create-ramonda`
      // is a scaffolder run through `npx`.
      if (json.main === undefined && json.exports === undefined) continue;
      undecided.push(name);
      continue;
    }
    const actual = JSON.stringify(json.sideEffects);
    const expected = JSON.stringify(selftest("table") && name === "lens" ? "changed-by-selftest" : decision.expect);
    if (actual !== expected) changed.push(`${name}: package.json says ${actual}, the table says ${expected}`);
  }

  if (undecided.length > 0) {
    throw new Error(
      `[side-effects] These published packages have no entry in the table:\n` +
        undecided.map((name) => `        ${name}`).join("\n") +
        `\n\n        Add one to scripts/check-side-effects.mjs saying whether importing it does anything, and why.`,
    );
  }

  if (changed.length > 0) {
    throw new Error(
      `[side-effects] A \`sideEffects\` declaration changed without the table changing with it:\n` +
        changed.map((line) => `        ${line}`).join("\n") +
        `\n\n        This field decides whether a bundler may delete the package. Update the table and its reason.`,
    );
  }

  /* ── 2. the declaration does what it is meant to do ────────────────────────────────────────────── */

  const work = mkdtempSync(join(tmpdir(), "ramonda-side-effects-"));
  const wrong = [];
  const unbuilt = [];
  let measured = 0;

  try {
    for (const { name, entry } of packages) {
      const decision = DECIDED[name];
      if (decision === undefined) continue;
      if (!existsSync(entry)) {
        unbuilt.push(name);
        continue;
      }
      measured += 1;

      const source = join(work, `${name.replace("/", "-")}.js`);
      const out = `${source}.out.js`;
      writeFileSync(source, `import ${JSON.stringify(entry)};\n`);

      // `sideEffects` is read from the package.json nearest the imported FILE, so an absolute path asks
      // the same question a consumer's bare specifier asks, with no resolution to arrange.
      // `--platform=node` for one package's sake: `@ramonda/check` is a CLI and imports `path`, which
      // the browser default refuses to resolve. It changes nothing about the question being asked, which
      // is only whether the output is empty.
      const flags = ["--bundle", "--format=esm", "--minify", "--platform=node", `--outfile=${out}`];
      execFileSync("npx", ["esbuild", ...flags, source], {
        cwd: join(root, "packages", "devtools"),
        stdio: "pipe",
      });

      const kept = readFileSync(out, "utf8").trim().length;
      const survived = selftest("honoured") && name === "devtools" ? 0 : kept;

      if (decision.keeps && survived === 0) {
        wrong.push(
          `${name}: declared as keeping its side effects, but a bare import bundles to nothing — ` +
            `a consumer's build deletes the whole package`,
        );
      }
      if (!decision.keeps && survived > 0) {
        wrong.push(
          `${name}: declared pure, but ${survived} bytes survive a bare import — either the field is not ` +
            `being honoured, or the package does work at import now`,
        );
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  /**
   * Every package in the table has to have been measured, or this half proved nothing.
   *
   * Found by moving `packages/lens/dist` aside: the run skipped the package it could not read and still
   * reported that every declaration was honoured. On a fresh checkout with nothing built, that is a
   * green run over zero packages — the shape of check this repository has been bitten by before.
   */
  if (unbuilt.length > 0) {
    throw new Error(
      `[side-effects] These packages are not built, so nothing could be asked of a bundler:\n` +
        unbuilt.map((name) => `        ${name}`).join("\n") +
        `\n\n        This check reads what the build EMITTED. Run \`turbo run build\` first.`,
    );
  }

  if (measured !== Object.keys(DECIDED).length) {
    throw new Error(
      `[side-effects] Measured ${measured} of ${Object.keys(DECIDED).length} packages in the table, ` +
        `which means the loop skipped one silently.`,
    );
  }

  if (wrong.length > 0) {
    throw new Error(
      `[side-effects] A declaration does not do what the table says it does:\n` +
        wrong.map((line) => `        ${line}`).join("\n"),
    );
  }

  console.log(`[side-effects] ${packages.length} published packages, every declaration decided and honoured`);
}

const planted = ["table", "honoured"].find((which) => selftest(which));

if (planted === undefined) {
  run();
} else {
  try {
    run();
  } catch {
    console.log(`[side-effects] SELFTEST ${planted}: the planted fault was reported, as it must be`);
    process.exit(0);
  }
  console.error(`[side-effects] SELFTEST ${planted}: the planted fault was NOT reported — this check is asleep`);
  process.exit(1);
}
