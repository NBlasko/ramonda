import { diagnose } from "./diagnostics";
import type { BaseComponent } from "../types/vdom";

/**
 * DEV-only reporting for server/client render divergence (RMD007).
 *
 * There is no extra render here. Hydration already renders on the client and
 * walks it against the server DOM, so every mismatch is detected at a comparison
 * the adopt path had to make anyway — we only report before it patches.
 *
 * This detects the *consequence* rather than the causes, which is what makes one
 * check cover `typeof window`, `new Date()`, `Math.random()`, localStorage reads
 * and anything else that differs across the boundary.
 */

/** Attributes that never appear in server markup, so they can't be compared. */
function isComparable(name: string, value: unknown): boolean {
  if (name === "ref" || name === "key") return false;
  if (name.startsWith("on")) return false;
  // Mirrors Attribute.ts's isInvisibleOnScreen: these render no attribute at all.
  if (value === undefined || value === null || value === false) return false;
  return typeof value !== "object" && typeof value !== "function";
}

/**
 * Compares two `style` attribute values by what they MEAN, not by their text.
 *
 * A style written by the client is the raw string from JSX; the same style that
 * went through the server's DOM comes back normalized — `display: contents`
 * becomes `display: contents;`, `COLOR:RED` becomes `color: red;`, declaration
 * order can shift. Comparing the strings reported divergence for styles that
 * were identical, which is what made RMD007 fire on markup that was perfectly
 * correct (RMD007). Anything that survives THIS comparison is a real
 * difference in what the user will see.
 *
 * Deliberately dumb about CSS: it splits on `;` and `:` rather than parsing.
 * A declaration containing either character inside a value (a `data:` URL, a
 * quoted string) will not normalize perfectly — the cost is a false report on
 * an exotic style, in DEV only, which is the safe direction to fail.
 */
function normalizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return "";
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const setting = declaration.slice(colon + 1).trim();
      if (property === "" || setting === "") return "";
      return `${property}:${setting}`;
    })
    .filter((declaration) => declaration !== "")
    .sort()
    .join(";");
}

/** Names the component that produced the markup, for the message and dedup key. */
function ownerName(owner: BaseComponent | undefined): string {
  return owner?.constructor.name ?? "root";
}

export function reportTextMismatch(owner: BaseComponent | undefined, expected: string, found: string): void {
  const name = ownerName(owner);
  diagnose(
    "RMD007",
    `${name}:text:${expected}`,
    `<${name} /> rendered the text "${expected}" but the server sent "${found}".`,
  );
}

/**
 * `expected` and `found` are already-formatted for display (`<b>`,
 * `the text "hi"`, `nothing`) — a node mismatch and a missing text node read
 * very differently, so the caller decides the wording.
 */
export function reportStructureMismatch(owner: BaseComponent | undefined, expected: string, found: string): void {
  const name = ownerName(owner);
  diagnose(
    "RMD007",
    `${name}:node:${expected}:${found}`,
    `<${name} /> rendered ${expected} but the server sent ${found}.`,
  );
}

/**
 * A component whose block in the server markup holds MORE nodes than its render produced.
 *
 * Its own diagnostic because the repair is different from the one above. An element's extra children
 * sit at the end of a level and can be left where they are; a component's sit INSIDE its markers, in
 * the middle of its parent's children — so leaving them there hands the component's node to the
 * sibling that comes after it and the whole rest of the level lands one position early. They are
 * taken out, and this says so.
 */
export function reportBlockLengthMismatch(owner: BaseComponent | undefined, extra: number): void {
  const name = ownerName(owner);
  diagnose(
    "RMD007",
    `${name}:block`,
    `<${name} />'s markup in the server output holds ${extra} node(s) more than its render produced; the extra ones are removed so the siblings after it keep their own.`,
  );
}

export function reportChildCountMismatch(
  owner: BaseComponent | undefined,
  parentTag: string,
  clientCount: number,
  serverCount: number,
): void {
  const name = ownerName(owner);
  diagnose(
    "RMD007",
    `${name}:count:${parentTag}`,
    `<${name} /> rendered ${clientCount} children inside <${parentTag}> but the server sent ${serverCount}; the extra server nodes are left in place.`,
  );
}

/**
 * Compares the client's attributes against what the server actually put on the
 * node. Only attributes the client rendered are checked: a server-only attribute
 * is usually one of ours (the state blob, the dev marker), and treating those as
 * divergence would fire on every component.
 */
export function reportAttributeMismatches(
  owner: BaseComponent | undefined,
  node: Element,
  nextAttributes: Record<string, unknown>,
): void {
  if (typeof node.getAttribute !== "function") return;

  for (const attribute in nextAttributes) {
    const value = nextAttributes[attribute];
    if (!isComparable(attribute, value)) continue;

    // Ramonda normalizes to the JSX spelling; the DOM's names are `class` and `for`.
    const domName = attribute === "className" ? "class" : attribute === "htmlFor" ? "for" : attribute;

    const found = node.getAttribute(domName);
    if (found === null) continue;

    const expected = String(value);
    if (found === expected) continue;

    // `style` is compared by meaning: the server's copy came back through the
    // DOM, which rewrites it. See normalizeStyle.
    if (domName === "style" && normalizeStyle(found) === normalizeStyle(expected)) {
      continue;
    }

    const name = ownerName(owner);
    diagnose(
      "RMD007",
      `${name}:attr:${node.nodeName}:${domName}`,
      `<${name} /> rendered ${domName}="${expected}" on <${node.nodeName.toLowerCase()}> but the server sent ${domName}="${found}".`,
    );
  }
}
