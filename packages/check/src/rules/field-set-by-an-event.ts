import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, says } from "./element";
import { unwrap } from "./follow-value";
import { attributeLiterals, fieldKind, literalsOf, typeAttributeOf } from "./formTable";
import { coreDecorators } from "./lifecycle-env";
import type { Resolver, Rule, RuleContext } from "./rule";

/**
 * A field given an edit by the component's own code while a commit runs.
 *
 * A field learns its model through render, and the work a commit runs — `render()`, the constructor,
 * `@created`, `@mounted`, `@updated`, `@destroyed`, `@watchProp`, `@catchError` — runs before the
 * render an edit's handler causes: that one comes once the commit is over. An edit sent from there
 * is answered, but a second one reads the model before that render — whether the handler took the
 * first edit or refused it is not known yet. And an edit sent
 * there is a value set by an event: what the field should show is state, `this.on = true`.
 *
 * What is an edit: dispatching `input`, `change`, `beforeinput` or a composition event at a field
 * this class renders — held by a ref, or handed to a `ref` callback — or at an element a query
 * finds, or a form's `elements` hands, which may be one; a `click` on a checkbox, a radio or a `<label>` of one that this class
 * renders, by method or as a dispatched event; writing `.value` or `.checked` on a field it renders
 * with that model; `document.execCommand`, which edits the focused field. An event whose type cannot
 * be read is reported as one: nothing says it is not an edit. An event dispatched at the document, at
 * the window or at any other object — a store that extends `EventTarget` — reaches no field, which
 * hears only what is dispatched at it; and an element the class is handed rather than renders is
 * not read here: `RMD062` reports what reaches it.
 *
 * How far it looks: every method of the class the commit's work calls — `this.method()`, through
 * `.call`, `.apply` or `.bind(…)()` — every accessor it reads or writes, and every function written
 * there that runs now — a callback to `forEach`, `map` or any call this cannot name
 * as later. One handed to `queueMicrotask`, `setTimeout`, `requestAnimationFrame`, a promise's `then`
 * or `addEventListener` runs after the commit. An `async` method is read whole: whether a statement runs
 * before an `await` or after it depends on values the check cannot read — `this.cache ??= await load()`
 * may not wait at all — so an edit anywhere in it is reported, and one meant for later says so by
 * handing it to `queueMicrotask`. A function written as an attribute is not the commit's
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

/**
 * What a ref this class renders is attached to, as far as an edit is concerned: whether a click on it
 * edits a field — a checkbox or a radio, held by a model or not, or a `<label>` of one; whether it is a
 * field at all, which an event dispatched at it edits; and which property is its model — `checked` on a
 * box, `value` on any other field — which writing over is reported, and no other. A ref on more than
 * one element — one per branch of a `?:` — holds what any of them does.
 */
interface Held {
  clicked: boolean;
  field: boolean;
  models: ReadonlySet<"value" | "checked">;
}

