/**
 * What the JSX compiler writes for an element tree whose shape never changes: a TEMPLATE, built once from
 * a description, and per render only the values of its holes.
 *
 * A block is an element vnode (`type: TEXT_TYPE`, a tag name, attributes holding its key) that also
 * carries `[BLOCK]`, so a list, a key and the children diff take it as any element. The element diff
 * builds it by cloning the template and filling every hole, and updates it by comparing each hole with
 * the value it wrote last — no vnode per element, no walk through the elements that cannot change.
 *
 * ## The description, which the compiler writes
 *
 * `{ t: tag, a?: { name: value }, d?: [[name, hole], …], c?: [child, …], h?: hole, k?: hole, y?: hole }`:
 *
 * - `a` — plain string attributes, set on the template once: an `id`, a `class`, an `aria-*`. Only names
 *   no rule of the attribute diff looks at belong here; the compiler decides.
 * - `d` — attributes written through the attribute diff, so every rule it keeps (a field's `value`, a
 *   listener, a `ref`, a `style`) holds: a value the render computes, or a literal that has a rule.
 * - `c` — children that never change: a string, or another description.
 * - `h` — the element's ONE child is a hole. A string or a number is written into a text node the
 *   template holds for it; anything else (an element, a list, a component, nothing) goes through the
 *   element's children diff.
 * - `k` — the element's children are a hole: the array JSX would have handed it, diffed as children are.
 *
 * Built with `createElement`, never parsed from HTML: the parser rearranges what it is given — a `<tr>`
 * straight in a `<table>` gains a `<tbody>` — and the paths to the holes would point elsewhere.
 */
import { TEXT_TYPE, ORIGIN_SYM, KEY_SYM, IS_SVG, BLOCK, svgElements } from "../helpers/constants";
import { currentOrigin } from "./origin";
import { COMPARED_WITH_THE_ELEMENT, applyChangesOnAttributes, dropServerOnly } from "./Attribute";
import { diffChildrenOf, holdsARegion } from "./DiffAndMerge";
import { normalizeChildren } from "../vdom/h";
import { COMPONENT_RUNTIME } from "./runtime";
import { checkNesting } from "../debug/domNesting";
import type { MaybeComponent, VNodeString } from "../types/vdom";

export { BLOCK };
/** On a block's root element: the template it was cloned from, the nodes its holes are on, what was written. */
export const BLOCK_STATE = Symbol("blockState");

export interface TemplateNode {
  readonly t: string;
  readonly a?: Readonly<Record<string, string>>;
  readonly d?: readonly (readonly [string, number])[];
  readonly c?: readonly (string | TemplateNode)[];
  readonly h?: number;
  readonly k?: number;
  /** On the root only: the hole holding the block's key, which the compiler keeps in source order. */
  readonly y?: number;
}

/** One element with holes: its path from the root, and what of it is a hole. */
interface Site {
  readonly path: readonly number[];
  readonly svg: boolean;
  /**
   * Per attribute hole, settled once from its name: whether it reaches the attribute diff on every
   * render (`COMPARED_WITH_THE_ELEMENT`).
   */
  readonly always?: readonly boolean[];
  readonly d?: readonly (readonly [string, number])[];
  readonly h?: number;
  readonly k?: number;
}

export interface Template {
  readonly description: TemplateNode;
  readonly rootName: string;
  readonly sites: readonly Site[];
  /** The child holes: `h` ones, normalized only when they hold markup, and `k` ones, always. */
  readonly loneHoles: readonly number[];
  readonly childrenHoles: readonly number[];
  /** Both kinds of child hole, for a comparison that asks of each hole whether it holds children. */
  readonly childHoles: ReadonlySet<number>;
  /**
   * Built on first use, where a `document` exists, and cloned for each block. On a server that renders
   * each request into a document of its own, it is the first one's: a clone is adopted by the document
   * it is put into, and what the cache keeps alive is one document per template, not one per request.
   */
  root?: Element;
}

interface BlockData {
  readonly template: Template;
  readonly values: unknown[];
}

interface BlockState {
  readonly template: Template;
  /** The element of each site, in the order of `template.sites`. */
  readonly elements: Element[];
  /** Per site with `h`: the text node a string or number is written into, while it holds one. */
  readonly texts: (Text | undefined)[];
  values: unknown[];
}

export type BlockVNode = VNodeString & { [BLOCK]: BlockData };

