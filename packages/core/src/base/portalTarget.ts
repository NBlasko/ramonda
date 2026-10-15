/**
 * A portal target named rather than pointed at, so it can exist on the server.
 *
 * ## Why a name
 *
 * `Portal` takes a live `Element`, and for a target inside your own render that
 * is right: you have the node, and aiming at it is how "inline" is done. It
 * cannot work for a target OUTSIDE the app's root — the `<div>` a modal lives in
 * so it escapes a stacking context — because on the server that div does not
 * exist. The shell is a string the app assembles AFTER the render returns, so
 * while the tree is being built there is nothing to point at. That is the whole
 * reason a body target used to be client-only.
 *
 * A name has the property an element cannot: it means the same thing on both
 * sides. The server collects into a container of its own and hands the markup
 * back on `page.portals`; the client resolves the name to the element the shell
 * emitted, and adopts the block inside it.
 *
 * ## Why not a selector string
 *
 * `target: "#modal-root"` reads well and fails silently. A selector is a
 * statement about markup the portal does not own, so the day the shell changes
 * the portal simply stops finding it, at runtime, in production. A token is one
 * value that both the portal and the document builder import, and a name nobody
 * emits is a container this creates rather than a portal that quietly renders
 * nowhere.
 */

/** How a target container is marked, in the served HTML and in the DOM. */
export const PORTAL_TARGET_ATTR = "data-ramonda-portal-target";

const IS_TARGET = Symbol("ramondaPortalTarget");

export interface PortalTarget {
  readonly [IS_TARGET]: true;
  readonly name: string;
}

export function portalTarget(name: string): PortalTarget {
  return { [IS_TARGET]: true, name };
}

export function isPortalTarget(value: unknown): value is PortalTarget {
  return value !== null && typeof value === "object" && (value as PortalTarget)[IS_TARGET] === true;
}

/**
 * The containers a server render is collecting into, by name.
 *
 * Module level, and reset per render by `renderPage` — the same shape `Head`
 * uses, and for the same reason: a server process renders many pages through one
 * document, and a container left behind would serve one request's modal to the
 * next one.
 */
const collecting = new Map<string, Element>();

/**
 * The element a portal should render into for this target.
 *
 * On the server that is a DETACHED container — nothing is in the document, and
 * `collectPortalTargets` reads it back. On the client it is the container the
 * shell emitted, or a fresh one appended to the body: a client-only app never
 * receives a shell container, and building one keeps a portal from being a
 * feature that works only on server-rendered pages.
 */
export function resolvePortalTarget(target: PortalTarget, onServer: boolean): Element {
  if (onServer) {
    let container = collecting.get(target.name);
    if (container === undefined) {
      container = document.createElement("div");
      collecting.set(target.name, container);
    }
    return container;
  }

  const existing = document.querySelector(`[${PORTAL_TARGET_ATTR}="${cssEscape(target.name)}"]`);
  if (existing !== null) return existing;

  const created = document.createElement("div");
  created.setAttribute(PORTAL_TARGET_ATTR, target.name);
  document.body.appendChild(created);
  return created;
}

/**
 * The containers this render collected into.
 *
 * Handed out so `ssr.ts` can stamp state blobs into them before reading them
 * back — a component inside a portal is on a node the body walk never visits,
 * and without its blob it reaches the client with nothing to restore.
 */
export function portalTargetContainers(): Iterable<Element> {
  return collecting.values();
}

/** What every named target collected this render, as markup. */
export function collectPortalTargets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, container] of collecting) {
    if (container.innerHTML !== "") out[name] = container.innerHTML;
  }
  return out;
}

/** Drops this render's containers. Called on both sides of a page render. */
export function resetPortalTargets(): void {
  collecting.clear();
}

/**
 * Quotes a name for use inside an attribute selector.
 *
 * A name is written by the app, not by a user, so this is not a security
 * boundary — it is so that a perfectly reasonable name with a quote or a bracket
 * in it does not turn into a selector that throws.
 */
function cssEscape(name: string): string {
  return name.replace(/["\\]/g, "\\$&");
}