const NOTHING = new Set<"value" | "checked">();
const NEITHER: Held = { clicked: false, field: false, models: NOTHING };

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
      "An edit that must go through the field — its handler, the form around it — is sent once the\n" +
      "commit is over: `queueMicrotask(() => this.box.current?.click())`. An `await` before it does not\n" +
      "say so — whether it waits depends on values — so the edit is handed to `queueMicrotask` there too.\n" +
      "A library given the field is told its value through its own callback, which writes state.\n\n",
  },

  read(cls, context) {
    const { self, resolve } = context;
    const found: FieldSetByAnEventIssue[] = [];

    // The class's own functions, by name: methods and arrow fields — and its accessors, which run where
    // they are read (`{this.view}`) or written (`this.on = true`).
    const members = new Map<string, ts.Node>();
    const getters = new Map<string, ts.GetAccessorDeclaration>();
    const setters = new Map<string, ts.SetAccessorDeclaration>();
    for (const member of cls.members) {
      const name = memberName(member);
      if (name === undefined) continue;
      if (ts.isGetAccessorDeclaration(member) && member.body !== undefined) getters.set(name, member);
      else if (ts.isSetAccessorDeclaration(member) && member.body !== undefined) setters.set(name, member);
      else if (ts.isMethodDeclaration(member) && member.body !== undefined) members.set(name, member);
      else if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
        const held = unwrap(member.initializer);
        if (ts.isArrowFunction(held) || ts.isFunctionExpression(held)) members.set(name, held);
      }
    }

    const boxes = boxesOf(cls, context);
    // Each ref callback's elements, found once: finding them walks the class.
    const refElements = new Map<ts.ParameterDeclaration, (ts.JsxElement | ts.JsxSelfClosingElement)[]>();
    const refs = refsOf(cls, boxes, context);

    // The ref a receiver names: `this.box.current`, with `?.`, `!` or a `const` one name away.
    const heldBy = (receiver: ts.Expression, hops = 0): { name: string; held: Held } | undefined => {
      const at = unwrap(receiver);
      if (ts.isIdentifier(at) && hops < 4) {
        const elements = refCallbackElements(at, cls, context, refElements);
        if (elements.length > 0) {
          return { name: at.text, held: elements.map((element) => heldAs(element, boxes, context)).reduce(either) };
        }
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
    const reachesAField = (receiver: ts.Expression, hops = 0, held = heldBy(receiver)): boolean => {
      if (held !== undefined) return held.held.clicked || held.held.field;
      const at = unwrap(receiver);
      if (ts.isIdentifier(at) && hops < 4) {
        const declared = resolve(at)?.declarations?.[0];
        if (declared !== undefined && eachOfAQuery(declared)) return true;
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
        // A function runs where it is CALLED, not where it is written — see `whenItRuns`. One written
        // here, a local one named here, or the class's own: each is read when what it is handed to runs
        // it now, and left when that is later or when it is only kept.
        if (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) {
          if (whenItRuns(at) === "now") enter(at);
          return;
        }
        // A method, an accessor or a class written here is only kept — `this.api = { open() { … } }` —
        // and runs where it is called, as a function declaration does.
        if (
          ts.isFunctionDeclaration(at) ||
          ts.isMethodDeclaration(at) ||
          ts.isGetAccessorDeclaration(at) ||
          ts.isSetAccessorDeclaration(at) ||
          ts.isClassExpression(at) ||
          ts.isClassDeclaration(at)
        )
          return;
        if (ts.isIdentifier(at) && whenItRuns(at) === "now") {
          const local = localFunction(at, resolve);
          if (local !== undefined) enter(local);
        }
        if (
          ts.isPropertyAccessExpression(at) &&
          at.expression.kind === ts.SyntaxKind.ThisKeyword &&
          members.has(at.name.text) &&
          whenItRuns(at) === "now"
        ) {
          enter(members.get(at.name.text) as ts.Node);
        }
        if (ts.isPropertyAccessExpression(at) && at.expression.kind === ts.SyntaxKind.ThisKeyword) {
          // An accessor runs where it is used: a getter where it is read, a setter where it is written.
          const used = usedAs(at);
          const getter = getters.get(at.name.text);
          const setter = setters.get(at.name.text);
          if (getter !== undefined && used !== "written") enter(getter);
          if (setter !== undefined && used !== "read") enter(setter);
        }
        if (ts.isCallExpression(at)) {
          const callee = unwrap(at.expression);
          if (ts.isPropertyAccessExpression(callee)) {
            const method = callee.name.text;
            const held = method === "dispatchEvent" ? heldBy(callee.expression) : undefined;
            if (method === "dispatchEvent" && reachesAField(callee.expression, 0, held)) {
              const event = at.arguments[0] === undefined ? undefined : eventBuilt(at.arguments[0], resolve);
              const types =
                event !== undefined && event.arguments?.[0] !== undefined
                  ? literalsOf(event.arguments[0], resolve)
                  : undefined;
              if (types === undefined) report(at, "unreadable", at.arguments[0]?.getText() ?? "");
              else {
                for (const type of types) {
                  // An `input` or a `change` edits the field it is dispatched at — not a label of one,
                  // which only a click passes on.
                  if (EDIT_EVENTS.has(type) && (held === undefined || held.held.field)) report(at, "dispatch", type);
                  else if (type === "click" && held !== undefined && held.held.clicked) {
                    report(at, "click", held.name);
                  }
                }
              }
            }
            if (method === "click" && at.arguments.length === 0) {
              const held = heldBy(callee.expression);
              if (held !== undefined && held.held.clicked) report(at, "click", held.name);
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
          // Only a field with a model: `.value` on a hidden input, `.checked` on a box no model holds,
          // is the element's own and the page's, as core reads it.
          if (held !== undefined && held.held.models.has(at.left.name.text as "value" | "checked")) {
            report(at.left, "write", `${held.name}.${at.left.name.text}`);
          }
        }
        ts.forEachChild(at, look);
      };

      // A function's statements, every one: an `async` one's too, past an `await` as well — see the
      // rule's description for why the check does not tell them apart.
      const body = (fn: ts.FunctionLikeDeclaration): void => {
        const statements = fn.body === undefined ? [] : ts.isBlock(fn.body) ? fn.body.statements : [fn.body];
        for (const statement of statements) look(statement);
      };

      const enter = (fn: ts.Node): void => {
        if (visited.has(fn)) return;
        visited.add(fn);
        if (
          ts.isMethodDeclaration(fn) ||
          ts.isGetAccessorDeclaration(fn) ||
          ts.isSetAccessorDeclaration(fn) ||
          ts.isConstructorDeclaration(fn) ||
          ts.isArrowFunction(fn) ||
          ts.isFunctionExpression(fn) ||
          ts.isFunctionDeclaration(fn)
        ) {
          body(fn);
        }
      };

      enter(node);
    };

    for (const member of cls.members) {
      if (ts.isConstructorDeclaration(member) && member.body !== undefined) {
        walk(member, "the constructor");
        continue;
      }
      const name = memberName(member);
      if (name === undefined) continue;
      // `render() {}`, or `render = () => …`.
      if (name === "render") {
        const fn = members.get(name);
        if (fn !== undefined) walk(fn, "render");
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

/** Constructors whose callback runs later: an observer is called when what it watches changes. */
const LATER_CONSTRUCTORS = new Set([
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "PerformanceObserver",
]);

/**
 * When a function value runs, by where it is used: `now` — called there, or handed to a call that is
 * not known to run it later (`forEach`, `new Promise`, a function this cannot name); `later` — handed
 * to one of `LATER`, an observer, or written as an attribute (`onclick={…}` is an event handler, a
 * prop's function is the receiving component's to call) other than `ref`, which runs in the commit;
 * `kept` — stored or returned, for whoever reads it: its uses decide. Read through what only passes it
 * on: parentheses, `as`, `!`, an arm of `?:`, a side of `??`, `||` and `&&`.
 */
function whenItRuns(value: ts.Node): "now" | "later" | "kept" {
  let at = value;
  for (;;) {
    const parent = at.parent;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== at) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))
    ) {
      at = parent;
      continue;
    }
    break;
  }
  const parent = at.parent;
  // `fn.call(…)` and `fn.apply(…)` run it there; `fn.bind(…)` is it again, run wherever that is.
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === at &&
    ["call", "apply", "bind"].includes(parent.name.text) &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return parent.name.text === "bind" ? whenItRuns(parent.parent) : "now";
  }
  if (ts.isCallExpression(parent)) {
    if (parent.expression === at) return "now";
    if (parent.arguments.some((argument) => argument === at)) return namedLater(parent.expression) ? "later" : "now";
  }
  if (ts.isNewExpression(parent) && parent.arguments?.some((argument) => argument === at)) {
    const made = unwrap(parent.expression);
    return ts.isIdentifier(made) && LATER_CONSTRUCTORS.has(made.text) ? "later" : "now";
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return parent.parent.name.getText() === "ref" ? "now" : "later";
  }
  return "kept";
}

/**
 * How an expression is used: `written` — the target of `=`, of a destructuring (`[this.on] = pair`) or
 * of a `for…of`; `both` — `this.count += 1`, `this.count++`; `read` — anything else.
 */
function usedAs(target: ts.Expression): "read" | "written" | "both" {
  const parent = target.parent;
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return "both";
  }
  // Up through a destructuring, if it is in one, to what it is assigned from: `[this.a, { b: this.b }] = pair`.
  let at: ts.Node = target;
  for (;;) {
    const up = at.parent;
    if (ts.isBinaryExpression(up) && up.left === at) {
      const kind = up.operatorToken.kind;
      if (kind === ts.SyntaxKind.EqualsToken) return "written";
      return at === target && kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
        ? "both"
        : "read";
    }
    if (ts.isForOfStatement(up) || ts.isForInStatement(up)) return up.initializer === at ? "written" : "read";
    if (
      ts.isArrayLiteralExpression(up) ||
      ts.isObjectLiteralExpression(up) ||
      ts.isSpreadElement(up) ||
      ts.isSpreadAssignment(up) ||
      (ts.isPropertyAssignment(up) && up.initializer === at)
    ) {
      at = up;
      continue;
    }
    return "read";
  }
}

