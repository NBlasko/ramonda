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
 * Each `RMDxxx: { … }` entry in the registry, read with TypeScript's own parser.
 *
 * It was a regex, `(RMD\d{3}):\s*\{[^}]*?severity:\s*"…"`, and `[^}]*?` cannot cross a `}`. That
 * held only while every field before `severity` was a scalar — the first NESTED one silently took
 * five specs out of the map, and the failure read as "48 codes, expected 53" with nothing pointing at
 * the brace. The regex before that could not survive a comment, which is why it grew `[^}]*?` in the
 * first place; a parser ends the sequence rather than continuing it.
 *
 * Field order is not load-bearing now, which is the property worth having: a spec is an object, and
 * where a field sits inside it is nobody's business.
 *
 * Every string field is collected rather than only `severity`, because the same walk answers for
 * `title`, and a second regex over `title:` would land on the trap this parser exists to avoid: the
 * entries carry comments and nested objects, so a lazy match pairs one code with a LATER entry's
 * text and produces a convincing, wrong answer.
 */
function specFields(): Map<string, Map<string, string>> {
  const parsed = ts.createSourceFile(
    "diagnostics.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const found = new Map<string, Map<string, string>>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      /^RMD\d{3}$/.test(node.name.getText(parsed)) &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const fields = new Map<string, string>();
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)) {
          fields.set(property.name.getText(parsed), property.initializer.text);
        }
      }
      found.set(node.name.getText(parsed), fields);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** The severity each code is reported with. */
function specSeverities(): Map<string, string> {
  return new Map(
    [...specFields()].flatMap(([code, fields]) => {
      const severity = fields.get("severity");
      return severity === undefined ? [] : [[code, severity] as [string, string]];
    }),
  );
}

/** The one-line title each code is reported with — the first line of the message a reader sees. */
function specTitles(): Map<string, string> {
  return new Map(
    [...specFields()].flatMap(([code, fields]) => {
      const title = fields.get("title");
      return title === undefined ? [] : [[code, title] as [string, string]];
    }),
  );
}

/** The `| \`RMDxxx\` | severity | … |` rows of the Codes table. */
function tableSeverities(): Map<string, string> {
  const rows = doc.matchAll(/^\|\s*`(RMD\d{3})`\s*\|\s*(warning|error)\s*\|/gm);
  return new Map([...rows].map((match) => [match[1], match[2]]));
}

/**
 * The THIRD column of the same rows: what the table says the code is about.
 *
 * Split off `tableSeverities` rather than folded into it because the two are checked against
 * different things — the severity against `SPECS`, the wording against `SPECS[code].title` — and a
 * row missing its last column should fail one of them, not silently drop out of both.
 *
 * Backticks are stripped on both sides before comparing. The table writes `` `@compute` `` where a
 * console message writes `@compute`; that is markdown doing its job, not a difference in what the
 * two say.
 */
function tableTitles(): Map<string, string> {
  const rows = doc.matchAll(/^\|\s*`(RMD\d{3})`\s*\|\s*(?:warning|error)\s*\|\s*(.*?)\s*\|\s*$/gm);
  return new Map([...rows].map((match) => [match[1], match[2]]));
}

