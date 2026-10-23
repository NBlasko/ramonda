import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf } from "./element";
import { unwrap } from "./follow-value";
import { attributeLiterals, kindOfLiterals, literalsOf, typeAttributeOf } from "./formTable";
import { coreDecorators } from "./lifecycle-env";
import type { Rule, RuleContext } from "./rule";

/**
 * A field given an edit by the component's own code while a commit runs.
 *
 * A field learns its model through render, and the work a commit runs — `render()`, the constructor,
 * `@created`, `@mounted`, `@updated`, `@destroyed`, `@watchProp`, `@catchError` — runs before the
 * render an edit's handler causes: that one comes once the commit is over. An edit sent from there
 * is answered, but a second one that reads the model — a `transform`'s `prev`, the word an input
 * method ends after `oncompositionend` moved the model — reads the model as it was. And an edit sent
 * there is a value set by an event: what the field should show is state, `this.on = true`.
 *
 * What is an edit: dispatching `input`, `change`, `beforeinput` or a composition event at a field
 * this class renders — held by a ref, or handed to a `ref` callback — or at an element a query
 * finds, which may be one; a `click` on a checkbox, a radio or a `<label>` of one that this class
 * renders, by method or as a dispatched event; writing `.value` or `.checked` on a field it renders
 * with that model; `document.execCommand`, which edits the focused field. An event whose type cannot
 * be read is reported as one: nothing says it is not an edit. An event dispatched at the document, at
 * the window or at any other object — a store that extends `EventTarget` — reaches no field, which
 * hears only what is dispatched at it; and an element the class is handed rather than renders is
 * not read here: `RMD062` reports what reaches it.
 *
 * How far it looks: every method of the class the commit's work calls as `this.method()`, and every
 * function written there that runs now — a callback to `forEach`, `map` or any call this cannot name
 * as later. One handed to `queueMicrotask`, `setTimeout`, `requestAnimationFrame`, a promise's `then`
 * or `addEventListener` runs after the commit, and so does what an `async` method does past an
 * `await` written as a statement of its own. A function written as an attribute is not the commit's
 * work either — `onclick={() => …}` is an event handler, which the element calls, and a row whose
 * handler clicks its checkbox does what a `<label>` does; a prop's function is the receiving
 * component's to call — except `ref={(node) => …}`, which runs in the commit.
 */
export interface FieldSetByAnEventIssue {
  /** The class whose commit work sends the edit. */
  component: string;
  /** `dispatch` an edit event; `unreadable` an event whose type cannot be read; `click`; `write`; `exec-command`. */
  kind: "dispatch" | "unreadable" | "click" | "write" | "exec-command";
  /** What is sent or written, as the report names it: `input`, `this.box`, `this.field.value`. */
  detail: string;
  /** The commit work it is reached from: `@mounted start`, `render`. */
  from: string;
  file: string;
  line: number;
  column: number;
}

/** Event types a field answers as an edit. */
const EDIT_EVENTS = new Set([
  "input",
  "change",
  "beforeinput",
  "compositionstart",
  "compositionupdate",
  "compositionend",
]);

/** The decorators whose method a commit runs. */
const COMMIT_DECORATORS = new Set(["created", "mounted", "updated", "destroyed", "watchProp", "catchError"]);

/** Calls that run the function handed to them after the current work: what they are given is not the commit's. */
const LATER = new Set([
  "queueMicrotask",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
  "then",
  "catch",
  "finally",
  "addEventListener",
]);

/** What a ref this class renders is attached to, as far as an edit is concerned. */
type Held = "box" | "label" | "field" | "other";