/** Whether a callee is one of `LATER`, by its name: `queueMicrotask`, `promise.then`. */
function namedLater(callee: ts.Expression): boolean {
  const at = unwrap(callee);
  const name = ts.isIdentifier(at) ? at.text : ts.isPropertyAccessExpression(at) ? at.name.text : undefined;
  return name !== undefined && LATER.has(name);
}

/** The function a local name holds: `function tick() {}`, or `const tick = () => …`. */
function localFunction(name: ts.Identifier, resolve: Resolver): ts.FunctionLikeDeclaration | undefined {
  const declared = resolve(name)?.declarations?.[0];
  if (declared === undefined) return undefined;
  if (ts.isFunctionDeclaration(declared)) return declared;
  if (
    ts.isVariableDeclaration(declared) &&
    declared.initializer !== undefined &&
    (ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) !== 0
  ) {
    const held = unwrap(declared.initializer);
    if (ts.isArrowFunction(held) || ts.isFunctionExpression(held)) return held;
  }
  return undefined;
}

/** The `new Event(…)` an argument is, written there or held by a `const` a few names away. */
function eventBuilt(argument: ts.Expression, resolve: Resolver, hops = 0): ts.NewExpression | undefined {
  const at = unwrap(argument);
  if (ts.isNewExpression(at)) return at;
  if (!ts.isIdentifier(at) || hops > 4) return undefined;
  const declared = resolve(at)?.declarations?.[0];
  if (
    declared === undefined ||
    !ts.isVariableDeclaration(declared) ||
    declared.initializer === undefined ||
    (ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  return eventBuilt(declared.initializer, resolve, hops + 1);
}

/** `querySelector(…)`, `getElementById(…)` and their family: an element that may be a field. */
const ELEMENT_QUERIES = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByName",
  "getElementsByTagName",
  "getElementsByClassName",
  "closest",
]);

