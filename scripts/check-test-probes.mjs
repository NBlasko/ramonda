import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Refuses a debug probe left behind in a test.
 *
 * ## The fault it exists for
 *
 * While chasing a completion bug on 2026-09-07 I wrote a dozen throwaway probes, each of the shape
 *
 *     const say = (t) => process.stdout.write(`\n>>> ${t}`);
 *
 * and one of them survived into `viteBuild.test.ts` through a GREEN gate. The test still passed, the
 * types were fine, and what finally caught it was `oxlint` complaining about a control character in
 * an unrelated regex — by accident. A probe that survives is noise in every future run of that file
 * and a lie about what the test asserts.
 *
 * ## Why the AST and not a grep
 *
 * Both obvious markers are wrong. `>>>` is an OPERATOR — `(low + high) >>> 1` is in `core/Task.ts` —
 * and `process.stdout.write` appears legitimately inside a STRING in `toolingCli.test.ts`, which
 * writes a fake CLI to disk for the tool runner to execute. Measured: a grep for either reports both.
 *
 * A call expression is a call expression. Read off the AST there is nothing to be clever about, and
 * a probe inside a string stays what it is — a string.
 *
 * ## Why tests only
 *
 * `cli.ts` writes to stdout because that is what a CLI does, and the browser specs print through
 * Playwright's own reporter. This is about a file whose job is to ASSERT: anything it prints is
 * either a leftover or belongs in the assertion.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** What a probe is called, read off the AST rather than matched in text. */
const FORBIDDEN = new Set(["process.stdout.write", "process.stderr.write", "console.debug"]);

/**
 * Deliberate exceptions, each with the reason it is one.
 *
 * Empty, and it is meant to stay that way — but the shape is here because every other check in this
 * directory learned the same lesson: a rule with no way to say "this one is on purpose" is a rule
 * somebody switches off instead.
 */
const DECIDED = {};

function tests(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      tests(path, found);
      continue;
    }
    if (/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/** `a.b.c` for a property access chain, or `undefined` for anything else. */
function chain(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const left = chain(node.expression);
  return left === undefined ? undefined : `${left}.${node.name.text}`;
}

function probesIn(path) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found = [];

  const walk = (node) => {
    if (ts.isCallExpression(node)) {
      const called = chain(node.expression);
      if (called !== undefined && FORBIDDEN.has(called)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({ called, line: line + 1 });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  return found;
}

function run() {
  const files = [...tests(join(root, "packages")), ...tests(join(root, "apps"))];
  const reported = [];
  const seen = new Set();

  for (const path of files) {
    const where = relative(root, path);
    for (const probe of probesIn(path)) {
      if (DECIDED[where] !== undefined) {
        seen.add(where);
        continue;
      }
      reported.push(`        ${where}:${probe.line} — ${probe.called}`);
    }
  }

  if (reported.length > 0) {
    throw new Error(
      `[probes] ${reported.length} debug probe(s) left in a test:\n\n${reported.join("\n")}\n\n` +
        `        A test's job is to assert. Anything it prints is either a leftover from chasing\n` +
        `        something — which is what this exists for — or belongs in an assertion, where a\n` +
        `        future reader can see what it claims.\n\n` +
        `        If it is deliberate, add the file to DECIDED in scripts/check-test-probes.mjs with\n` +
        `        the reason.`,
    );
  }

  const stale = Object.keys(DECIDED).filter((where) => !seen.has(where));
  if (stale.length > 0) {
    throw new Error(
      `[probes] These are listed as deliberate and no longer print anything:\n` +
        stale.map((where) => `        ${where} — listed because ${DECIDED[where]}`).join("\n") +
        `\n\n        Remove the entry, so the next probe in that file is reported.`,
    );
  }

  console.log(`[probes] ${files.length} test files, none of them printing`);
}

/**
 * The check checked, the way every other one here is.
 *
 * A gate that cannot fail is a gate nobody notices has stopped working — and this one is exactly the
 * kind that rots, because the fault it looks for is rare and nobody would miss the message.
 */
if (process.env.SELFTEST === "probe") {
  // A real file with a real probe in it, read by the real reader — the only selftest worth having.
  const planted = join(tmpdir(), `probe-${process.pid}.test.ts`);
  writeFileSync(
    planted,
    'import { test } from "vitest";\n' + 'test("x", () => {\n  process.stdout.write("looking at something");\n});\n',
  );

  const found = probesIn(planted);
  rmSync(planted, { force: true });

  if (found.length === 1 && found[0].called === "process.stdout.write") {
    console.log("[probes] SELFTEST probe: the planted fault was reported, as it must be");
    process.exit(0);
  }
  console.error("[probes] SELFTEST probe: the planted fault was NOT reported — this check is asleep");
  process.exit(1);
}

// And the string case, which is why this reads the AST: a probe inside a string is a string.
if (process.env.SELFTEST === "string") {
  const planted = join(tmpdir(), `string-${process.pid}.test.ts`);
  writeFileSync(
    planted,
    'import { test } from "vitest";\n' +
      'test("x", () => {\n  const script = `process.stdout.write("hi")`;\n  void script;\n});\n',
  );

  const found = probesIn(planted);
  rmSync(planted, { force: true });

  if (found.length === 0) {
    console.log("[probes] SELFTEST string: a probe inside a string is left alone, as it must be");
    process.exit(0);
  }
  console.error("[probes] SELFTEST string: a STRING was reported as a probe — this check is too eager");
  process.exit(1);
}

run();
