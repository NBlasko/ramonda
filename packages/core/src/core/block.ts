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
import {
  COMPARED_WITH_THE_ELEMENT,
  applyChangesOnAttributes,
  changedInPlace,
  dropServerOnly,
  record,
  writeHoleAttributes,
} from "./Attribute";
import { diffChildrenOf, holdsARegion } from "./DiffAndMerge";
import { nodeNameOf, normalizeChildren } from "../vdom/h";
import { COMPONENT_RUNTIME } from "./runtime";
import { checkTagNesting } from "../debug/domNesting";
import { diagnosticsGeneration } from "../debug/diagnostics";
import { SOURCE, type Source } from "../debug/source";
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
  /**
   * In a development build: the file, on the root, and each element's line and column — where the tag was
   * written, as `jsxDEV` is told it. Read by RMD020 through `viewOf`; nothing else looks at it.
   */
  readonly f?: string;
  readonly l?: readonly [number, number];
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
   * The root, built on first use in each inert document — a `<template>`'s — and imported into the page's
   * for each block. Inert, so building it constructs no custom element and loads no image: those happen
   * once, for the copy the page shows, as they do for an element `jsx()` builds. Imported rather than
   * cloned, so the copy belongs to the document it is put into from the start and nothing is adopted when
   * it goes in.
   *
   * Kept per document, weakly: a server DOM whose `<template>` shares the page's document (linkedom) builds
   * one per request document, and lets it go with that document rather than keeping it alive.
   */
  readonly roots: WeakMap<Document, Element>;
  /** In development: the static parent and child `nodeName`s, two by two, that RMD028 is asked about. */
  readonly nesting?: readonly string[];
  /** In development: the diagnostics generation this template's nesting was last checked in. */
  nestingChecked?: number;
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
  /**
   * Per child-hole site, set by hydration: the server sent more than the hole adopted, and what is left
   * goes on the next update, through the children diff, whatever the hole's value — as it goes from any
   * element the diff adopts.
   */
  unsettled?: boolean[];
  values: unknown[];
}

export type BlockVNode = VNodeString & { [BLOCK]: BlockData };

/**
 * The template's own parent and child pairs, checked against HTML's nesting rules (RMD028) where a block
 * is built — as the diff checks every element it builds — once per template, and again after the
 * diagnostics were reset. Read off the description, which is all the check needs: the names.
 */
function checkTemplateNesting(template: Template): void {
  if (template.nestingChecked === diagnosticsGeneration) return;
  template.nestingChecked = diagnosticsGeneration;
  const pairs = template.nesting as readonly string[];
  for (let i = 0; i < pairs.length; i += 2) checkTagNesting(pairs[i], pairs[i + 1]);
}

/** Whether `element` holds one text node and nothing else — the node a text hole writes straight into. */
function loneText(element: Element): boolean {
  const only = element.firstChild;
  return only !== null && only.nodeType === 3 && only.nextSibling === null;
}

