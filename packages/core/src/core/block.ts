/**
 * PROTOTYPE — what a JSX compiler would emit for an element tree whose shape never changes: a TEMPLATE
 * (the static part, parsed once) and, per render, only the values of its holes.
 *
 * A block is an element vnode (`type: TEXT_TYPE`, a tag name, attributes holding its key) that also
 * carries `[BLOCK]`, so a list, a key and the children diff take it as any element. The element diff
 * builds it by cloning the template and writing every hole, and updates it by comparing each hole with
 * the value written last — no vnode per element, no walk through the static ones.
 *
 * Holes in this prototype: an attribute on any element of the template, and a text node. A hole holding
 * markup (an element, a list, a component) is the compiler's next step, not this one.
 */
import { TEXT_TYPE, ORIGIN_SYM, KEY_SYM } from "../helpers/constants";
import { currentOrigin } from "./origin";
import { applyChangesOnAttributes } from "./Attribute";
import type { VNodeString } from "../types/vdom";

export const BLOCK = Symbol("block");
/** On a block's root element: the template it was cloned from, its hole nodes, and what was written. */
export const BLOCK_STATE = Symbol("blockState");

export interface Template {
  readonly html: string;
  /** Each node a hole is on, as child indexes from the root; `[]` is the root itself. */
  readonly paths: readonly (readonly number[])[];
  /** Each hole: the node it is on (an index into `paths`) and, for an attribute, its name. */
  readonly holes: readonly { readonly at: number; readonly name?: string }[];
  readonly rootName: string;
  /** The parsed root, cloned for each block. Made on first use, where a `document` exists. */
  root?: Element;
  /** Per node with attribute holes, which holes they are — written together, as one element's attributes. */
  readonly elements: readonly { readonly at: number; readonly holes: readonly number[] }[];
}

interface BlockData {
  readonly template: Template;
  readonly values: readonly unknown[];
}

export interface BlockState {
  readonly template: Template;
  readonly nodes: Node[];
  values: readonly unknown[];
}

export type BlockVNode = VNodeString & { [BLOCK]: BlockData };

/** Defines a template: its markup, without whitespace between tags, the nodes holes are on, the holes. */
export function template(
  html: string,
  paths: readonly (readonly number[])[],
  holes: readonly { readonly at: number; readonly name?: string }[],
): Template {
  const rootName = (/^<([a-zA-Z0-9-]+)/.exec(html)?.[1] ?? "div").toUpperCase();
  const byNode = new Map<number, number[]>();
  holes.forEach((hole, index) => {
    if (hole.name === undefined) return;
    const list = byNode.get(hole.at);
    if (list === undefined) byNode.set(hole.at, [index]);
    else list.push(index);
  });
  const elements = [...byNode].map(([at, list]) => ({ at, holes: list }));
  return { html, paths, holes, rootName, elements };
}

/** A block of `template` with these hole values, keyed as a list row is. */
export function block(template: Template, values: readonly unknown[], key?: string | number): BlockVNode {
  return {
    type: TEXT_TYPE,
    name: template.rootName,
    attributes: key === undefined ? {} : { key },
    children: [],
    [ORIGIN_SYM]: currentOrigin.id,
    [BLOCK]: { template, values },
  } as unknown as BlockVNode;
}

function rootOf(template: Template): Element {
  if (template.root === undefined) {
    const holder = document.createElement("template");
    holder.innerHTML = template.html;
    template.root = holder.content.firstChild as Element;
  }
  return template.root;
}

function resolve(root: Node, path: readonly number[]): Node {
  let node: Node = root;
  for (const index of path) {
    let child = node.firstChild as Node;
    for (let i = 0; i < index; i++) child = child.nextSibling as Node;
    node = child;
  }
  return node;
}

/** The attributes one element's holes say now, as the attribute diff takes them. */
function attributesAt(template: Template, element: { holes: readonly number[] }, values: readonly unknown[]) {
  const attributes: Record<string, unknown> = {};
  for (const index of element.holes) attributes[template.holes[index].name as string] = values[index];
  return attributes;
}

/** Whether a hole's new value has to be written: a different value, or an object that may have changed. */
function holeChanged(name: string | undefined, next: unknown, previous: unknown): boolean {
  if (next !== previous) return true;
  return name !== undefined && typeof next === "object" && next !== null && !name.startsWith("on");
}

/** Builds or updates the element for a block vnode. `existing` is a node `areSimilarNodes` matched. */
export function applyBlock(vnode: BlockVNode, existing: Element | undefined, onServer: boolean): Element {
  const { template, values } = vnode[BLOCK];
  const state = (existing as { [BLOCK_STATE]?: BlockState } | undefined)?.[BLOCK_STATE];

  if (existing === undefined || state === undefined || state.template !== template) {
    const root = rootOf(template).cloneNode(true) as Element;
    (root as unknown as Record<symbol, unknown>)[ORIGIN_SYM] = vnode[ORIGIN_SYM];
    const key = vnode.attributes.key;
    if (key != null) (root as unknown as Record<symbol, unknown>)[KEY_SYM] = key;
    const nodes = template.paths.map((path) => resolve(root, path));
    (root as unknown as { [BLOCK_STATE]: BlockState })[BLOCK_STATE] = { template, nodes, values };
    for (let i = 0; i < template.holes.length; i++) {
      if (template.holes[i].name === undefined) nodes[template.holes[i].at].nodeValue = String(values[i]);
    }
    for (const element of template.elements) {
      applyChangesOnAttributes(nodes[element.at] as ChildNode, attributesAt(template, element, values), onServer, true);
    }
    return root;
  }

  const previous = state.values;
  for (const element of template.elements) {
    let changed = false;
    for (const index of element.holes) {
      if (holeChanged(template.holes[index].name, values[index], previous[index])) {
        changed = true;
        break;
      }
    }
    if (changed) {
      applyChangesOnAttributes(state.nodes[element.at] as ChildNode, attributesAt(template, element, values), onServer);
    }
  }
  for (let i = 0; i < template.holes.length; i++) {
    if (template.holes[i].name === undefined && values[i] !== previous[i]) {
      state.nodes[template.holes[i].at].nodeValue = String(values[i]);
    }
  }
  state.values = values;
  return existing;
}