/** Defines a template from its description. Called once per JSX tree, where the module is loaded. */
export function template(description: TemplateNode): Template {
  const sites: Site[] = [];
  const loneHoles: number[] = [];
  const childrenHoles: number[] = [];
  const walk = (node: TemplateNode, path: number[]): void => {
    if (node.d !== undefined || node.h !== undefined || node.k !== undefined) {
      const svg = svgElements.has(node.t);
      const always = node.d?.map(([name]) => COMPARED_WITH_THE_ELEMENT.has(name));
      sites.push({ path, svg, always, d: node.d, h: node.h, k: node.k });
    }
    if (node.h !== undefined) loneHoles.push(node.h);
    if (node.k !== undefined) childrenHoles.push(node.k);
    node.c?.forEach((child, index) => {
      if (typeof child !== "string") walk(child, [...path, index]);
    });
  };
  walk(description, []);
  // A `nodeName` as the DOM gives it: an HTML tag upper case, an SVG one as written.
  const rootName = svgElements.has(description.t) ? description.t : description.t.toUpperCase();
  const childHoles = new Set([...loneHoles, ...childrenHoles]);
  return { description, rootName, sites, loneHoles, childrenHoles, childHoles };
}

/**
 * A block of `template` with this render's hole values, keyed as a list row is. Markup in a child hole is
 * normalized here, while the render runs, as JSX normalizes an element's children when it is written.
 */
export function block(template: Template, values: unknown[], key?: string | number): BlockVNode {
  const origin = currentOrigin.id;
  const lone = template.loneHoles;
  for (let i = 0; i < lone.length; i++) {
    const value = values[lone[i]];
    if (typeof value !== "string" && typeof value !== "number") values[lone[i]] = normalizeChildren([value], origin);
  }
  const children = template.childrenHoles;
  for (let i = 0; i < children.length; i++) {
    values[children[i]] = normalizeChildren(values[children[i]] as unknown[], origin);
  }
  // A key the compiler wrote among the holes, where it stood in the source.
  const keyHole = template.description.y;
  if (keyHole !== undefined) key = values[keyHole] as string | number | undefined;
  return {
    type: TEXT_TYPE,
    name: template.rootName,
    attributes: key == null ? {} : { key },
    children: [],
    [ORIGIN_SYM]: origin,
    [BLOCK]: { template, values },
  } as unknown as BlockVNode;
}

function build(node: TemplateNode): Element {
  const element = svgElements.has(node.t)
    ? document.createElementNS("http://www.w3.org/2000/svg", node.t)
    : document.createElement(node.t);
  if (node.a !== undefined) for (const name in node.a) element.setAttribute(name, node.a[name]);
  if (node.c !== undefined) {
    for (const child of node.c) {
      if (typeof child === "string") {
        element.appendChild(document.createTextNode(child));
        continue;
      }
      const built = build(child);
      // The template's own pairs, checked once, where they are made — the diff checks only what it builds.
      if (__DEV__) checkNesting(element, built);
      element.appendChild(built);
    }
  }
  // The text node a string or number in the child hole is written into.
  if (node.h !== undefined) element.appendChild(document.createTextNode(""));
  return element;
}

function rootOf(template: Template): Element {
  if (template.root === undefined) template.root = build(template.description);
  return template.root;
}

function resolve(root: Element, path: readonly number[]): Element {
  let node: Element = root;
  for (const index of path) {
    let child = node.firstChild as ChildNode;
    for (let i = 0; i < index; i++) child = child.nextSibling as ChildNode;
    node = child as Element;
  }
  return node;
}

function isText(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

/** The attributes one site's holes say now, as the attribute diff takes them. */
function attributesOf(site: Site, values: readonly unknown[]): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const [name, index] of site.d as readonly (readonly [string, number])[]) attributes[name] = values[index];
  return attributes;
}

/**
 * Whether a hole's attribute has to go through the attribute diff: a different value, one of the names
 * the element itself may have moved away from (`always`), or an object that may have changed in place.
 */
function attributeChanged(next: unknown, previous: unknown, always: boolean): boolean {
  return next !== previous || always || (typeof next === "object" && next !== null);
}

/**
 * Whether two normalized children arrays hold the same entries, and nothing in them changes on its own —
 * then there is nothing to diff. A `list()` anywhere inside rebuilds its rows only when the diff reaches
 * it, so the same entries holding one are diffed all the same (`holdsARegion`).
 */
function sameChildren(next: unknown, previous: unknown): boolean {
  if (!Array.isArray(next) || !Array.isArray(previous) || next.length !== previous.length) return next === previous;
  for (let i = 0; i < next.length; i++) if (next[i] !== previous[i]) return false;
  return !holdsARegion(next);
}

