import ts from "typescript";
import { isTheGlobal } from "./globals";
import { positionOf } from "../syntax";
import type { Resolver, Rule } from "./rule";

/**
 * A component writing to the DOM what its own `render()` could say.
 *
 * `document.documentElement.classList.toggle("nav-locked", this.menuOpen)` is RENDERING, done
 * imperatively. The class it writes is a second copy of a field the component already holds: it has
 * to be kept in step by hand, cleaned up when the component goes away, and remembered by whoever
 * adds the next handler that touches the same state. The declarative form exists — write the class
 * in `render()` and let the stylesheet read it — and it cannot drift, because there is only one of
 * it.
 *
 * **A COMMAND is not this, and the difference is the whole rule.** `scrollIntoView()`, `focus()`,
 * `select()` and `getBoundingClientRect()` have no declarative form: they are things you tell the
 * browser to do, not state the framework owns. They stay allowed, and a rule that caught them would
 * be a rule people switch off.
 *
 * ## How far it looks, which is the whole class and no further
 *
 * Every member, so a write in a helper the component calls is found — measured, with the write one
 * `this.method()` away. A utility in ANOTHER FILE is not followed, and that is a decision rather
 * than a gap: this report names a component and a line, with nothing to say how the two are
 * connected, so following an import would name a component that did not write the line, in a file
 * it does not own, once per caller. A module that owns a DOM effect on purpose — a focus trap, a
 * scroll lock — is also a legitimate thing to write, and this rule has no way to tell it from the
 * other kind.
 */
export interface DomWriteIssue {
  /** The class doing the writing. */
  component: string;
  /** What was written — `document.body.classList.add`, `document.documentElement.style.overflow`. */
  wrote: string;
  file: string;
  line: number;
  column: number;
}

/**
 * Members whose assignment IS rendering — what an element looks like, said imperatively.
 *
 * `id` is here because it is what a fragment link resolves against, and a component that writes one
 * has put half of its markup outside `render()`.
 */
const RENDERED_BY_ASSIGNMENT = new Set(["className", "textContent", "innerHTML", "innerText", "id"]);

/** Methods that write what an element looks like. `classList` and `style` get their own below. */
const RENDERING_METHODS = new Set(["setAttribute", "removeAttribute", "toggleAttribute", "insertAdjacentHTML"]);

/** `classList.add("x")` — the same write as `className`, through the API made for it. */
const CLASS_LIST_METHODS = new Set(["add", "remove", "toggle", "replace"]);

/** Writing a style through a call rather than a property — how a CSS custom property is set. */
const STYLE_METHODS = new Set(["setProperty", "removeProperty"]);

/**
 * Whether an expression names an element the component did NOT render.
 *
 * The three roots of the document, and whatever a global query returns. Anything reached through
 * a local variable is deliberately outside this: reading what that variable holds is dataflow,
 * which this resolver refuses by decision — and an element the component CREATED is a local, so
 * building one and filling it in is left alone, which is right.
 */
function notOursToWrite(node: ts.Node, resolve: Resolver): boolean {
  let at: ts.Node = node;
  // `document.body.style.overflow` → walk down to `document.body`. Element access is walked too,
  // because `style["overflow"]` and `style.overflow` are one write through two spellings.
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
    const owner = at.expression;
    /**
     * The NAME `document`, without asking whether it resolves — `globals.ts` decides, and this rule
     * is where that argument was made first: a prefix is not a form a local plausibly shadows,
     * nobody writes `const document = …` and then reaches for `.body.classList`, and requiring it to
     * be unresolvable makes the rule depend on the run having no lib. `self` is the exception and
     * has to prove itself, which is measured over there.
     */
    const isDocument = ts.isIdentifier(owner) && owner.text === "document";
    const viaWindow =
      ts.isPropertyAccessExpression(owner) && owner.name.text === "document" && isTheGlobal(owner.expression, resolve);
    if (isDocument || viaWindow) return true;
    at = owner;
  }
  // `document.getElementById("x").classList` — the chain bottoms out in the query itself.
  if (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    const called = at.expression.name.text;
    if (["getElementById", "querySelector", "querySelectorAll"].includes(called)) {
      return notOursToWrite(at.expression, resolve);
    }
  }
  if (ts.isNonNullExpression(at) || ts.isParenthesizedExpression(at)) return notOursToWrite(at.expression, resolve);
  return false;
}

