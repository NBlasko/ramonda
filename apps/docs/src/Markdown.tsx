import { Component, Host, __h } from "@ramonda/core";
import type { ComponentChild, RamondaNode } from "@ramonda/core";
import type { ContentNode } from "./content-types";
import { demos } from "./demos";
import { Demo } from "./Demo";
import { CodeBlock } from "./CodeBlock";
import { DataTable } from "./DataTable";
import type { Cell } from "./DataTable";
import { ExamplesIndex } from "./ExamplesIndex";
import { Link } from "@ramonda/router";

interface MarkdownProps {
  tree: readonly ContentNode[];
}

/**
 * Renders a built content tree as real vnodes.
 *
 * The tree comes from `scripts/build-content.mjs`, which turns markdown into
 * `{ t, a, c }` nodes at build time. Turning them into vnodes here — rather than
 * setting an HTML string — is what makes a doc page an ordinary render: the
 * server prerenders it, the client hydrates it, and a `demo:` node in the middle
 * of the prose becomes a live component like any other child.
 *
 * Recursion happens in a plain function, not by nesting a component per node. A
 * component per `<em>` would be thousands of instances per page, each with its
 * own runtime, for markup that never changes independently.
 */
@Host("div")
export class Markdown extends Component<MarkdownProps> {
  render(): RamondaNode {
    return this.props.tree.map(toVNode) as RamondaNode;
  }
}

export function toVNode(node: ContentNode): ComponentChild {
  if (typeof node === "string") return node;

  /**
   * An image is lazy and carries its own aspect ratio.
   *
   * Markdown cannot express either, and both matter on a page that illustrates a devtools panel: the
   * screenshots are below the fold, and without a ratio the text jumps as each one arrives. The size is
   * the one the capture script writes (see `scripts/shots.mjs`), so a reflow-free page costs one rule
   * rather than a per-image note in the markdown.
   */
  if (node.t === "img") {
    return __h("img", { ...node.a, loading: "lazy", decoding: "async" }) as ComponentChild;
  }

  // A Shiki code block becomes a component so it can carry a copy button. The
  // check is the `shiki` class the highlighter stamps on the `<pre>`; CodeBlock
  // renders the `<pre>` itself, so it does not route back through here.
  if (node.t === "pre" && node.a?.className?.includes("shiki")) {
    return __h(CodeBlock, { node }) as ComponentChild;
  }

  if (node.t === "demo") {
    const name = node.a?.name ?? "";
    // The examples page asks for the whole registry rather than one entry.
    if (name === "__all__") return __h(ExamplesIndex, {}) as ComponentChild;
    const demo = demos[name];
    if (!demo) {
      // Loud, and at the first render rather than as a blank space on a live
      // page. A missing demo means a page is describing something that does not
      // exist, which is worse than a broken build.
      throw new Error(
        `[docs] A page references the demo "${name}", which is not in src/demos/index.ts. ` +
          `Add it there, or fix the \`\`\`demo: fence.`,
      );
    }
    return __h(Demo, { name }) as ComponentChild;
  }

  // A prose table goes through DataTable, which is what makes it readable on a phone. Markdown can
  // only produce a plain <table>, and a plain <table> either overflows the screen or squeezes every
  // cell to two words a line. The tree is turned into columns and rows here so DataTable takes data
  // rather than markup — the same component serves a page that builds a table in TSX.
  if (node.t === "table") {
    const { columns, rows } = readTable(node);
    // A table with no header row has no column names to put above the values, so the reflow has
    // nothing to say and the plain markup is the honest fallback.
    if (columns.length > 0) return __h(DataTable, { columns, rows }) as ComponentChild;
  }

  // An in-prose link to another docs page becomes a real <Link>, so it navigates
  // client-side like the sidebar does. Markdown only ever produces a plain <a>,
  // and a plain <a> is not intercepted — it would reload the whole document.
  // External links, anchors and anything with a target are left exactly as they
  // are: those genuinely should leave the app.
  if (node.t === "a") {
    const href = node.a?.href ?? "";
    const internal = href.startsWith("/") && !node.a?.target;
    if (internal) {
      return __h(Link, { ...node.a, href }, ...(node.c?.map(toVNode) ?? [])) as ComponentChild;
    }
  }

  const children = node.c?.map(toVNode) ?? [];
  // ramonda-check-ignore the tag comes from the parsed content tree and is always an element name
  return __h(node.t, node.a ?? null, ...children) as ComponentChild;
}

/** The element children of a node, skipping the whitespace markdown-it leaves between rows. */
function elements(node: ContentNode | undefined): ContentNode[] {
  if (node === undefined || typeof node === "string") return [];
  return (node.c ?? []).filter((child): child is ContentNode => typeof child !== "string");
}

/**
 * The conversion, done once per table.
 *
 * A content tree is build output: one frozen module-level constant per page, so a node is the same
 * object on every render and its conversion can be too. Building the arrays inside `toVNode` instead
 * would hand `DataTable` a fresh `rows` on every render — the props of a component are compared by
 * reference, so nothing would ever match and RMD020 would report it, correctly.
 */
const converted = new WeakMap<object, { columns: Cell[]; rows: Cell[][] }>();

/** A built `<table>` node as the columns and rows DataTable takes. */
function readTable(node: ContentNode): { columns: Cell[]; rows: Cell[][] } {
  const cached = converted.get(node as object);
  if (cached) return cached;
  const built = buildTable(node);
  converted.set(node as object, built);
  return built;
}

function buildTable(node: ContentNode): { columns: Cell[]; rows: Cell[][] } {
  const sections = elements(node);
  const head = sections.find((section) => typeof section !== "string" && section.t === "thead");
  const body = sections.find((section) => typeof section !== "string" && section.t === "tbody");

  const cellsOf = (row: ContentNode): Cell[] =>
    elements(row).map((cell) => (typeof cell === "string" ? cell : (cell.c?.map(toVNode) ?? [])));

  const columns = elements(head).flatMap(cellsOf);
  const rows = elements(body).map(cellsOf);
  return { columns, rows };
}
