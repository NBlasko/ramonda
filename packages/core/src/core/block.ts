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
 * `{ t: tag, a?: { name: value }, d?: [[name, hole], …], c?: [child, …], h?: hole, k?: hole }`:
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
import { TEXT_TYPE, ORIGIN_SYM, KEY_SYM, IS_SVG, svgElements } from "../helpers/constants";
import { currentOrigin } from "./origin";
import { applyChangesOnAttributes } from "./Attribute";
import { diffChildrenOf, holdsARegion } from "./DiffAndMerge";
import { normalizeChildren } from "../vdom/h";
import { COMPONENT_RUNTIME } from "./runtime";
import type { MaybeComponent, VNodeString } from "../types/vdom";

export const BLOCK = Symbol("block");
/** On a block's root element: the template it was cloned from, the nodes its holes are on, what was written. */
export const BLOCK_STATE = Symbol("blockState");

export interface TemplateNode {
  readonly t: string;
  readonly a?: Readonly<Record<string, string>>;
  readonly d?: readonly (readonly [string, number])[];
  readonly c?: readonly (string | TemplateNode)[];
  readonly h?: number;
  readonly k?: number;
}

/** One element with holes: its path from the root, and what of it is a hole. */
interface Site {
  readonly path: readonly number[];
  readonly svg: boolean;
  /** The `nodeName` the element at `path` has — what hydration checks the page against. */
  readonly nodeName: string;
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
  /** Built on first use, where a `document` exists, and cloned for each block. */
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
      sites.push({ path, svg, nodeName: svg ? node.t : node.t.toUpperCase(), d: node.d, h: node.h, k: node.k });
    }
    if (node.h !== undefined) loneHoles.push(node.h);
    if (node.k !== undefined) childrenHoles.push(node.k);
    node.c?.forEach((child, index) => {
      if (typeof child !== "string") walk(child, [...path, index]);
    });
  };
  walk(description, []);
  return { description, rootName: description.t.toUpperCase(), sites, loneHoles, childrenHoles };
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
  return {
    type: TEXT_TYPE,
    name: template.rootName,
    attributes: key === undefined ? {} : { key },
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
    for (const child of node.c)
      element.appendChild(typeof child === "string" ? document.createTextNode(child) : build(child));
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

/** Whether a hole's new value has to be written: a different value, or an object that may have changed. */
function attributeChanged(name: string, next: unknown, previous: unknown): boolean {
  if (next !== previous) return true;
  return typeof next === "object" && next !== null && !name.startsWith("on");
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
        // A string or a number goes into the text node the template holds; anything else is children.
        if (isText(value)) {
          text.nodeValue = String(value);
          texts[i] = text;
        } else {
          diffChildrenOf(element, value as unknown[], owner, false);
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
        if (attributeChanged(d[j][0], values[index], previous[index])) {
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

/** The element at `path` under `root`, or `undefined` where the page has no node there. */
function find(root: Element, path: readonly number[]): Element | undefined {
  let node: Node | null = root;
  for (const index of path) {
    node = (node as Node).firstChild;
    for (let i = 0; i < index && node !== null; i++) node = node.nextSibling;
    if (node === null) return undefined;
  }
  return node as Element;
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
  hydrateChildren: (children: unknown[], parent: Element) => void,
): boolean {
  const { template, values } = vnode[BLOCK];
  const sites = template.sites;
  const elements: Element[] = new Array(sites.length);
  for (let i = 0; i < sites.length; i++) {
    const element = find(root, sites[i].path);
    if (element === undefined || element.nodeName !== sites[i].nodeName) return false;
    elements[i] = element;
  }

  (root as unknown as Record<symbol, unknown>)[ORIGIN_SYM] = vnode[ORIGIN_SYM];
  const key = vnode.attributes.key;
  if (key != null) (root as unknown as Record<symbol, unknown>)[KEY_SYM] = key;
  const texts: (Text | undefined)[] = new Array(sites.length);
  (root as unknown as { [BLOCK_STATE]: BlockState })[BLOCK_STATE] = { template, elements, texts, values };

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const element = elements[i];
    if (site.svg) (element as unknown as Record<symbol, unknown>)[IS_SVG] = true;
    // Read from the page, as an adopted element's attributes are: what only the server wrote goes.
    if (site.d !== undefined) applyChangesOnAttributes(element, attributesOf(site, values));
    if (site.h !== undefined) {
      const value = values[site.h];
      if (isText(value)) {
        // The server's text node, or a new one where it sent none — an empty string sends nothing.
        let text = element.firstChild;
        if (text === null || text.nodeType !== 3) {
          text = document.createTextNode("");
          element.insertBefore(text, element.firstChild);
        }
        if ((text as Text).data !== String(value)) (text as Text).data = String(value);
        texts[i] = text as Text;
      } else {
        hydrateChildren(value as unknown[], element);
      }
    }
    if (site.k !== undefined) hydrateChildren(values[site.k] as unknown[], element);
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