/** The same wording on both sides: markdown emphasis removed, runs of whitespace flattened. */
function plain(text: string): string {
  return text.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The detailed sections of the live part of the file, split into the two shapes it uses.
 *
 * `single` is `### RMDxxx — <title>`, one section per code, which is what can be compared. `ranged`
 * is `### RMD033–RMD040 — …`, one section covering eight codes, which has no single title to
 * compare against and is the one exemption.
 *
 * The exemption is written as a SHAPE rather than a list of codes, and it is narrow on purpose: a
 * heading that is neither of the two — `### RMD002 Duplicate key`, a missing dash — is returned as
 * neither and reported, instead of quietly counting as ranged and escaping the comparison.
 */
function sectionTitles(): { single: Map<string, string>; ranged: string[]; malformed: string[] } {
  const live = doc.slice(0, doc.indexOf("## Retired codes"));
  const single = new Map<string, string>();
  const ranged: string[] = [];
  const malformed: string[] = [];

  for (const [, heading] of live.matchAll(/^### (RMD\d{3}[^\n]*)$/gm)) {
    const one = /^(RMD\d{3}) — (.*)$/.exec(heading);
    if (one) {
      single.set(one[1], one[2]);
      continue;
    }
    if (/^RMD\d{3}–RMD\d{3} — .+$/.test(heading)) ranged.push(heading);
    else malformed.push(heading);
  }
  return { single, ranged, malformed };
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

    // The title side of the same instrument. Both floors matter: a `title` field renamed in the
    // registry would empty the first map, and a fourth column added to the table would empty the
    // second, and either way the comparison below would agree with nothing.
    expect(specTitles().size).toBeGreaterThan(20);
    expect(tableTitles().size).toBeGreaterThan(20);
    expect(specTitles().get("RMD001")).toBe("State written during render()");
    expect(tableTitles().get("RMD001")).toBe("State written during `render()`");

    // And the section reader, whose two shapes both have to parse: if `single` came back empty the
    // section check below would compare nothing, and if `ranged` came back empty the heading that
    // covers eight codes would be reported as a fault rather than exempted.
    const sections = sectionTitles();
    expect(sections.single.size).toBeGreaterThan(20);
    expect(sections.ranged.length).toBeGreaterThan(0);
    expect(sections.malformed, `a "### RMDxxx …" heading in neither shape`).toEqual([]);
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

  /**
   * The wording, not just the code and the severity — and this is the gate that was missing.
   *
   * A diagnostic is looked up by the sentence it printed. When the table describes the same code in
   * DIFFERENT words, a reader searching for what they just read finds nothing and concludes the
   * table is about something else. It has happened three times: RMD041 drifted until the message and
   * the reference gave two different wrong explanations of one code, and a rename left three more
   * entries describing a check that no longer worked that way.
   *
   * The title is the right thing to compare because there is exactly ONE right answer — the words
   * the code ships — where comparing the advice PROSE has none: the table is allowed to explain at
   * length, and a gate that demanded the two paragraphs match would be either wrong or ignored.
   *
   * The docs site's copy of this page has the same rule, enforced from the other side in
   * `apps/docs/scripts/check-api-coverage.mjs`, which reads this registry rather than a second list.
   */
  test("the table describes each code in the words the code reports", () => {
    const table = tableTitles();
    const drifted = [...specTitles()]
      .filter(([code, title]) => plain(table.get(code) ?? "") !== plain(title))
      .map(([code, title]) => `${code}\n  reports: ${title}\n  table:   ${table.get(code) ?? "(no third column)"}`);

    expect(drifted).toEqual([]);
  });

  /**
   * The same rule for the section a reader actually lands on.
   *
   * The table above is scanned; the section is READ, and it is the heading that says whether they
   * are in the right place. Fourteen of these agreed with the registry and fifteen did not, and the
   * shortened ones were the worse half: `### RMD004 — Props mutated` looks like a heading somebody
   * chose, so a reader who arrived searching for "Props mutated by the receiving component" cannot
   * tell whether this is their fault or a different one.
   *
   * A code with no section here is not a fault — several are documented on the site instead, which
   * the test below says. What must not happen is a section that renames the fault.
   */
  test("each single-code section is headed by the words the code reports", () => {
    const sections = sectionTitles().single;
    const drifted = [...specTitles()]
      .filter(([code]) => sections.has(code))
      .filter(([code, title]) => plain(sections.get(code) as string) !== plain(title))
      .map(([code, title]) => `${code}\n  reports: ${title}\n  section: ${sections.get(code)}`);

    expect(drifted).toEqual([]);
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