/** Defines a template from its description. Called once per JSX tree, where the module is loaded. */
export function template(description: TemplateNode): Template {
  const sites: Site[] = [];
  const loneHoles: number[] = [];
  const childrenHoles: number[] = [];
  const nesting: string[] | undefined = __DEV__ ? [] : undefined;
  const walk = (node: TemplateNode, path: number[]): void => {
    if (node.d !== undefined || node.h !== undefined || node.k !== undefined) {
      const svg = svgElements.has(node.t);
      const always = node.d?.map(([name]) => COMPARED_WITH_THE_ELEMENT.has(name));
      sites.push({ path, svg, always, d: node.d, h: node.h, k: node.k });
    }
    if (node.h !== undefined) loneHoles.push(node.h);
    if (node.k !== undefined) childrenHoles.push(node.k);
    node.c?.forEach((child, index) => {
      if (typeof child === "string") return;
      nesting?.push(nodeNameOf(node.t), nodeNameOf(child.t));
      walk(child, [...path, index]);
    });
  };
  walk(description, []);
  const rootName = nodeNameOf(description.t);
  const childHoles = new Set([...loneHoles, ...childrenHoles]);
  return { description, rootName, sites, loneHoles, childrenHoles, childHoles, roots: new WeakMap(), nesting };
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

function build(node: TemplateNode, inert: Document): Element {
  const element = svgElements.has(node.t)
    ? inert.createElementNS("http://www.w3.org/2000/svg", node.t)
    : inert.createElement(node.t);
  if (node.a !== undefined) for (const name in node.a) element.setAttribute(name, node.a[name]);
  if (node.c !== undefined) {
    for (const child of node.c) {
      if (typeof child === "string") {
        element.appendChild(inert.createTextNode(child));
        continue;
      }
      element.appendChild(build(child, inert));
    }
  }
  // The text node a string or number in the child hole is written into.
  if (node.h !== undefined) element.appendChild(inert.createTextNode(""));
  return element;
}

function rootOf(template: Template): Element {
  const inert = inertDocument();
  let root = template.roots.get(inert);
  if (root === undefined) {
    root = build(template.description, inert);
    template.roots.set(inert, root);
  }
  return root;
}

/** Each page document's inert one, found once: a `<template>`'s, or the page's where it has none of its own. */
const inertDocuments = new WeakMap<Document, Document>();

function inertDocument(): Document {
  let inert = inertDocuments.get(document);
  if (inert === undefined) {
    inert = (document.createElement("template") as HTMLTemplateElement).content?.ownerDocument ?? document;
    inertDocuments.set(document, inert);
  }
  return inert;
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
  return holesInto(record(), site.d as readonly (readonly [string, number])[], values);
}

/** Each attribute hole's value, under its name, into `into`. */
function holesInto(
  into: Record<string, unknown>,
  holes: readonly (readonly [string, number])[],
  values: readonly unknown[],
): Record<string, unknown> {
  for (const [name, index] of holes) into[name] = values[index];
  return into;
}

/** How many attributes a template node bakes. */
function bakedCount(node: TemplateNode): number {
  let count = 0;
  for (const _ in node.a) count++;
  return count;
}

/**
 * Whether a hole's attribute has to go through the attribute diff: a different value, one of the names
 * the element itself may have moved away from (`always`), or an object value that may have changed in
 * place — by the attribute diff's own rule, which takes a listener object for the same listener.
 */
function attributeChanged(name: string, next: unknown, previous: unknown, always: boolean): boolean {
  return next !== previous || always || (next !== null && changedInPlace(name, next));
}

/**
 * Whether two normalized children arrays hold the same entries, and nothing in them changes on its own —
 * then there is nothing to diff. A `list()` anywhere inside rebuilds its rows only when the diff reaches
 * it, so the same entries holding one are diffed all the same (`holdsARegion`).
 */
function sameChildren(next: unknown, previous: unknown): boolean {
  if (!Array.isArray(next) || !Array.isArray(previous) || next.length !== previous.length) return next === previous;
  let markup = false;
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== previous[i]) return false;
    if (typeof next[i] === "object" && next[i] !== null) markup = true;
  }
  // Only markup can hold a region: `{cond && <b />}` while it is false is `[false]`, a fresh array every
  // render, and asking the region cache about it would file away an array that dies with the render.
  return !markup || !holdsARegion(next);
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
  if (!settle(state, siteIndex) && sameChildren(value, previous)) return;
  state.texts[siteIndex] = undefined;
  diffChildrenOf(element, isText(value) ? [String(value)] : (value as unknown[]), owner, false);
  // Back to a lone text node: the next string goes straight into it again.
  if (isText(value) && loneText(element)) state.texts[siteIndex] = element.firstChild as Text;
}

/** Whether hydration left this site unsettled (see `BlockState.unsettled`) — answered once, then cleared. */
function settle(state: BlockState, siteIndex: number): boolean {
  if (state.unsettled?.[siteIndex] !== true) return false;
  state.unsettled[siteIndex] = false;
  return true;
}

/** Each site's holes, written where they differ from `previous` — or where hydration left one unsettled. */
function writeSites(
  known: BlockState,
  values: unknown[],
  previous: unknown[],
  onServer: boolean,
  owner: MaybeComponent,
): void {
  const sites = known.template.sites;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const element = known.elements[i];
    const d = site.d;
    if (d !== undefined) {
      for (let j = 0; j < d.length; j++) {
        const index = d[j][1];
        if (attributeChanged(d[j][0], values[index], previous[index], (site.always as boolean[])[j])) {
          writeHoleAttributes(element, attributesOf(site, values), onServer);
          break;
        }
      }
    }
    if (site.h !== undefined) writeChild(known, i, element, values[site.h], previous[site.h], owner);
    if (site.k !== undefined && (settle(known, i) || !sameChildren(values[site.k], previous[site.k]))) {
      diffChildrenOf(element, values[site.k] as unknown[], owner, false);
    }
  }
}