/** A child hole (`h`): a string or a number into the text node it holds, anything else as children. */
function writeChild(
  state: BlockState,
  siteIndex: number,
  element: Element,
  value: unknown,
  previous: unknown,
  owner: MaybeComponent,
): void {
  const text = state.texts[siteIndex];
  if (isText(value) && text !== undefined && text.parentNode === element) {
    if (value !== previous) text.nodeValue = String(value);
    return;
  }
  if (sameChildren(value, previous)) return;
  state.texts[siteIndex] = undefined;
  diffChildrenOf(element, isText(value) ? [String(value)] : (value as unknown[]), owner, false);
  // Back to a lone text node: the next string goes straight into it again.
  const only = element.firstChild;
  if (isText(value) && only !== null && only.nodeType === 3 && only.nextSibling === null) {
    state.texts[siteIndex] = only as Text;
  }
}

/** Builds or updates the element for a block vnode. `existing` is a node `areSimilarNodes` matched. */
export function applyBlock(vnode: BlockVNode, existing: Element | undefined, owner: MaybeComponent): Element {
  const { template, values } = vnode[BLOCK];
  const onServer = owner?.[COMPONENT_RUNTIME]?.env === "server";
  const known = (existing as { [BLOCK_STATE]?: BlockState } | undefined)?.[BLOCK_STATE];

  if (existing === undefined || known === undefined || known.template !== template) {
    const root = rootOf(template).cloneNode(true) as Element;
    (root as unknown as Record<symbol, unknown>)[ORIGIN_SYM] = vnode[ORIGIN_SYM];
    const key = vnode.attributes.key;
    if (key != null) (root as unknown as Record<symbol, unknown>)[KEY_SYM] = key;
    const sites = template.sites;
    const elements: Element[] = new Array(sites.length);
    const texts: (Text | undefined)[] = new Array(sites.length);
    const state: BlockState = { template, elements, texts, values };
    (root as unknown as { [BLOCK_STATE]: BlockState })[BLOCK_STATE] = state;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const element = resolve(root, site.path);
      elements[i] = element;
      if (site.svg) (element as unknown as Record<symbol, unknown>)[IS_SVG] = true;
      if (site.d !== undefined) applyChangesOnAttributes(element, attributesOf(site, values), onServer, true);
      if (site.h !== undefined) {
        const value = values[site.h];
        const text = element.lastChild as Text;
        // A string or a number goes into the text node the template holds; anything else is children,
        // built into an element that holds nothing once that node is gone.
        if (isText(value)) {
          text.nodeValue = String(value);
          texts[i] = text;
        } else {
          element.removeChild(text);
          diffChildrenOf(element, value as unknown[], owner, true);
        }
      }
      if (site.k !== undefined) diffChildrenOf(element, values[site.k] as unknown[], owner, true);
    }
    return root;
  }

  const previous = known.values;
  const sites = template.sites;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const element = known.elements[i];
    const d = site.d;
    if (d !== undefined) {
      for (let j = 0; j < d.length; j++) {
        const index = d[j][1];
        if (attributeChanged(values[index], previous[index], (site.always as boolean[])[j])) {
          applyChangesOnAttributes(element, attributesOf(site, values), onServer);
          break;
        }
      }
    }
    if (site.h !== undefined) writeChild(known, i, element, values[site.h], previous[site.h], owner);
    if (site.k !== undefined && !sameChildren(values[site.k], previous[site.k])) {
      diffChildrenOf(element, values[site.k] as unknown[], owner, false);
    }
  }
  known.values = values;
  return existing;
}

/** What `element`'s template node writes: its baked attributes, and each hole's value. */
function writtenBy(node: TemplateNode, values: readonly unknown[]): Record<string, unknown> {
  const written: Record<string, unknown> = { ...node.a };
  for (const [name, hole] of node.d ?? []) written[name] = values[hole];
  return written;
}

/**
 * Whether `element`, from the server, is what `node` describes: the same tag, the template's own
 * attributes, its static children text for text and element for element — and, in the order the
 * template's sites are, the element of each one, collected into `sites`. Asked once, while hydrating:
 * a static part is never compared again, so a page the server rendered from another template (another
 * route's `<div>`) has to be told apart here, or it would be kept as this one.
 */
function matches(
  node: TemplateNode,
  element: Node,
  sites: Element[],
  all: (readonly [Element, TemplateNode])[],
): boolean {
  const svg = svgElements.has(node.t);
  if (element.nodeType !== 1 || element.nodeName !== (svg ? node.t : node.t.toUpperCase())) return false;
  if (node.a !== undefined) {
    for (const name in node.a) if ((element as Element).getAttribute(name) !== node.a[name]) return false;
  }
  all.push([element as Element, node]);
  if (node.d !== undefined || node.h !== undefined || node.k !== undefined) sites.push(element as Element);
  // What a hole holds is the hole's to adopt.
  if (node.h !== undefined || node.k !== undefined) return true;
  let child = element.firstChild;
  for (const expected of node.c ?? []) {
    if (child === null) return false;
    if (typeof expected === "string") {
      if (child.nodeType !== 3 || (child as Text).data !== expected) return false;
    } else if (!matches(expected, child, sites, all)) {
      return false;
    }
    child = child.nextSibling;
  }
  return child === null;
}