export const fieldSetByAnEvent = {
  id: "field-set-by-an-event",

  report: {
    severity: "error",
    alsoReportedAs: "RMD062",
    reportedWhen:
      "a component's commit work — `@mounted`, `@updated`, `render()` and the rest — sends a field an edit: " +
      "dispatches `input` or `change`, clicks a checkbox, or writes its `value`, where state says what it shows",
    heading: (found) => `${found.length} edit(s) sent to a field while a commit runs:`,
    lines: (issue) => [
      `  ${issue.file}:${issue.line}:${issue.column}`,
      `    <${issue.component}> ${
        {
          dispatch: `dispatches \`${issue.detail}\` from ${issue.from}.`,
          unreadable: `dispatches an event from ${issue.from} whose type cannot be read: \`${issue.detail}\`.`,
          click: `clicks \`${issue.detail}\` from ${issue.from}.`,
          write: `writes \`${issue.detail}\` from ${issue.from}.`,
          "exec-command": `edits the focused field with \`document.execCommand\` from ${issue.from}.`,
        }[issue.kind]
      }`,
    ],
    advice:
      "What a field shows is state. Write it, and the commit's render shows it:\n\n" +
      "```tsx\n" +
      "@state on = true;              // known at the start\n\n" +
      "@mounted\n" +
      "start() {\n" +
      "  this.text = this.saved;      // learned on mount\n" +
      "}\n" +
      "```\n\n" +
      "An edit that must go through the field — its `transform`, the form around it — is sent once the\n" +
      "commit is over: `queueMicrotask(() => this.box.current?.click())`. A library given the field is\n" +
      "told its value through its own callback, which writes state.\n\n",
  },

  read(cls, context) {
    const { self, resolve } = context;
    const found: FieldSetByAnEventIssue[] = [];

    // The class's own functions, by name: methods and arrow fields.
    const members = new Map<string, ts.Node>();
    for (const member of cls.members) {
      const name = member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
      if (name === undefined) continue;
      if (ts.isMethodDeclaration(member) && member.body !== undefined) members.set(name, member);
      else if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
        const held = unwrap(member.initializer);
        if (ts.isArrowFunction(held) || ts.isFunctionExpression(held)) members.set(name, held);
      }
    }

    const boxes = boxesOf(cls, context);
    const refs = refsOf(cls, boxes, context);

    // The ref a receiver names: `this.box.current`, with `?.`, `!` or a `const` one name away.
    const heldBy = (receiver: ts.Expression, hops = 0): { name: string; held: Held } | undefined => {
      const at = unwrap(receiver);
      if (ts.isIdentifier(at) && hops < 4) {
        const element = refCallbackElement(at, context);
        if (element !== undefined) return { name: at.text, held: heldAs(element, boxes, context) };
        const declared = resolve(at)?.declarations?.[0];
        if (
          declared !== undefined &&
          ts.isVariableDeclaration(declared) &&
          declared.initializer !== undefined &&
          (ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) !== 0
        ) {
          return heldBy(declared.initializer, hops + 1);
        }
        return undefined;
      }
      if (!ts.isPropertyAccessExpression(at) || at.name.text !== "current") return undefined;
      const owner = unwrap(at.expression);
      if (!ts.isPropertyAccessExpression(owner) || owner.expression.kind !== ts.SyntaxKind.ThisKeyword)
        return undefined;
      const held = refs.get(owner.name.text);
      return held === undefined ? undefined : { name: `this.${owner.name.text}`, held };
    };

    /**
     * Whether an event dispatched at `receiver` can reach a field: a field this class renders, held by
     * a ref, or an element found by a query — which may be one. `document`, `window` and any other
     * object — a store that extends `EventTarget` — cannot: a field hears what is dispatched at it.
     */
    const reachesAField = (receiver: ts.Expression, hops = 0): boolean => {
      const held = heldBy(receiver);
      if (held !== undefined) return held.held !== "other";
      const at = unwrap(receiver);
      if (ts.isIdentifier(at) && hops < 4) {
        const declared = resolve(at)?.declarations?.[0];
        return (
          declared !== undefined &&
          ts.isVariableDeclaration(declared) &&
          declared.initializer !== undefined &&
          (ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) !== 0 &&
          reachesAField(declared.initializer, hops + 1)
        );
      }
      return isAnElementQuery(at);
    };

    const visited = new Set<ts.Node>();
    const walk = (node: ts.Node, from: string): void => {
      const report = (at: ts.Node, kind: FieldSetByAnEventIssue["kind"], detail: string) =>
        found.push({ component: self.name, kind, detail, from, ...positionOf(at) });

      const look = (at: ts.Node): void => {
        // A function written here runs now unless it is handed to something that runs it later — or
        // written as an attribute: `onclick={() => …}` is an event handler, which the element calls,
        // and a prop's function is the receiving component's to call. A `ref` callback runs in the commit.
        if (ts.isArrowFunction(at) || ts.isFunctionExpression(at) || ts.isFunctionDeclaration(at)) {
          if (handedToLater(at) || writtenAsAnAttribute(at)) return;
          body(at);
          return;
        }
        // `items.forEach(this.tick)` — the class's own function handed over to run now, followed;
        // `queueMicrotask(this.tick)` runs it later.
        if (
          ts.isPropertyAccessExpression(at) &&
          at.expression.kind === ts.SyntaxKind.ThisKeyword &&
          members.has(at.name.text) &&
          ts.isCallExpression(at.parent) &&
          at.parent.arguments.some((argument) => unwrap(argument) === at) &&
          !handedToLater(at)
        ) {
          enter(members.get(at.name.text) as ts.Node);
        }
        if (ts.isCallExpression(at)) {
          const callee = unwrap(at.expression);
          if (ts.isPropertyAccessExpression(callee)) {
            const method = callee.name.text;
            // `this.helper()` — the class's own function, followed.
            if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
              const member = members.get(method);
              if (member !== undefined) enter(member);
            }
            if (method === "dispatchEvent" && reachesAField(callee.expression)) {
              const event = at.arguments[0] === undefined ? undefined : unwrap(at.arguments[0]);
              const types =
                event !== undefined && ts.isNewExpression(event) && event.arguments?.[0] !== undefined
                  ? literalsOf(event.arguments[0], resolve)
                  : undefined;
              if (types === undefined) report(at, "unreadable", event?.getText() ?? "");
              else {
                const held = heldBy(callee.expression);
                for (const type of types) {
                  if (EDIT_EVENTS.has(type)) report(at, "dispatch", type);
                  else if (type === "click" && held !== undefined && (held.held === "box" || held.held === "label")) {
                    report(at, "click", held.name);
                  }
                }
              }
            }
            if (method === "click" && at.arguments.length === 0) {
              const held = heldBy(callee.expression);
              if (held !== undefined && (held.held === "box" || held.held === "label")) report(at, "click", held.name);
            }
            if (method === "execCommand" && isDocument(callee.expression)) report(at, "exec-command", "execCommand");
          }
        }
        if (
          ts.isBinaryExpression(at) &&
          at.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          at.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          ts.isPropertyAccessExpression(at.left) &&
          (at.left.name.text === "value" || at.left.name.text === "checked")
        ) {
          const held = heldBy(at.left.expression);
          if (held !== undefined && (held.held === "field" || held.held === "box")) {
            report(at.left, "write", `${held.name}.${at.left.name.text}`);
          }
        }
        ts.forEachChild(at, look);
      };

      // A function's statements, up to an `await` written as a statement of its own in an `async` one:
      // what comes after it runs once the commit is over.
      const body = (fn: ts.FunctionLikeDeclaration): void => {
        const statements = fn.body === undefined ? [] : ts.isBlock(fn.body) ? fn.body.statements : [fn.body];
        const async = (ts.getCombinedModifierFlags(fn as ts.Declaration) & ts.ModifierFlags.Async) !== 0;
        for (const statement of statements) {
          look(statement);
          if (async && ts.isStatement(statement) && awaitsAsAStatement(statement)) return;
        }
      };

      const enter = (member: ts.Node): void => {
        if (visited.has(member)) return;
        visited.add(member);
        if (
          ts.isMethodDeclaration(member) ||
          ts.isConstructorDeclaration(member) ||
          ts.isArrowFunction(member) ||
          ts.isFunctionExpression(member)
        ) {
          body(member);
        }
      };

      enter(node);
    };

    for (const member of cls.members) {
      if (ts.isConstructorDeclaration(member) && member.body !== undefined) {
        walk(member, "the constructor");
        continue;
      }
      const name = member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
      if (name === undefined) continue;
      if (name === "render" && ts.isMethodDeclaration(member)) {
        walk(member, "render");
        continue;
      }
      for (const { name: decorator } of coreDecorators(member, context)) {
        if (!COMMIT_DECORATORS.has(decorator)) continue;
        const fn = members.get(name);
        if (fn !== undefined) walk(fn, `@${decorator} ${name}`);
      }
    }
    // `this.method()` reached from two roots is read once, and reported under the first.
    return found;
  },
} as const satisfies Rule<FieldSetByAnEventIssue>;

