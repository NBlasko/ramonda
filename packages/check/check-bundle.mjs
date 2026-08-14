#!/usr/bin/env node
/**
 * Parses every JavaScript file a build emitted, and fails if any of them is not
 * parseable.
 *
 * ## Why this exists
 *
 * TC39 decorators are not parseable JavaScript in any engine yet, so a build
 * that fails to strip them produces a bundle that dies with
 * `SyntaxError: Invalid or unexpected token` the moment a browser reads it.
 * That happened, and it reached a browser: the transform that strips them was
 * being applied for an unrelated reason (`esbuild.jsxInject` put an import in
 * every module, which forced every module through it), so removing an option
 * nothing seemed to depend on silently broke the output.
 *
 * Nothing checked it, which is the only reason it shipped. This is that check.
 * It runs over this repository's builds and over yours — a project scaffolded
 * with `npm create ramonda` ends its `build` with it, because the setting that
 * makes the transform happen is one line of bundler config, and the failure it
 * guards is invisible until the first page load.
 *
 * ## Why it PARSES rather than grepping for `@`
 *
 * A grep for decorator syntax is both weaker and wrong. Weaker, because a
 * decorator is only one way to emit unparseable output. Wrong, because a bundle
 * may legitimately CONTAIN decorator text inside a string literal — the docs
 * site ships every demo's source that way, so `@Host("div")` appears in its
 * chunks as data. A parser does not care what is inside a string; that is
 * exactly the distinction being asked for.
 *
 * `node --check` is the right oracle rather than a JS parser library, because
 * the failure being guarded against is "no engine can read this", and this is
 * the engine.
 *
 * Usage: ramonda-check-bundle <dir-or-file> [...]
 */
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const JS = /\.(m?js|cjs)$/;

/** Parallel enough to stay quick on the docs site's ~100 chunks. */
const CONCURRENCY = 8;

async function collect(target, out) {
  const info = await stat(target);
  if (info.isFile()) {
    if (JS.test(target)) out.push(target);
    return;
  }
  // No directory is skipped. There WAS one exception — a folder named `pagefind`, because this
  // repository's docs site ships a prebuilt search bundle it did not author. That was written when
  // this tool was private to the workspace, and it stopped being defensible the moment the tool
  // shipped: a name that means "search index" here means nothing in someone else's project, and a
  // check that quietly declines to look at part of the output is worse than one that does not run.
  //
  // It was dead where it was written, too — `apps/docs` passes `dist/assets .build`, and its
  // indexing step runs AFTER this check. Point the command at what you want checked; that is the
  // control, not a name this file happens to know.
  for (const entry of await readdir(target, { withFileTypes: true })) {
    await collect(join(target, entry.name), out);
  }
}

/**
 * What Node says when it read a module as a script.
 *
 * A `.js` file is a script or a module depending on the nearest `package.json`,
 * and a bundler emits ES modules into `dist` whatever that file declares — so
 * `"type": "commonjs"` beside ESM output is an ordinary arrangement. Read as a
 * script, such a bundle "does not parse", and this tool blamed a decorator for
 * it. Accusing a correct build of the one bug the guard exists to find is worse
 * than not running.
 *
 * These four are what the parser can say about a module-only construct; each is
 * a reason to ask the second question, never an answer on its own.
 */
const PARSED_AS_SCRIPT = [
  "Cannot use import statement outside a module",
  "Unexpected token 'export'",
  "Cannot use 'import.meta' outside a module",
  "await is only valid in async functions",
];

function parses(args, source) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, args, (error, _stdout, stderr) => {
      resolve({ ok: !error, message: firstUsefulLine(stderr) });
    });
    if (source !== undefined) child.stdin.end(source);
  });
}

/**
 * Parseable as EITHER a script or a module is the question being asked — the
 * failure guarded against is "no engine can read this", and an engine reading
 * this file knows which of the two it is even when this tool cannot.
 *
 * The second parse only ever runs after the first has failed, and only on the
 * messages above, so nothing that parses as a script takes a different path and
 * no failure is downgraded: a decorator is unparseable both ways.
 */
async function check(file) {
  const asScript = await parses(["--check", file]);
  if (asScript.ok) return undefined;
  if (!PARSED_AS_SCRIPT.some((m) => asScript.message.includes(m))) {
    return { file, message: asScript.message };
  }

  const asModule = await parses(["--input-type=module", "--check"], await readFile(file, "utf8"));
  return asModule.ok ? undefined : { file, message: asModule.message };
}

/**
 * Node prints the offending source line, a caret, a blank line, then the
 * message. The message is the useful part; the source line is often a whole
 * minified chunk.
 */
function firstUsefulLine(stderr) {
  const line = String(stderr)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^(SyntaxError|ReferenceError|TypeError)\b/.test(l));
  return line ?? String(stderr).trim().split("\n")[0] ?? "unparseable";
}

async function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: ramonda-check-bundle <dir-or-file> [...]");
    process.exit(2);
  }

  const files = [];
  for (const target of targets) {
    try {
      await collect(target, files);
    } catch (error) {
      console.error(`[check-bundle] cannot read ${target}: ${error.message}`);
      process.exit(2);
    }
  }

  if (files.length === 0) {
    // A build that emitted nothing is a failure that would otherwise pass
    // silently — which is the same shape as the bug this guards.
    console.error(`[check-bundle] no JavaScript found in: ${targets.join(", ")}`);
    process.exit(2);
  }

  const failures = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
      while (next < files.length) {
        const failure = await check(files[next++]);
        if (failure) failures.push(failure);
      }
    }),
  );

  if (failures.length > 0) {
    console.error(`[check-bundle] ${failures.length} of ${files.length} emitted file(s) do not parse:\n`);
    for (const { file, message } of failures.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ${relative(process.cwd(), file)}\n    ${message}`);
    }
    console.error(
      "\nA bundle that does not parse fails at load with no stack worth reading.\n" +
        "If these contain decorators, the build is not running a transform that strips them.",
    );
    process.exit(1);
  }

  console.log(`[check-bundle] ${files.length} emitted file(s) parse`);
}

main();
