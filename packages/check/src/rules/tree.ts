import ts from "typescript";
import { contextFor } from "./element";
import type { ElementContext, JsxElementLike, TreeContext, TreeNode } from "./rule";

/**
 * One render's markup, gathered once for every rule in the tree family.
 *
 * ## What a "render" is here
 *
 * One top-level JSX tree in the source: an element or fragment with no JSX above it. That is what
 * a `render()` returns, and what a helper function builds. It is deliberately NOT the composed
 * tree — following `<Panel />` into whatever it renders depends on props, on state and on what a
 * slot was filled with, and this package does not guess.
 *
 * ## The one hard question, answered once
 *
 * Whether an element is really on the page. `{open ? <a id="x"/> : <b id="x"/>}` is two elements in
 * the source and one in the document, and a rule comparing them would report markup that is
 * correct. So every node carries `alwaysPresent`, and it is false the moment anything conditional
 * or repeated stands between it and the root.
 *
 * The test is deliberately coarse — *any* conditional ancestor, rather than working out which
 * branches exclude which. Two elements in the same branch of the same ternary do coexist, and this
 * says nothing about them; that is a report given up, not a wrong one, and it is the direction this
 * package errs in on purpose.
 */

/** Everything that makes what is below it conditional, or repeated, or both. */
function isConditional(node: ts.Node): boolean {
  return (
    ts.isConditionalExpression(node) ||
    ts.isIfStatement(node) ||
    ts.isSwitchStatement(node) ||
    // `open && <Panel />` and `label || <Fallback />` — the right-hand side runs only sometimes.
    // `??` is here for the same reason and reads the same way at a call site.
    ts.isBinaryExpression(node) ||
    // A callback body: `items.map((item) => <li/>)`. Repeated, or never run at all, and either
    // way it is not one element the way an element written in place is.
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

/**
 * Every top-level JSX tree in a file: the renders, one per subject a tree rule reads.
 *
 * The walk stops at the first markup it meets on any path, so "top-level" needs no ancestor test —
 * nothing below a root is ever visited here. An earlier version asked each candidate whether it had
 * JSX above it as well; probed across every fixture and across three real projects, that question
 * was answered `false` every single time, so it was a guard that could not fire and a reader would
 * have had to work out why.
 *
 * What is below a root is `treeFor`'s to collect, INCLUDING markup inside braces and inside
 * attributes, whose parent is not JSX at all.
 */
export function rootsIn(file: ts.SourceFile): (ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement)[] {
  const roots: (ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement)[] = [];
  (function look(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {
      roots.push(node);
      return;
    }
    ts.forEachChild(node, look);
  })(file);
  return roots;
}

/**
 * The context every tree rule reads, built once per render.
 *
 * Document order is source order, which is what `forEachChild` already gives: a rule about heading
 * levels is a rule about the order a reader meets them in, and that is the order they are written.
 */
export function treeFor(root: ts.Node, resolve: ElementContext["resolve"]): TreeContext {
  const elements: TreeNode[] = [];

  (function look(node: ts.Node, conditional: boolean): void {
    const here = conditional || (node !== root && isConditional(node));

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = node as JsxElementLike;
      elements.push({ ...contextFor(element, resolve), element, alwaysPresent: !here });
    }

    ts.forEachChild(node, (child) => look(child, here));
  })(root, false);

  return { elements };
}