/** Whether a function is handed, as an argument, to a call that runs it after the current work. */
function handedToLater(fn: ts.Node): boolean {
  const call = fn.parent;
  if (!ts.isCallExpression(call) || !call.arguments.some((argument) => unwrap(argument) === fn)) return false;
  const callee = unwrap(call.expression);
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name !== undefined && LATER.has(name);
}

/** A function written as an attribute's value — an event handler, a prop — other than a `ref` callback. */
function writtenAsAnAttribute(fn: ts.Node): boolean {
  const expression = fn.parent;
  if (!ts.isJsxExpression(expression) || !ts.isJsxAttribute(expression.parent)) return false;
  return expression.parent.name.getText() !== "ref";
}

/** `querySelector(…)`, `getElementById(…)` and their family: an element that may be a field. */
const ELEMENT_QUERIES = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByName",
  "closest",
]);

function isAnElementQuery(expression: ts.Expression): boolean {
  let at = unwrap(expression);
  // `querySelectorAll("input")[0]`, `.item(0)`.
  if (ts.isElementAccessExpression(at)) at = unwrap(at.expression);
  if (!ts.isCallExpression(at)) return false;
  const callee = unwrap(at.expression);
  return ts.isPropertyAccessExpression(callee) && ELEMENT_QUERIES.has(callee.name.text);
}

/** `await x;` or `const y = await x;` — an await the function stops at, whatever branch it takes. */
function awaitsAsAStatement(statement: ts.Statement): boolean {
  if (ts.isExpressionStatement(statement)) return ts.isAwaitExpression(unwrap(statement.expression));
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(
      (declaration) => declaration.initializer !== undefined && ts.isAwaitExpression(unwrap(declaration.initializer)),
    );
  }
  return false;
}

