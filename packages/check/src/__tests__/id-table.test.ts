import { describe, expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../analyze";

const here = dirname(fileURLToPath(import.meta.url));
const run = (name: string) => analyzeProject(join(here, "fixtures", name, "tsconfig.json"));

/**
 * The fifth subject: the whole project, and the ids in it.
 *
 * What makes this a subject of its own is the pairing. A fragment link lives in a navigation bar
 * and the heading it points at lives in a page component — the fixture puts them in two files on
 * purpose, because a per-render rule could see one end of that and never the other.
 *
 * It is also the only family that needs TWO passes. The question is about absence, and absence
 * cannot be established from a file nobody has opened yet.
 */
describe("a fragment link pointing at nothing", () => {
  test("the typo is reported and both real targets are not, across files", () => {
    const found = run("id-table").findings["fragment-link-to-nowhere"];
    expect(found.map((issue) => issue.target)).toEqual(["pricng"]);
  });

  /**
   * A template can only produce strings starting with its first literal chunk, so `#row-3` is one
   * `` id={`row-${row.id}`} `` could have made. That is a proof rather than a guess, and it is what
   * keeps a list's generated ids from silencing the whole table.
   */
  test("an id a template could have produced is not called missing", () => {
    const found = run("id-table").findings["fragment-link-to-nowhere"];
    expect(found.some((issue) => issue.target === "row-3")).toBe(false);
  });
});

describe("an id reference resolving to nothing", () => {
  test("aria and htmlFor references are checked, and a list is checked entry by entry", () => {
    const found = run("id-table").findings["reference-to-an-id-that-is-not-there"];
    expect(found.map((issue) => `${issue.attribute}:${issue.target}`)).toEqual([
      "aria-labelledby:blrb",
      "htmlFor:emial",
      "aria-controls:panel-that-never-was",
    ]);
  });

  /**
   * `aria-labelledby="pricing blurb"` is TWO references, and reading it as one id would report a
   * working pair as missing. Asserted because it is the shape most easily got wrong.
   */
  test("both halves of a two-id list resolve, and neither is reported", () => {
    const found = run("id-table").findings["reference-to-an-id-that-is-not-there"];
    expect(found.some((issue) => issue.target === "blurb" || issue.target === "pricing")).toBe(false);
  });
});

/**
 * The silence contract at project scope, which is the decision this family stands on.
 *
 * One `id={generated}` says the author builds ids at runtime, so "nothing carries this id" is no
 * longer provable about anything — and the whole family goes quiet, not just that element.
 */
describe("a project with an id this cannot read", () => {
  test("both rules say nothing at all", () => {
    const findings = run("id-table-opaque").findings;
    expect(findings["fragment-link-to-nowhere"]).toEqual([]);
    expect(findings["reference-to-an-id-that-is-not-there"]).toEqual([]);
  });

  /**
   * A prop that happens to be called `id` is not a document id, and must not silence anything.
   *
   * The first version of this table did exactly that. Run against `apps/docs` it went completely
   * quiet, and the cause was `<ProfileCard id={this.id} />` — a PROFILE's id, handed to
   * `getProfile()` and never near the DOM. Two rules switched off across a whole project by a
   * field name.
   *
   * The narrowing is safe rather than convenient: a component's `id` prop reaches the document only
   * if that component writes it onto a host element, and that host element is in the source too,
   * where it silences the family on its own terms.
   */
  test("an `id` prop on a component does not silence the family", () => {
    const findings = run("id-table").findings;
    expect(findings["fragment-link-to-nowhere"].map((issue) => issue.target)).toEqual(["pricng"]);
    expect(findings["reference-to-an-id-that-is-not-there"]).toHaveLength(3);
  });

  /** The very same references ARE reported in a project whose ids are all readable. */
  test("and the same shapes are reported where every id is readable", () => {
    const findings = run("id-table").findings;
    expect(findings["fragment-link-to-nowhere"].length).toBeGreaterThan(0);
    expect(findings["reference-to-an-id-that-is-not-there"].length).toBeGreaterThan(0);
  });
});