/**
 * A query for elements, or one taken from what it found — `querySelectorAll("input")[0]`, `.item(0)` — and
 * a form's own list of its fields, `form.elements`, with one taken from it: `.elements[0]`,
 * `.elements.email`, `.elements.namedItem("email")`.
 */
function isAnElementQuery(expression: ts.Expression): boolean {
  const at = unwrap(expression);
  if (ts.isPropertyAccessExpression(at) && at.name.text === "elements") return true;
  if (ts.isElementAccessExpression(at)) return isAnElementQuery(at.expression);
  if (ts.isPropertyAccessExpression(at)) {
    const list = unwrap(at.expression);
    return ts.isPropertyAccessExpression(list) && list.name.text === "elements";
  }
  if (!ts.isCallExpression(at)) return false;
  const callee = unwrap(at.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text === "item" || callee.name.text === "namedItem") return isAnElementQuery(callee.expression);
  return ELEMENT_QUERIES.has(callee.name.text);
}

/**
 * Whether a name is each element of a query's list: `for (const el of root.querySelectorAll("input"))`,
 * or the first parameter of a callback handed to its `forEach`.
 */
function eachOfAQuery(declared: ts.Declaration): boolean {
  const list = declared.parent;
  if (ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent))
    return isAnElementQuery(list.parent.expression);
  if (!ts.isParameter(declared) || declared.parent.parameters[0] !== declared) return false;
  const call = declared.parent.parent;
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrap(call.expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "forEach" && isAnElementQuery(callee.expression);
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
  const field = fieldKind(typeAttributeOf(node), context.resolve);
  return field === "box" || (field === "unread" && says(opening, "checked", context.resolve));
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
      // Core's `Select` and `TextArea` are no box; any other component's markup is not read here, and
      // whatever it renders may be one.
      const core = coreElementTag(openingOf(node).tagName, context.resolve);
      if (core === "select" || core === "textarea") return;
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
  // `{undefined}`, or a `const` holding it, is no model — see `says`.
  const said = (name: string) => says(opening, name, context.resolve);
  const tag = coreElementTag(opening.tagName, context.resolve) ?? opening.tagName.getText();
  const model = (name: "value" | "checked") => (said(name) ? new Set([name]) : NOTHING);
  if (tag === "label") return { clicked: labelsABox(node, boxes, context), field: false, models: NOTHING };
  if (tag === "input") {
    // A box's model is `checked`: its `.value` is only what the form sends.
    if (isABox(node, context)) return { clicked: true, field: true, models: model("checked") };
    // A hidden, a button, a file input holds no model, whatever its `value`.
    if (fieldKind(typeAttributeOf(node), context.resolve) === "unedited") return NEITHER;
    return { clicked: false, field: true, models: model("value") };
  }
  if (tag === "select" || tag === "textarea") return { clicked: false, field: true, models: model("value") };
  return NEITHER;
}

/**
 * The fields with a literal `id` this class renders — an `<input>`, a `<select>`, a `<textarea>`, core's
 * `Select` and `TextArea` — and whether each is a box: what a `for` names.
 */