/** `document`, or `window.document`. */
function isDocument(expression: ts.Expression): boolean {
  const at = unwrap(expression);
  if (ts.isIdentifier(at)) return at.text === "document";
  return ts.isPropertyAccessExpression(at) && at.name.text === "document";
}

/** Whether an `<input>` written here is a checkbox or a radio, by its `type` — or `checked`, when that cannot be read. */
function isABox(node: ts.JsxElement | ts.JsxSelfClosingElement, context: RuleContext): boolean {
  const opening = openingOf(node);
  if (opening.tagName.getText() !== "input") return false;
  const type = typeAttributeOf(node);
  const field = type === undefined ? "text" : kindOfLiterals(attributeLiterals(type, context.resolve));
  const checked = opening.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "checked");
  return field === "box" || (field === "unread" && checked);
}

/**
 * Whether clicking a `<label>` edits a field: it labels a checkbox or a radio — inside it, or named by
 * `for` — or what it labels cannot be read: a component inside it, a `for` that is not a literal, or
 * names no field this class renders. A label of a text field only moves the focus.
 */
function labelsABox(
  label: ts.JsxElement | ts.JsxSelfClosingElement,
  boxes: Map<string, boolean>,
  context: RuleContext,
): boolean {
  const opening = openingOf(label);
  const forAttribute = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && ["for", "htmlFor"].includes(p.name.getText()),
  );
  if (forAttribute !== undefined) {
    const ids = attributeLiterals(forAttribute, context.resolve);
    return ids === undefined || ids.some((id) => boxes.get(id) !== false);
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && node !== label) {
      const tag = openingOf(node).tagName.getText();
      // A component's markup is not read here: whatever it renders may be a box.
      if (/^[A-Z]/.test(tag) || tag.includes(".")) found = true;
      else if (isABox(node, context)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(label);
  return found;
}

/** What an element is, as far as an edit is concerned — see `Held`. */
function heldAs(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  boxes: Map<string, boolean>,
  context: RuleContext,
): Held {
  const opening = openingOf(node);
  const named = (name: string) =>
    opening.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === name);
  const tag = coreElementTag(opening.tagName, context.resolve) ?? opening.tagName.getText();
  if (tag === "label") return labelsABox(node, boxes, context) ? "label" : "other";
  if (tag === "input") return isABox(node, context) ? "box" : named("value") ? "field" : "other";
  if ((tag === "select" || tag === "textarea") && named("value")) return "field";
  return "other";
}

/** The inputs with a literal `id` this class renders, and whether each is a box — what a `for` names. */
function boxesOf(cls: ts.ClassLikeDeclaration, context: RuleContext): Map<string, boolean> {
  const boxes = new Map<string, boolean>();
  const ids = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && openingOf(node).tagName.getText() === "input") {
      const id = openingOf(node).attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "id",
      );
      for (const literal of attributeLiterals(id, context.resolve) ?? []) boxes.set(literal, isABox(node, context));
    }
    ts.forEachChild(node, ids);
  };
  ids(cls);
  return boxes;
}

/**
 * The element a `ref` callback's parameter is: `ref={(node) => …}` is handed the element it is written on.
 */
function refCallbackElement(
  name: ts.Identifier,
  context: RuleContext,
): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  const declared = context.resolve(name)?.declarations?.[0];
  if (declared === undefined || !ts.isParameter(declared)) return undefined;
  const fn = declared.parent;
  const expression = fn.parent;
  if (!ts.isJsxExpression(expression) || !ts.isJsxAttribute(expression.parent)) return undefined;
  if (expression.parent.name.getText() !== "ref") return undefined;
  const opening = expression.parent.parent.parent;
  if (ts.isJsxSelfClosingElement(opening)) return opening;
  return ts.isJsxOpeningElement(opening) ? opening.parent : undefined;
}

/**
 * Every ref this class renders, by field name, and what it is attached to: a checkbox or a radio, a
 * `<label>` of one, a field written with its model (`value`, `checked`), or anything else.
 */
function refsOf(cls: ts.ClassLikeDeclaration, boxes: Map<string, boolean>, context: RuleContext): Map<string, Held> {
  const refs = new Map<string, Held>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = openingOf(node);
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
      const named = (name: string) => attributes.find((attribute) => attribute.name.getText() === name);
      const ref = named("ref")?.initializer;
      const held = ref !== undefined && ts.isJsxExpression(ref) && ref.expression ? unwrap(ref.expression) : undefined;
      if (
        held !== undefined &&
        ts.isPropertyAccessExpression(held) &&
        held.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        refs.set(held.name.text, heldAs(node, boxes, context));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(cls);
  return refs;
}