/**
 * A component writing the document instead of rendering it.
 *
 * Reported as a WARNING, which is the rule here for a new rule: one version that says so, the
 * next that refuses. Measured across this repository when it was written: zero reports. What
 * looked like violations were a custom element (`@ramonda/devtools` is an `HTMLElement`, not a
 * component), a READ of `textContent`, and a `<style>` element built at module scope — none of
 * them a component writing what it could have rendered.
 */
export const domWrites = {
  id: "dom-writes",

  report: {
    severity: "warn",
    reportedWhen:
      "a component writes the document — `document.body.classList.add(…)` and its family — " +
      "where `render()` could have said it",
    heading: (found) => {
      const guilty = new Set(found.map((write) => write.component)).size;
      return (
        `${guilty} component(s) writing the document instead of rendering it` +
        `${found.length === guilty ? "" : ` — ${found.length} writes`}:`
      );
    },
    lines: (write) => [
      `  ${write.file}:${write.line}:${write.column}`,
      `    <${write.component}> writes \`${write.wrote}\`.`,
    ],
    advice:
      "A class, an attribute or a piece of text written this way is a SECOND copy of state the\n" +
      "component already holds: it has to be kept in step by hand, cleaned up when the component\n" +
      "goes away, and remembered by whoever adds the next handler that touches it. Say it in\n" +
      "`render()` and let the stylesheet read it — `html:has(.drawer-open)` reaches the document\n" +
      "from a class a descendant renders, so even the page itself can be styled from state.\n\n" +
      "A COMMAND is not this and is not reported: `scrollIntoView()`, `focus()`, `select()` and\n" +
      "`getBoundingClientRect()` have no declarative form. Nor is an element you created yourself,\n" +
      "or one held in a `ref` — that one is your own.\n\n" +
      "This is a warning today and an error in a later version.",
  },

  read(cls, { self, resolve }) {
    const found: DomWriteIssue[] = [];
    const report = (target: ts.Node, wrote: string): void => {
      found.push({ component: self.name, wrote, ...positionOf(target) });
    };

    ts.forEachChild(cls, function look(node) {
      /**
       * `document.body.className = "x"`, and `+=` with it.
       *
       * ANY assignment operator, not just `=`. `className += " open"` is the most idiomatic
       * imperative class write there is, and matching only `EqualsToken` left the rule silent on
       * the very case it exists for — measured, it reported nothing while the plain assignment on
       * the next line was reported.
       */
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        // `style.overflow = …` and `style["overflow"] = …` are the same write through two
        // spellings, and a computed key is how a CSS custom property is usually reached.
        const left = node.left;
        const written = ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left);
        if (written) {
          const owner = left.expression;
          const styled = ts.isPropertyAccessExpression(owner) && owner.name.text === "style";
          const named = ts.isPropertyAccessExpression(left) ? left.name.text : "";
          if ((styled || RENDERED_BY_ASSIGNMENT.has(named)) && notOursToWrite(left, resolve)) {
            report(left, left.getText());
          }
        }
      }

      // `document.body.classList.add("x")`, `document.documentElement.setAttribute(…)`,
      // `document.body.style.setProperty("--accent", …)`.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const called = node.expression;
        const owner = called.expression;
        const onClassList =
          ts.isPropertyAccessExpression(owner) &&
          owner.name.text === "classList" &&
          CLASS_LIST_METHODS.has(called.name.text);
        const onStyle =
          ts.isPropertyAccessExpression(owner) && owner.name.text === "style" && STYLE_METHODS.has(called.name.text);
        if ((onClassList || onStyle || RENDERING_METHODS.has(called.name.text)) && notOursToWrite(called, resolve)) {
          report(called, called.getText());
        }
      }
      ts.forEachChild(node, look);
    });

    return found;
  },
} as const satisfies Rule<DomWriteIssue>;