function boxesOf(cls: ts.ClassLikeDeclaration, context: RuleContext): Map<string, boolean> {
  const boxes = new Map<string, boolean>();
  const ids = (node: ts.Node): void => {
    const tag =
      ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)
        ? (coreElementTag(openingOf(node).tagName, context.resolve) ?? openingOf(node).tagName.getText())
        : undefined;
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      (tag === "input" || tag === "select" || tag === "textarea")
    ) {
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

/** What two elements a ref may be on hold together: what either does — see `Held`. */
function either(a: Held, b: Held): Held {
  return { clicked: a.clicked || b.clicked, field: a.field || b.field, models: new Set([...a.models, ...b.models]) };
}

/**
 * The elements a `ref` callback's parameter is: `ref={(node) => …}` is handed the element it is written
 * on, and a method handed as one — `ref={this.attach}` — every element the class writes it on.
 */
function refCallbackElements(
  name: ts.Identifier,
  cls: ts.ClassLikeDeclaration,
  context: RuleContext,
  found: Map<ts.ParameterDeclaration, (ts.JsxElement | ts.JsxSelfClosingElement)[]>,
): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const declared = context.resolve(name)?.declarations?.[0];
  if (declared === undefined || !ts.isParameter(declared)) return [];
  let elements = found.get(declared);
  if (elements === undefined) {
    elements = elementsOfRefCallback(declared, cls, context);
    found.set(declared, elements);
  }
  return elements;
}

/** The elements a `ref` callback whose parameter this is is handed — see `refCallbackElements`. */
function elementsOfRefCallback(
  declared: ts.ParameterDeclaration,
  cls: ts.ClassLikeDeclaration,
  context: RuleContext,
): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  // A method handed as a ref — `ref={this.attach}` — or a function kept in a field, `attach = (node) => …`,
  // read through what only passes it on, as the class's own functions are: `attach = ((node) => …)`.
  const fn = declared.parent;
  let written: ts.Node = fn;
  while (
    ts.isParenthesizedExpression(written.parent) ||
    ts.isAsExpression(written.parent) ||
    ts.isSatisfiesExpression(written.parent) ||
    ts.isNonNullExpression(written.parent)
  ) {
    written = written.parent;
  }
  const isFunction = ts.isArrowFunction(fn) || ts.isFunctionExpression(fn);
  const method = isFunction && ts.isPropertyDeclaration(written.parent) ? written.parent : fn;
  if ((ts.isMethodDeclaration(method) || ts.isPropertyDeclaration(method)) && method.parent === cls) {
    const named = memberName(method);
    return elementsWithARef(
      cls,
      (held) =>
        ts.isPropertyAccessExpression(held) &&
        held.expression.kind === ts.SyntaxKind.ThisKeyword &&
        held.name.text === named,
    );
  }
  // A function named where it is written — `const attach = (node) => …`, `function attach(node) {}` —
  // and handed as a ref by that name: every element it is written on.
  const local =
    ts.isFunctionDeclaration(fn) && fn.name !== undefined
      ? fn
      : isFunction && ts.isVariableDeclaration(written.parent) && written.parent.initializer === written
        ? written.parent
        : undefined;
  if (local !== undefined) {
    return elementsWithARef(cls, (held) => ts.isIdentifier(held) && context.resolve(held)?.declarations?.[0] === local);
  }
  // Through what only passes it on: `ref={((node) => …)}`, `ref={on ? (node) => … : undefined}`.
  let expression: ts.Node = declared.parent.parent;
  while (ts.isParenthesizedExpression(expression) || ts.isConditionalExpression(expression)) {
    expression = expression.parent;
  }
  if (!ts.isJsxExpression(expression) || !ts.isJsxAttribute(expression.parent)) return [];
  if (expression.parent.name.getText() !== "ref") return [];
  const opening = expression.parent.parent.parent;
  if (ts.isJsxSelfClosingElement(opening)) return [opening];
  return ts.isJsxOpeningElement(opening) ? [opening.parent] : [];
}

/** Every element this class writes a `ref` on that holds what `names` says it is. */
function elementsWithARef(
  cls: ts.ClassLikeDeclaration,
  names: (held: ts.Expression) => boolean,
): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText() === "ref" && node.initializer !== undefined) {
      const written = ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
      if (written !== undefined && names(unwrap(written))) {
        const opening = node.parent.parent;
        if (ts.isJsxSelfClosingElement(opening)) found.push(opening);
        else if (ts.isJsxOpeningElement(opening)) found.push(opening.parent);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(cls);
  return found;
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
        const element = heldAs(node, boxes, context);
        const before = refs.get(held.name.text);
        refs.set(held.name.text, before === undefined ? element : either(before, element));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(cls);
  return refs;
}
