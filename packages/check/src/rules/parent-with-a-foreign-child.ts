import ts from "typescript";
import { positionOf } from "../syntax";
import { openingOf } from "./element";
import type { ElementContext, ElementRule } from "./rule";

/**
 * A container whose children have to be one particular tag, holding something else.
 *
 * `<ul><div>…</div></ul>`, `<select><span>…</span></select>`, `<table><div>…</div></table>`. This
 * is the MIRROR of `tag-needs-its-parent`, which asks whether a child is in the right parent; this
 * asks whether a parent is holding the right children. Neither answers the other: a `<div>` is
 * legal almost everywhere, so nothing about it is wrong until you see where it sits.
 *
 * ## What breaks, and it is not only the parser
 *
 * A list is not styling — it is a COUNT. Assistive technology announces "list, 5 items" and offers
 * a way to step through them, and it computes that count from the `<li>` children. A stray element
 * in between breaks the run: some readers announce the wrong number, some end the list early and
 * start a second one, and the reader is told there are three items where there are seven. That is
 * worse than no list at all, because it is confidently wrong.
 *
 * The parser makes it worse again for `<table>` and `<select>`, which have strict content models:
 * a foreign child is MOVED out of the element, so the tree the browser builds is not the tree in the
 * source. Hydration then reports it as `RMD007`, a server/client mismatch, and sends the reader
 * looking for a clock or a random number that is not there — the same trap `tag-needs-its-parent`
 * documents from the other side.
 *
 * ## The wrapper is what makes this common
 *
 * Nobody writes `<ul><div/></ul>` on purpose. They write `<ul>{rows.map(…)}</ul>` and later wrap a
 * row in a `<div>` for layout, or add a `<Tooltip>` around one, and the list quietly stops being a
 * list. Nothing on screen changes, because the CSS was on the row all along.
 *
 * ## What it will not claim
 *
 * **Anything it cannot see.** A component child, or an expression, may render exactly the right tag
 * — `{rows.map(row => <li …/>)}` is how every real list is built. Only a tag written OUT and known
 * to be wrong is reported.
 *
 * **A tag that is allowed to be there beside the main one.** A `<table>` takes `<caption>` and
 * `<colgroup>`; a `<select>` takes `<optgroup>`; a `<dl>` takes both `<dt>` and `<dd>`. Those are in
 * the table below rather than assumed away.
 *
 * **`<template>` and a script**, which are allowed anywhere and are not rendered content.
 */
export interface ParentWithAForeignChildIssue {
  /** The container. */
  parent: string;
  /** The child that does not belong in it. */
  child: string;
  /** What the container does take, for the sentence the report needs. */
  takes: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Containers whose children are fixed by the content model, and what each one takes.
 *
 * Read from the HTML specification's content models, and deliberately only the containers whose
 * rule is short enough to write down exactly. `<figure>`, `<details>` and `<fieldset>` take flow
 * content beside their one special child and are not here — there is nothing foreign to find.
 */
const TAKES_ONLY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["ul", new Set(["li", "script", "template"])],
  ["ol", new Set(["li", "script", "template"])],
  ["menu", new Set(["li", "script", "template"])],
  ["dl", new Set(["dt", "dd", "div", "script", "template"])],
  ["select", new Set(["option", "optgroup", "hr", "script", "template"])],
  ["optgroup", new Set(["option", "script", "template"])],
  ["datalist", new Set(["option", "script", "template"])],
  ["table", new Set(["caption", "colgroup", "thead", "tbody", "tfoot", "tr", "script", "template"])],
  ["thead", new Set(["tr", "script", "template"])],
  ["tbody", new Set(["tr", "script", "template"])],
  ["tfoot", new Set(["tr", "script", "template"])],
  ["tr", new Set(["td", "th", "script", "template"])],
  ["picture", new Set(["source", "img", "script", "template"])],
]);

/** What the container takes, said the way a reader would say it. */
function takesWhat(parent: string): string {
  const allowed = [...(TAKES_ONLY.get(parent) ?? [])].filter((tag) => tag !== "script" && tag !== "template");
  if (allowed.length === 1) return `<${allowed[0]}>`;
  const last = allowed.at(-1);
  return `${allowed
    .slice(0, -1)
    .map((tag) => `<${tag}>`)
    .join(", ")} and <${last}>`;
}

export const parentWithAForeignChild = {
  id: "parent-with-a-foreign-child",

  report: {
    severity: "warn",
    reportedWhen: "a container whose children are fixed by the content model holds a tag that is not one of them",
    heading: (found) => `${found.length} container(s) holding a tag that does not belong in them:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.child}> inside <${issue.parent}>, which takes ${issue.takes}.`,
    ],
    advice:
      'A list is not styling, it is a COUNT. Assistive technology announces "list, 5 items" and\n' +
      "offers a way to step through them, and it works that count out from the `<li>` children. A\n" +
      "stray element in between breaks the run — some readers announce the wrong number, some end\n" +
      "the list early and start a second one — and a reader told there are three items where there\n" +
      "are seven is worse off than one told nothing.\n\n" +
      "`<table>` and `<select>` are stricter again: the parser MOVES a foreign child out of the\n" +
      "element, so the tree the browser builds is not the tree in the source. Hydration then reports\n" +
      "that as `RMD007`, a server/client mismatch, and sends you looking for a clock or a random\n" +
      "number that is not there.\n\n" +
      "Put the wrapper INSIDE the item rather than around it:\n\n" +
      "```tsx\n" +
      "<li>\n" +
      '  <div className="row">…</div>\n' +
      "</li>\n" +
      "```\n\n" +
      "Nobody writes this on purpose. It arrives when a row gets wrapped for layout, or a tooltip is\n" +
      "put around one, and nothing on screen changes — the CSS was on the row all along.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(_element, { tag, children }: ElementContext) {
    if (tag === undefined) return [];
    const allowed = TAKES_ONLY.get(tag);
    if (allowed === undefined) return [];

    const found: ParentWithAForeignChildIssue[] = [];
    for (const child of children) {
      // An expression or a component may render exactly the right tag, and `{rows.map(…)}` is how
      // every real list is built. Only a tag written OUT and known to be wrong is reported.
      if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;
      const opening = ts.isJsxElement(child) ? child.openingElement : child;
      const name = opening.tagName.getText();
      if (/^[A-Z]/.test(name) || name.includes(".")) continue;

      const lowered = name.toLowerCase();
      if (allowed.has(lowered)) continue;

      found.push({ parent: tag, child: lowered, takes: takesWhat(tag), ...positionOf(openingOf(child)) });
    }
    return found;
  },
} as const satisfies ElementRule<ParentWithAForeignChildIssue>;
