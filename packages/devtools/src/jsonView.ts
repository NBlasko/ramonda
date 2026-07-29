import { escapeHtml } from "./format";

/**
 * A value as a collapsible tree — the thing a one-line preview kept failing to be.
 *
 * ## Why this exists
 *
 * Every value in the panel used to be `JSON.stringify` on one clipped line, and the cap moved
 * twice: 120 → 2000 in the query bridge, 200 → 8000 for state and props. Both times the ellipsis
 * came back, because the sizes that matter are not near any cap — an infinite query holding eight
 * pages of products is a hundred kilobytes, and no line length makes that readable. Length was
 * never the problem. Structure was.
 *
 * So a value is rendered the way a browser renders one: keys and types coloured, containers
 * labelled with their size, and everything past the first level collapsed until you ask. What you
 * scan is `pages: Array(8)`, not the first 2000 characters of it.
 *
 * ## Bounded, and honest about it
 *
 * Two limits, and it takes both. A **node budget** stops a hundred thousand rows going into the
 * DOM at once; a **depth cap** stops a cyclic value recursing until the stack goes (the same pair
 * the query package's structural sharing needs, for the same reason — the budget alone was tried
 * there and a cycle blew the stack long before it ran out). A cycle is also caught directly, by
 * ancestry, so it is reported rather than merely truncated.
 *
 * Whatever is dropped SAYS it was dropped, in the row where it was dropped. A tree that quietly
 * stops is a tree that lies about what the app holds.
 */

export interface JsonViewOptions {
  /** Levels that start expanded. 1 shows an object's own keys and nothing deeper. */
  openDepth?: number;
  /** How many rows may be emitted before the rest becomes a marker. */
  budget?: number;
  /** How deep to walk before stopping. */
  maxDepth?: number;
}

/** Inline, inside a component row: enough to recognise a value, not enough to fill the panel. */
export const INLINE: JsonViewOptions = { openDepth: 1, budget: 400, maxDepth: 20 };

/** The full view, which the reader asked for explicitly and can scroll. */
export const FULL: JsonViewOptions = { openDepth: 2, budget: 20_000, maxDepth: 40 };

interface Walk {
  left: number;
  openDepth: number;
  maxDepth: number;
  /** Ancestors, so a cycle is named as one instead of being cut off at the depth cap. */
  seen: Set<unknown>;
}

export function renderJsonHtml(value: unknown, options: JsonViewOptions = INLINE): string {
  const walk: Walk = {
    left: options.budget ?? INLINE.budget!,
    openDepth: options.openDepth ?? 1,
    maxDepth: options.maxDepth ?? 20,
    seen: new Set(),
  };
  return `<div class="jv">${row(undefined, value, walk, 0)}</div>`;
}

/** `Array(8)`, `{4 keys}`, `"text"` — what a container looks like before you open it. */
export function summarize(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isPlain(value)) {
    const keys = Object.keys(value);
    return keys.length === 0 ? "{}" : `{${keys.length} ${keys.length === 1 ? "key" : "keys"}}`;
  }
  return leafText(value);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function leafText(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "ƒ()";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    // A Date, a Map, a class instance: not walked, because equality and shape for those are the
    // app's business. Its own `toString` is more use than `{}`.
    const name = value.constructor?.name ?? "Object";
    try {
      const text = String(value);
      return text === "[object Object]" ? name : `${name} ${text}`;
    } catch {
      return name;
    }
  }
  return String(value);
}

function leafClass(value: unknown): string {
  if (typeof value === "string") return "jv-s";
  if (typeof value === "number" || typeof value === "bigint") return "jv-n";
  if (typeof value === "boolean") return "jv-b";
  if (value === null || value === undefined) return "jv-null";
  if (typeof value === "function") return "jv-f";
  return "jv-o";
}

/** `key: ` — absent at the root, where the value has no name of its own. */
function keyHtml(key: string | undefined): string {
  return key === undefined ? "" : `<span class="jv-k">${escapeHtml(key)}</span><span class="jv-c">:</span> `;
}

function row(key: string | undefined, value: unknown, walk: Walk, depth: number): string {
  if (walk.left-- <= 0) return "";

  const container = Array.isArray(value) || isPlain(value);
  if (!container) {
    return `<div class="jv-row">${keyHtml(key)}<span class="${leafClass(value)}">${escapeHtml(leafText(value))}</span></div>`;
  }

  if (walk.seen.has(value)) {
    return `<div class="jv-row">${keyHtml(key)}<span class="jv-cut">[circular]</span></div>`;
  }
  if (depth >= walk.maxDepth) {
    return `<div class="jv-row">${keyHtml(key)}<span class="jv-cut">${escapeHtml(summarize(value))} — too deep to show</span></div>`;
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);

  if (entries.length === 0) {
    return `<div class="jv-row">${keyHtml(key)}<span class="jv-meta">${Array.isArray(value) ? "Array(0)" : "{}"}</span></div>`;
  }

  walk.seen.add(value);
  let body = "";
  let shown = 0;
  for (const [childKey, childValue] of entries) {
    if (walk.left <= 0) break;
    body += row(childKey, childValue, walk, depth + 1);
    shown++;
  }
  walk.seen.delete(value);

  // Says what it dropped, where it dropped it.
  const dropped = entries.length - shown;
  if (dropped > 0) {
    body += `<div class="jv-row"><span class="jv-cut">… ${dropped} more — open the full view</span></div>`;
  }

  const open = depth < walk.openDepth ? " open" : "";
  return `<details class="jv-node"${open}><summary class="jv-sum">${keyHtml(key)}<span class="jv-meta">${escapeHtml(
    summarize(value),
  )}</span></summary><div class="jv-body">${body}</div></details>`;
}

/** The pretty text behind the copy button — the whole value, not the bounded view of it. */
export function toPrettyText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
