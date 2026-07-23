import { diagnose } from "./diagnostics";
import { HOST_TAG, svgNamespaceUri } from "../helpers/constants";
import type { EnhancedChildNode } from "../types/vdom";

/**
 * DEV-only: the default host is layout-neutral, but it is still an element, and
 * a few parents accept only specific children. The developer cannot be expected
 * to know which — so tell them, using the one thing that makes it decidable: at
 * mount we are holding the actual parent node.
 *
 * Everything here is about markup that has to survive the HTML parser. A host
 * inside <tbody> works fine on the client (nothing parses it, and
 * display:contents lets the real <tr> underneath take part in table layout), and
 * breaks the moment the same tree is serialized and read back — which is exactly
 * what SSR + hydration do.
 */

/**
 * Parents whose content model rejects an unknown element. The HTML parser does
 * not merely dislike it: for the table family it **foster-parents** the host,
 * moving it out in front of the <table>. Measured, the damage is worse than the
 * host landing in the wrong place — the host is moved out EMPTY while its
 * children are re-parsed into the table on their own:
 *
 *   <table><tbody><ramonda-host><tr>..</tr></ramonda-host></tbody></table>
 *   parses to
 *   <ramonda-host></ramonda-host><table><tbody><tr>..</tr></tbody></table>
 *
 * So the component's element and the content it rendered end up in different
 * subtrees, and the state blob rides out of the table on an empty host.
 */
interface HostSuggestion {
  /** The tag to reach for first. */
  host: string;
  /** Equally valid tags for the same slot, when the choice is the developer's. */
  also?: string;
}

const SUGGESTION_BY_PARENT: Record<string, HostSuggestion> = {
  TABLE: { host: "tbody", also: "thead, tfoot, caption or colgroup" },
  THEAD: { host: "tr" },
  TBODY: { host: "tr" },
  TFOOT: { host: "tr" },
  TR: { host: "td", also: "th" },
  SELECT: { host: "option", also: "optgroup" },
  OPTGROUP: { host: "option" },
};

/**
 * This list is short because it was measured, not reasoned about, by
 * round-tripping the host through the parser under every restricted parent.
 *
 *   TABLE / TBODY / TR   host foster-parented out, empty
 *   SELECT / OPTGROUP    host deleted outright ("in select" ignores unknown tags)
 *   UL / OL / DL / P     survive untouched
 *
 * `<ul>` and `<ol>` are the trap: their content model says "only <li>", so they
 * look like they belong here — but foster-parenting is a table rule, and the
 * parser leaves them alone. Warning on them would fire on `<ul>{items.map(...)}
 * </ul>`, the most common list in any app, for no defect at all. Being invalid
 * per the spec is the developer's business; being silently destroyed is ours.
 */

function isSvg(node: Node): boolean {
  return (node as Element).namespaceURI === svgNamespaceUri;
}

export function checkHostPlacement(parent: Node, child: ChildNode): void {
  // Only the default host. An explicit @Host is the developer's call.
  if (child.nodeName !== HOST_TAG) return;

  const name = (child as EnhancedChildNode)._componentInstance?.constructor.name ?? "A component";

  if (isSvg(parent)) {
    diagnose(
      "RMD010",
      `${name}:svg`,
      `<${name} /> has the default host inside <${parent.nodeName.toLowerCase()}>, which is SVG. The host is created as an HTML element, and SVG renders only SVG-namespace content, so the subtree is dropped. Worse, serializing and re-parsing puts the same tag in the SVG namespace instead, so the two sides disagree about what the node even is.`,
      { suggestion: `@Host("g")` },
    );
    return;
  }

  const suggestion = SUGGESTION_BY_PARENT[parent.nodeName];
  if (!suggestion) return;

  const { host, also } = suggestion;
  const tag = parent.nodeName.toLowerCase();
  const damage =
    parent.nodeName === "SELECT" || parent.nodeName === "OPTGROUP"
      ? `the parser discards unknown elements inside <select> outright, so the host — and the state blob on it — simply vanishes, leaving the <${host}>s it rendered behind`
      : `the parser moves an unknown element out in front of the <table> and re-parses its children into the table separately, so the host ends up outside the table, empty, while the <${host}>s it rendered end up inside: two subtrees, with the state blob stranded on the wrong one`;

  diagnose(
    "RMD010",
    `${name}:${parent.nodeName}`,
    `<${name} /> has the default host inside <${tag}>, which only accepts <${host}>${also ? ` (or ${also})` : ""}. It works on the client, where nothing parses the markup — but ${damage}.\n` +
      `Become the <${host}>: give it @Host("${host}") and render what goes inside it. render() may return an array, so one <${host}> with several children is fine — you only need a second component when you need a second <${host}>.`,
    { suggestion: `@Host("${host}")` },
  );
}