/**
 * Hydration: makes `root`, an element the server rendered from the same template, this block's own —
 * nothing is built. The server wrote it with this code, so each hole's element is where the template
 * says; where one is not, `false` says so and nothing has been touched, and the block is built instead.
 * `hydrateChildren` adopts what a child hole holds as markup, the way any element's children are.
 */
export function adoptBlock(
  vnode: BlockVNode,
  root: Element,
  adopt: {
    /** An element's children, as hydration adopts any element's — text, elements, regions. */
    children: (children: unknown[], parent: Element) => void;
    /** An element's attributes, as hydration adopts any element's — reported where they differ. */
    attributes: (element: Element, attributes: Record<string, unknown>) => void;
  },
): boolean {
  const { template, values } = vnode[BLOCK];
  const sites = template.sites;
  const elements: Element[] = [];
  const all: (readonly [Element, TemplateNode])[] = [];
  if (!matches(template.description, root, elements, all)) return false;
  // What only the server wrote — an attribute no template part or hole names, the exposed request's
  // stamp among them — goes, as it does from an element the attribute diff adopts.
  for (const [element, node] of all) dropServerOnly(element, writtenBy(node, values), svgElements.has(node.t));

  (root as unknown as Record<symbol, unknown>)[ORIGIN_SYM] = vnode[ORIGIN_SYM];
  const key = vnode.attributes.key;
  if (key != null) (root as unknown as Record<symbol, unknown>)[KEY_SYM] = key;
  const texts: (Text | undefined)[] = new Array(sites.length);
  (root as unknown as { [BLOCK_STATE]: BlockState })[BLOCK_STATE] = { template, elements, texts, values };

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const element = elements[i];
    if (site.svg) (element as unknown as Record<symbol, unknown>)[IS_SVG] = true;
    if (site.d !== undefined) adopt.attributes(element, attributesOf(site, values));
    if (site.h !== undefined) {
      const value = values[site.h];
      // A string or a number is a text child like any other: the server's node is adopted, made where an
      // empty string sent none, reported where it differs. It is the text node the hole writes from then on.
      adopt.children(isText(value) ? [String(value)] : (value as unknown[]), element);
      const only = element.firstChild;
      if (isText(value) && only !== null && only.nodeType === 3) texts[i] = only as Text;
    }
    if (site.k !== undefined) adopt.children(values[site.k] as unknown[], element);
  }
  return true;
}

/** What a block's child holes hold as markup — the children a walk looking for a `list()` opens. */
export function markupOf(vnode: BlockVNode): unknown[][] {
  const { template, values } = vnode[BLOCK];
  const found: unknown[][] = [];
  for (const index of template.loneHoles) if (Array.isArray(values[index])) found.push(values[index] as unknown[]);
  for (const index of template.childrenHoles) found.push(values[index] as unknown[]);
  return found;
}

/** What a development check walks for an element: its tag, its attributes, its children. */
export interface BlockView {
  readonly name: string;
  readonly attributes: Record<string, unknown>;
  readonly children: unknown[];
}

/**
 * A block as the element tree it stands for — for the development checks that compare two renders node
 * by node (`renderStability`), which read an element's attributes and children where a block keeps them
 * in its template and its holes.
 */
export function viewOf(vnode: BlockVNode): BlockView {
  const { template, values } = vnode[BLOCK];
  const view = (node: TemplateNode, root: boolean): BlockView => {
    const attributes: Record<string, unknown> = { ...node.a };
    if (root && vnode.attributes.key != null) attributes.key = vnode.attributes.key;
    if (node.d !== undefined) for (const [name, index] of node.d) attributes[name] = values[index];
    let children: unknown[] = [];
    if (node.c !== undefined)
      children = node.c.map((child) => (typeof child === "string" ? child : view(child, false)));
    if (node.h !== undefined)
      children = isText(values[node.h]) ? [String(values[node.h])] : (values[node.h] as unknown[]);
    if (node.k !== undefined) children = values[node.k] as unknown[];
    return { name: node.t.toUpperCase(), attributes, children };
  };
  return view(template.description, true);
}

/** A block's template and hole values, and which holes hold children — what a markup comparison reads. */
export function blockOf(vnode: unknown): { template: Template; values: unknown[] } | undefined {
  return (vnode as Partial<BlockVNode> | null)?.[BLOCK];
}

export function isChildHole(template: Template, index: number): boolean {
  return template.childHoles.has(index);
}