/** A value no hole holds: what the record says after an update threw, so that every site differs from it. */
const UNKNOWN: unknown = Object.freeze({});

/**
 * Makes `root` the block's, built or adopted: where it came from, its key, and the record its updates read
 * — the elements of its sites, in the order of `template.sites`, and the values written last.
 */
function stampRoot(root: Element, vnode: BlockVNode, elements: Element[]): BlockState {
  const { template, values } = vnode[BLOCK];
  (root as unknown as Record<symbol, unknown>)[ORIGIN_SYM] = vnode[ORIGIN_SYM];
  const key = vnode.attributes.key;
  if (key != null) (root as unknown as Record<symbol, unknown>)[KEY_SYM] = key;
  const state: BlockState = { template, elements, texts: new Array(template.sites.length), values };
  (root as unknown as { [BLOCK_STATE]: BlockState })[BLOCK_STATE] = state;
  return state;
}

/** Builds or updates the element for a block vnode. `existing` is a node `areSimilarNodes` matched. */
export function applyBlock(vnode: BlockVNode, existing: Element | undefined, owner: MaybeComponent): Element {
  const { template, values } = vnode[BLOCK];
  const onServer = owner?.[COMPONENT_RUNTIME]?.env === "server";
  const known = blockStateOf(existing);

  if (existing === undefined || known === undefined || known.template !== template) {
    if (__DEV__) checkTemplateNesting(template);
    const root = document.importNode(rootOf(template), true);
    const sites = template.sites;
    const elements: Element[] = new Array(sites.length);
    const { texts } = stampRoot(root, vnode, elements);
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
  try {
    writeSites(known, values, previous, onServer, owner);
  } catch (error) {
    // Halfway: some sites hold the new values and some the old, so neither is the page's. The record is
    // made to match none, and the next update writes every site again.
    known.values = values.map(() => UNKNOWN);
    throw error;
  }
  known.values = values;
  return existing;
}

/** What `element`'s template node writes: its baked attributes, and each hole's value. */
function writtenBy(node: TemplateNode, values: readonly unknown[]): Record<string, unknown> {
  return holesInto(Object.assign(record(), node.a), node.d ?? [], values);
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
  miss: BlockMiss,
): boolean {
  if (element.nodeType !== 1 || element.nodeName !== nodeNameOf(node.t)) {
    if (__DEV__) missed(miss, `<${node.t}>`, element);
    return false;
  }
  if (node.a !== undefined) {
    for (const name in node.a) {
      const found = (element as Element).getAttribute(name);
      if (found === node.a[name]) continue;
      if (__DEV__) {
        const tag = `<${node.t}>`;
        const page = found === null ? `${tag} without ${name}` : `${name}="${found}" on ${tag}`;
        missed(miss, `${name}="${node.a[name]}" on ${tag}`, page);
      }
      return false;
    }
  }
  all.push([element as Element, node]);
  if (node.d !== undefined || node.h !== undefined || node.k !== undefined) sites.push(element as Element);
  // What a hole holds is the hole's to adopt.
  if (node.h !== undefined || node.k !== undefined) return true;
  let child = element.firstChild;
  for (const expected of node.c ?? []) {
    if (child === null) {
      if (__DEV__) missed(miss, typeof expected === "string" ? `the text "${expected}"` : `<${expected.t}>`, null);
      return false;
    }
    if (typeof expected === "string") {
      if (child.nodeType !== 3 || (child as Text).data !== expected) {
        if (__DEV__) missed(miss, `the text "${expected}"`, child);
        return false;
      }
    } else if (!matches(expected, child, sites, all, miss)) {
      return false;
    }
    child = child.nextSibling;
  }
  if (child !== null && __DEV__) missed(miss, `nothing more in <${node.t}>`, child);
  return child === null;
}

/**
 * Where a served element first differs from its template, for the report hydration makes: what the
 * template writes there, and the page's node there — or, for an attribute, the page's own words.
 */
export interface BlockMiss {
  expected: string;
  found: Node | string | null;
}

function missed(miss: BlockMiss, expected: string, found: Node | string | null): void {
  miss.expected = expected;
  miss.found = found;
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
    /**
     * An element's children, as hydration adopts any element's — text, elements, regions. Answers whether
     * the server sent more than they claimed.
     */
    children: (children: unknown[], parent: Element) => boolean;
    /** An element's attributes, as hydration adopts any element's — reported where they differ. */
    attributes: (element: Element, attributes: Record<string, unknown>) => void;
  },
  /** Filled, in development, with where the page first differs when it is not adopted. */
  miss: BlockMiss,
): boolean {
  const { template, values } = vnode[BLOCK];
  const sites = template.sites;
  const elements: Element[] = [];
  const all: (readonly [Element, TemplateNode])[] = [];
  if (!matches(template.description, root, elements, all, miss)) return false;
  // What only the server wrote — an attribute no template part or hole names, the exposed request's
  // stamp among them — goes, as it does from an element the attribute diff adopts.
  // An element with no hole holding exactly as many attributes as the template bakes holds only those —
  // `matches` found each — and has nothing to drop: the common case, and a row's every static cell.
  for (const [element, node] of all) {
    if (node.d === undefined && element.attributes.length === bakedCount(node)) continue;
    dropServerOnly(element, writtenBy(node, values), svgElements.has(node.t));
  }

  const state = stampRoot(root, vnode, elements);
  const texts = state.texts;
  const left = (i: number): void => {
    state.unsettled ??= new Array(sites.length).fill(false);
    state.unsettled[i] = true;
  };

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const element = elements[i];
    if (site.svg) (element as unknown as Record<symbol, unknown>)[IS_SVG] = true;
    if (site.d !== undefined) adopt.attributes(element, attributesOf(site, values));
    if (site.h !== undefined) {
      const value = values[site.h];
      // A string or a number is a text child like any other: the server's node is adopted, made where an
      // empty string sent none, reported where it differs. It is the text node the hole writes from then on.
      if (adopt.children(isText(value) ? [String(value)] : (value as unknown[]), element)) left(i);
      // Only while it IS the only child: what the server sent beyond it, left by a mismatch, goes on the
      // first update (`unsettled`).
      if (isText(value) && loneText(element)) texts[i] = element.firstChild as Text;
    }
    if (site.k !== undefined && adopt.children(values[site.k] as unknown[], element)) left(i);
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
  const file = template.description.f;
  const view = (node: TemplateNode, root: boolean): BlockView => {
    const attributes: Record<string, unknown> = Object.assign(record(), node.a);
    if (root && vnode.attributes.key != null) attributes.key = vnode.attributes.key;
    if (node.d !== undefined) for (const [name, index] of node.d) attributes[name] = values[index];
    let children: unknown[] = [];
    if (node.c !== undefined)
      children = node.c.map((child) => (typeof child === "string" ? child : view(child, false)));
    if (node.h !== undefined)
      children = isText(values[node.h]) ? [String(values[node.h])] : (values[node.h] as unknown[]);
    if (node.k !== undefined) children = values[node.k] as unknown[];
    const seen: BlockView = { name: nodeNameOf(node.t), attributes, children };
    // Where it was written, as an element `jsxDEV` built carries it — so RMD020 names the line here too.
    if (__DEV__ && file !== undefined && node.l !== undefined) {
      (seen as { [SOURCE]?: Source })[SOURCE] = { fileName: file, lineNumber: node.l[0], columnNumber: node.l[1] };
    }
    return seen;
  };
  return view(template.description, true);
}

/** A block's template and hole values, and which holes hold children — what a markup comparison reads. */
export function blockOf(vnode: unknown): { template: Template; values: unknown[] } | undefined {
  return (vnode as Partial<BlockVNode> | null)?.[BLOCK];
}

/** The record a block keeps on the element it made or adopted, if `node` is one. */
export function blockStateOf(node: unknown): BlockState | undefined {
  return (node as { [BLOCK_STATE]?: BlockState } | null | undefined)?.[BLOCK_STATE];
}

export function isChildHole(template: Template, index: number): boolean {
  return template.childHoles.has(index);
}
