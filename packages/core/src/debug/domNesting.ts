import { diagnose } from "./diagnostics";

/**
 * DEV-only: an element the HTML parser is not allowed to keep where the JSX put it. RMD028.
 *
 * ## Why this is not visible until a page is server-rendered
 *
 * The client builds the DOM with `appendChild`, and `appendChild` puts a node exactly where it is
 * told. A `<div>` inside a `<p>` stays inside the `<p>`, the diff walks the tree it built, and
 * everything agrees. Nothing is wrong until the same markup goes through a PARSER, which follows
 * rules `appendChild` does not:
 *
 * ```
 *   the server emits:  <p>intro<div>a block</div></p>
 *   the browser parses: <p>intro</p><div>a block</div>
 * ```
 *
 * The `<p>` is closed early and the `<div>` becomes its sibling. So the mistake survives every
 * amount of SPA development and appears the moment the page is rendered on a server.
 *
 * ## Why a diagnostic rather than leaving it to hydration
 *
 * Hydration does notice — it reports RMD007, having found a tree that is not the one it rendered.
 * But it reports it as a MISMATCH, and the fix RMD007 offers is about non-determinism: move
 * `new Date()` into `@created`, do not branch on `typeof window`. None of that is the problem here.
 * The server sent the right markup and the parser moved it, so a reader following that advice is
 * looking for a bug that does not exist.
 *
 * This says what actually happened, at the moment the element is created, and names the two tags.
 *
 * ## What is listed, and what is deliberately not
 *
 * Only pairs where the parser's behaviour is defined, certain, and destructive. A diagnostic that
 * fires on correct code teaches people to ignore the category — so anything the parser merely
 * tolerates is absent, and so is anything whose correctness depends on attributes rather than tags.
 */

/**
 * `<p>` is closed by any of these, which is the single most common way to hit this.
 *
 * The parser's rule is "a `<p>` element is implicitly closed by a start tag whose content model is
 * flow content" — so this list is those tags, not a judgement about what looks reasonable.
 */
const CLOSES_P = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DETAILS",
  "DIV",
  "DL",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "MAIN",
  "MENU",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

/** A tag that may only appear inside one of these parents. */
const ONLY_INSIDE: Record<string, { parents: string[]; what: string }> = {
  LI: { parents: ["UL", "OL", "MENU"], what: "a list" },
  DT: { parents: ["DL", "DIV"], what: "a description list" },
  DD: { parents: ["DL", "DIV"], what: "a description list" },
  TR: { parents: ["TABLE", "THEAD", "TBODY", "TFOOT"], what: "a table" },
  TD: { parents: ["TR"], what: "a table row" },
  TH: { parents: ["TR"], what: "a table row" },
  THEAD: { parents: ["TABLE"], what: "a table" },
  TBODY: { parents: ["TABLE"], what: "a table" },
  TFOOT: { parents: ["TABLE"], what: "a table" },
  CAPTION: { parents: ["TABLE"], what: "a table" },
  COL: { parents: ["COLGROUP"], what: "a column group" },
  COLGROUP: { parents: ["TABLE"], what: "a table" },
  OPTION: { parents: ["SELECT", "OPTGROUP", "DATALIST"], what: "a select, optgroup or datalist" },
  OPTGROUP: { parents: ["SELECT"], what: "a select" },
  SUMMARY: { parents: ["DETAILS"], what: "a details element" },
};

/**
 * A tag that may not contain another of itself, even indirectly.
 *
 * Only the two where the parser actively repairs the markup rather than tolerating it: nested
 * `<form>`s have the inner one dropped, and nested `<a>`s have the outer one closed early.
 */
const NEVER_INSIDE_ITSELF = new Set(["FORM", "A"]);

/** What the parser does about it, said plainly, per case. */
function damage(parent: string, child: string): string {
  if (child === "P" && parent === "P") {
    return `the parser closes the first <p> before the second one starts, so they end up as siblings rather than one inside the other`;
  }
  if (CLOSES_P.has(child) && parent === "P") {
    return `<p> is closed by the start of any block element, so the parser ends the <p> and makes the <${child.toLowerCase()}> its SIBLING`;
  }
  if (parent === "FORM" && child === "FORM") {
    return `a nested <form> is dropped by the parser outright — its fields end up on the outer form, and its own submit never exists`;
  }
  if (parent === "A" && child === "A") {
    return `the parser closes the outer <a> where the inner one begins, so what follows is no longer inside the first link`;
  }
  return `the parser moves it out to somewhere it is allowed`;
}

/**
 * Checks one parent/child pair, at the moment the child is created.
 *
 * Reads `nodeName` only — no layout, no attributes, no walk — so it costs a set lookup per element
 * in a development build and nothing at all in production.
 */
export function checkNesting(parent: Node, child: Node): void {
  const parentTag = parent.nodeName;
  const childTag = child.nodeName;

  // Only element nodes have a nesting rule.
  if (parent.nodeType !== 1 || child.nodeType !== 1) return;

  const rule = ONLY_INSIDE[childTag];
  if (rule) {
    if (rule.parents.includes(parentTag)) return;

    report(
      parentTag,
      childTag,
      `<${childTag.toLowerCase()}> belongs inside ${rule.what} — ${rule.parents
        .map((p) => `<${p.toLowerCase()}>`)
        .join(", ")} — and this one is inside <${parentTag.toLowerCase()}>`,
      damage(parentTag, childTag),
    );
    return;
  }

  if (parentTag === "P" && CLOSES_P.has(childTag)) {
    report(
      parentTag,
      childTag,
      `<${childTag.toLowerCase()}> is a block element and it is inside a <p>`,
      damage(parentTag, childTag),
    );
    return;
  }

  if (NEVER_INSIDE_ITSELF.has(childTag) && parentTag === childTag) {
    report(
      parentTag,
      childTag,
      `<${childTag.toLowerCase()}> is inside another <${childTag.toLowerCase()}>`,
      damage(parentTag, childTag),
    );
  }
}

function report(parent: string, child: string, what: string, why: string): void {
  diagnose(
    "RMD028",
    `${parent}>${child}`,
    `${what}.\n${why[0]!.toUpperCase()}${why.slice(1)}.\n\n` +
      `It works on the client, where the DOM is built rather than parsed — so this is invisible until the page is server-rendered, and then it reports as a hydration mismatch (RMD007) whose advice is about something else entirely.`,
  );
}
