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
      "for:emial",
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

/**
 * A form control with nothing to say what it is for.
 *
 * The `htmlFor` half is why this lives with the id table: `<label htmlFor="email">` and
 * `<input id="email">` are frequently not in the same render, and the pairing is a project fact.
 *
 * The two rules split one subject deliberately. A `placeholder` DOES give a control an accessible
 * name, so calling such a control unnamed would be false — and told they have "no label" for a
 * field with a placeholder in it, somebody reasonably decides the checker is wrong and stops
 * reading it. The first version of this rule made exactly that mistake, and this repository's own
 * six reports were all of them placeholder-only.
 */
describe("a form control with no label", () => {
  test("only the controls with nothing naming them are reported", () => {
    const found = run("id-table").findings["control-with-no-label"];
    expect(found.map((issue) => issue.tag)).toEqual(["input", "textarea"]);
  });

  /** Four ways to be named, and each is written in the fixture beside the ones that are not. */
  test("a for, a wrapping label, aria and title all count as a name", () => {
    const found = run("id-table").findings["control-with-no-label"];
    // Fifteen controls in the fixture; two are nameless.
    expect(found).toHaveLength(2);
  });

  /**
   * `htmlFor` names nothing in Ramonda — it renders as `htmlfor`, measured through the framework —
   * but a control it points at is still NOT called nameless. Somebody is naming that control, and
   * telling them there is no label sends them looking for the wrong thing: the fault on that line
   * is the attribute, not the absence of one.
   */
  test("a control a htmlFor points at is not called nameless", () => {
    const found = run("id-table").findings["control-with-no-label"];
    expect(found).toHaveLength(2);
  });

  test("a placeholder is not called nameless — it is its own report", () => {
    const findings = run("id-table").findings;
    expect(findings["named-only-by-a-placeholder"].map((issue) => issue.tag)).toEqual(["input"]);
    // And the placeholder-only one is NOT in the other rule's list.
    expect(findings["control-with-no-label"]).toHaveLength(2);
  });

  /**
   * `control-with-no-label` does NOT share the family's project-wide silence, and that is a real
   * distinction: its claim is about one control and that control's own id, so an unreadable id
   * somewhere else says nothing about it. The opaque fixture proves both halves at once — the
   * control whose own id is unreadable is skipped, the one beside it is still reported.
   */
  test("it keeps working in a project the other two rules have gone quiet in", () => {
    const findings = run("id-table-opaque").findings;
    expect(findings["fragment-link-to-nowhere"]).toEqual([]);
    expect(findings["control-with-no-label"]).toHaveLength(1);
  });
});
