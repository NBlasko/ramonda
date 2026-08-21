import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

/**
 * The diagnostic registry and the table that documents it, pinned to each other.
 *
 * `DIAGNOSTICS.md` is where a code is looked up — the message itself tells the
 * reader to go there — so a code that is raised but missing from the table sends
 * someone to a page that does not have the thing it just named. The docs site has
 * a tripwire for its own reference page (`apps/docs/scripts/check-api-coverage.mjs`,
 * source → reference); nothing watched the package's own table, and nothing
 * watched SEVERITY at all, which is the part a reader acts on: "error" says the
 * result is wrong, "warning" says it is only slower.
 *
 * Retired numbers are the other half. A retired code must be gone from `SPECS`
 * and gone from the live table, and still documented under "Retired codes" — a
 * number is never reassigned, so a search for it has to land somewhere that says
 * what it used to mean.
 *
 * Read from the SOURCE rather than from a list maintained by hand, because a list
 * maintained by hand is the thing that drifts.
 */

const source = readFileSync(resolve(__dirname, "../debug/diagnostics.ts"), "utf8");
const doc = readFileSync(resolve(__dirname, "../../DIAGNOSTICS.md"), "utf8");

/** The `DiagnosticCode` union members: the codes the type system admits. */
function unionCodes(): string[] {
  const union = source.slice(source.indexOf("export type DiagnosticCode"), source.indexOf("interface DiagnosticSpec"));
  return [...union.matchAll(/"(RMD\d{3})"/g)].map((match) => match[1]);
}

/**
 * Each `RMDxxx: { … severity: … }` entry in the registry, read with TypeScript's own parser.
 *
 * It was a regex, `(RMD\d{3}):\s*\{[^}]*?severity:\s*"…"`, and `[^}]*?` cannot cross a `}`. That
 * held only while every field before `severity` was a scalar — the first NESTED one silently took
 * five specs out of the map, and the failure read as "48 codes, expected 53" with nothing pointing at
 * the brace. The regex before that could not survive a comment, which is why it grew `[^}]*?` in the
 * first place; a parser ends the sequence rather than continuing it.
 *
 * Field order is not load-bearing now, which is the property worth having: a spec is an object, and
 * where `severity` sits inside it is nobody's business.
 */
function specSeverities(): Map<string, string> {
  const parsed = ts.createSourceFile(
    "diagnostics.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const found = new Map<string, string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      /^RMD\d{3}$/.test(node.name.getText(parsed)) &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const severity = node.initializer.properties.find(
        (property) => ts.isPropertyAssignment(property) && property.name.getText(parsed) === "severity",
      );
      if (severity && ts.isPropertyAssignment(severity) && ts.isStringLiteralLike(severity.initializer)) {
        found.set(node.name.getText(parsed), severity.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** The `| \`RMDxxx\` | severity | … |` rows of the Codes table. */
function tableSeverities(): Map<string, string> {
  const rows = doc.matchAll(/^\|\s*`(RMD\d{3})`\s*\|\s*(warning|error)\s*\|/gm);
  return new Map([...rows].map((match) => [match[1], match[2]]));
}

/** The numbers documented under "Retired codes". */
function retiredCodes(): string[] {
  const retired = doc.slice(doc.indexOf("## Retired codes"));
  return [...retired.matchAll(/^### (RMD\d{3}) — retired/gm)].map((match) => match[1]);
}

describe("the diagnostic registry and DIAGNOSTICS.md", () => {
  test("the parsers find what they are meant to check", () => {
    // A guard on the instrument: a regex that matched nothing would make every
    // comparison below pass while comparing nothing at all.
    expect(unionCodes().length).toBeGreaterThan(20);
    expect(specSeverities().size).toBeGreaterThan(20);
    expect(tableSeverities().size).toBeGreaterThan(20);
    expect(retiredCodes().length).toBeGreaterThan(0);

    // And they found the right SHAPE of thing, not just a lot of things.
    expect(unionCodes()).toContain("RMD001");
    expect(specSeverities().get("RMD001")).toBe("error");
    // Both severities parse — a column reader that only ever saw "error" would
    // make the comparison below agree with itself. Named as a set rather than
    // per code, so moving one code between severities does not touch this test.
    expect(new Set(tableSeverities().values())).toEqual(new Set(["warning", "error"]));
  });

  test("every code in the union has a spec, and every spec is in the union", () => {
    expect([...specSeverities().keys()].sort()).toEqual([...unionCodes()].sort());
  });

  test("every live code is in the table, and every table row is a live code", () => {
    expect([...tableSeverities().keys()].sort()).toEqual([...specSeverities().keys()].sort());
  });

  test("the table's severity is the severity the code is reported with", () => {
    const table = tableSeverities();
    const mismatched = [...specSeverities()]
      .filter(([code, severity]) => table.get(code) !== severity)
      .map(([code, severity]) => `${code}: registry says ${severity}, the table says ${table.get(code)}`);

    expect(mismatched).toEqual([]);
  });

  test("every detailed section belongs to a live code", () => {
    // Only the part above "Retired codes" — the retired ones keep their own
    // sections on purpose, which is the point of that part of the file.
    const live = doc.slice(0, doc.indexOf("## Retired codes"));
    const sections = [...live.matchAll(/^### (RMD\d{3})\b/gm)].map((match) => match[1]);
    const specs = specSeverities();

    expect(sections.length).toBeGreaterThan(20);
    // The other direction is deliberately NOT asserted: a live code may be
    // documented on the docs site instead (`apps/docs/content/reference/
    // diagnostics.md`, which has its own tripwire), and several are. What must
    // not happen is a section here for a code nothing can raise.
    expect(sections.filter((code) => !specs.has(code))).toEqual([]);
  });

  test("a retired number is out of the registry and still documented", () => {
    const specs = specSeverities();
    const table = tableSeverities();

    for (const code of retiredCodes()) {
      expect(specs.has(code), `${code} is retired but still in SPECS`).toBe(false);
      expect(table.has(code), `${code} is retired but still in the Codes table`).toBe(false);
    }
  });
});
