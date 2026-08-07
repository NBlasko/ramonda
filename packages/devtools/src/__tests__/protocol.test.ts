// @vitest-environment node
// Reads the reporters' source off disk and touches no DOM. Declared rather than inherited,
// because the package's jsdom default cannot resolve `node:` builtins once NODE_ENV is set —
// a failure that appears on a runner and not here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toDevLog } from "../diagnostics";

const record = (over: Partial<RamondaDiagnostic> = {}): RamondaDiagnostic => ({
  code: "RML004",
  scope: "ramonda/lens",
  severity: "warn",
  message: ".posts has 2 element(s), so index 9 is out of range.",
  fix: "A negative index counts from the end.",
  data: { path: ".posts", index: 9, length: 2 },
  time: 1_760_000_000_000,
  ...over,
});

/**
 * The two hand-written copies of the record, compared.
 *
 * The protocol is deliberately a shape and a global name rather than a module, so
 * that a reporting package can have no dependencies — and the price of that is a
 * declaration in every package, which is a copy, which drifts. This is the
 * tripwire for the drift that would actually hurt: a field renamed on one side, or
 * a severity one side maps and the other does not, which is silent in both
 * directions. TypeScript cannot catch it, because the copies never meet in one
 * program.
 *
 * Read from source rather than listed here, so a new field has to be added on both
 * sides or this fails.
 */
describe("the record, as every package declares it", () => {
  const declarationIn = (file: string): string => {
    const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
    const start = source.indexOf("interface RamondaDiagnostic {");
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("\n  }", start));
  };

  const fieldsOf = (declaration: string): string[] =>
    [...declaration.matchAll(/^\s{4}(\w+)\??:/gm)].map(([, name]) => name).sort();

  const severitiesOf = (declaration: string): string[] =>
    [...declaration.matchAll(/"(debug|info|warn|error)"/g)].map(([, name]) => name).sort();

  const HERE = "../diagnostics.ts";
  const REPORTERS = [
    "../../../lens/src/diagnostics.ts",
    "../../../query/src/diagnostics.ts",
    "../../../form/src/diagnostics.ts",
    "../../../core/src/debug/diagnostics.ts",
  ];

  it("names the same fields everywhere", () => {
    const collector = fieldsOf(declarationIn(HERE));

    // The five a collector may assume, plus the three it must not require.
    expect(collector).toEqual(["code", "data", "dedupKey", "fix", "message", "scope", "severity", "time"]);
    for (const reporter of REPORTERS) expect(fieldsOf(declarationIn(reporter))).toEqual(collector);
  });

  it("agrees on the severities, so none of them maps to a default by accident", () => {
    const collector = severitiesOf(declarationIn(HERE));

    expect(collector).toEqual(["debug", "error", "info", "warn"]);
    for (const reporter of REPORTERS) expect(severitiesOf(declarationIn(reporter))).toEqual(collector);
  });

  it("maps every severity the record can hold", () => {
    // The `?? "info"` fallback in `toDevLog` is for a FOREIGN severity, not for one
    // of ours going unmapped — this is what says the fallback is never our own bug.
    for (const severity of severitiesOf(declarationIn(HERE)) as RamondaDiagnostic["severity"][]) {
      expect(toDevLog(record({ severity })).type).not.toBe(undefined);
    }
    expect(toDevLog(record({ severity: "error" })).type).toBe("error");
  });
});
