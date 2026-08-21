import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = () => analyzeProject(join(here, "fixtures", "id-table-hop", "tsconfig.json"));

/**
 * A project that keeps its ids in one module — and what that used to cost.
 *
 * The id table read only a literal, so `id={SUMMARY_ID}` was an id it could not read; one of those
 * anywhere silences `reference-to-an-id-that-is-not-there` for the whole project, and the
 * `<label htmlFor={EMAIL_ID}>` pairing was invisible on top of it. Naming ids once is the ordinary
 * way to keep two references agreeing, so the shape that switched this family off is the shape a
 * careful project is likeliest to have.
 */
describe("the id table, one hop from the literal", () => {
  test("a reference that resolves through a name is not reported", () => {
    const findings = run().findings;

    // `aria-labelledby="summary"` against `<h2 id={SUMMARY_ID}>`, and `#summary` against the same.
    for (const issue of findings["reference-to-an-id-that-is-not-there"]) expect(issue.target).toBe("sumary");
    for (const issue of findings["fragment-link-to-nowhere"]) expect(issue.target).toBe("sumary");
  });

  test("and the faults beside it are still reported, which the silence used to take away", () => {
    const findings = run().findings;

    expect(findings["reference-to-an-id-that-is-not-there"]).toHaveLength(1);
    expect(findings["fragment-link-to-nowhere"]).toHaveLength(1);
  });

  /**
   * An id written in `@Host` props is on the page and is in no JSX element, and it was the same
   * fault in two more spellings: `id: OVERVIEW_ID` silenced the family exactly as the JSX one did,
   * and `({ id })` was read by nothing — not even as unreadable — so a link to it would have been
   * reported as going nowhere.
   */
  test("an id in `@Host` props counts, written long or short", () => {
    const targets = run().findings["fragment-link-to-nowhere"].map((issue) => issue.target);

    expect(targets).not.toContain("overview");
    expect(targets).not.toContain("filters");
    expect(targets).toEqual(["sumary"]);
  });

  /** `<label htmlFor={EMAIL_ID}>` names `<input id={EMAIL_ID}>`, and both halves are a name away. */
  test("a control labelled through a name is not called unlabelled", () => {
    expect(run().findings["control-with-no-label"]).toHaveLength(0);
  });
});
