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
 * That happened, and it reached a browser — see BUGS.md, "TC39 decorators
 * survived the bundle, and only an accident hid it". The transform that strips
 * them was being applied for an unrelated reason (`esbuild.jsxInject`), so
 * removing an option nothing seemed to depend on silently broke the output.
 *
 * Nothing checked it, which is the only reason it shipped. This is that check.
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
import { readdir, stat } from "node:fs/promises";
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
  for (const entry of await readdir(target, { withFileTypes: true })) {
    // `pagefind` ships its own prebuilt bundle; it is not ours to vouch for,
    // and it contains generated code that is none of this check's business.
    if (entry.isDirectory() && entry.name === "pagefind") continue;
    await collect(join(target, entry.name), out);
  }
}

function check(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--check", file], (error, _stdout, stderr) => {
      resolve(error ? { file, message: firstUsefulLine(stderr) } : undefined);
    });
  });
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
