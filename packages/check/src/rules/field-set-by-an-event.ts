import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { openingOf, says } from "./element";
import { unwrap } from "./follow-value";
import { attributeLiterals, classChain, type FieldKind, fieldKind, literalsOf, typeAttributeOf } from "./formTable";
import { coreDecorators } from "./lifecycle-env";
import { namesThePlatform } from "./platform";
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
 * What is an edit: dispatching `input`, `change`, `beforeinput` or a composition event at a field this
 * class renders — held by a ref, or handed to a ref's callback — or at an element a query finds, or a
 * form's `elements` hands, which may be one; a `click` on a checkbox, a radio or a `<label>` of one
 * that this class renders, by method or as a dispatched event; writing `.value` or `.checked` on a
 * field it renders with that model; `document.execCommand`, which edits the focused field. An event
 * whose type cannot be read is reported as one, and an `<input>` whose `type` cannot be read as a box
 * and a text field both: nothing says they are not. An event dispatched at the document, at the window
 * or at any other object — a store that extends `EventTarget` — reaches no field, which hears only what
 * is dispatched at it; and an element the class is handed rather than renders is not read here:
 * `RMD062` reports what reaches it.
 *
 * How far it looks: every method of the class the commit's work calls — its own or one it inherits from
 * a class of the project's; `this.method()`, `super.method()`, through `.call`, `.apply` or
 * `.bind(…)()` — every accessor it reads or writes, and every function written there that runs now — a
 * callback to `forEach`, `map` or any call this cannot name as later. One handed to `queueMicrotask`,
 * `setTimeout`, `requestAnimationFrame`, a promise's `then` or `addEventListener` runs after the
 * commit. An `async` method is read whole: whether a statement runs before an `await` or after it
 * depends on values the check cannot read — `this.cache ??= await load()` may not wait at all — so an
 * edit anywhere in it is reported, and one meant for later says so by handing it to `queueMicrotask`. A
 * function written as an attribute is not the commit's work either — `onclick={() => …}` is an event
 * handler, which the element calls, and a row whose handler clicks its checkbox does what a `<label>`
 * does; a prop's function is the receiving component's to call. A ref's callback is the commit's work:
 * core calls `box = createRef(this.attached)`'s `attached` with the element as it attaches it.
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

/**
 * `document.execCommand` commands that edit a field's text, by lower-case name. The rest — `bold` and the other formatting
 * commands, which a field ignores, and settings such as `styleWithCSS` or `defaultParagraphSeparator` —
 * edit none.
 */
const EDIT_COMMANDS = new Set([
  "inserttext",
  "inserthtml",
  "insertparagraph",
  "insertlinebreak",
  "delete",
  "forwarddelete",
  "cut",
  "paste",
  "undo",
  "redo",
]);

/** The decorators whose method a commit runs. */
const COMMIT_DECORATORS = new Set(["created", "mounted", "updated", "destroyed", "watchProp", "catchError"]);

/** Calls that run the function handed to them after the current work, or never: what they are given is not the commit's. */
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
  // Takes the handler away; it runs it neither now nor later.
  "removeEventListener",
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

    // The class's functions, by name — its own, then what it inherits from a class of the project's — and
    // what `super` names where it is written: what the class writing it inherits, not the component.
    const chain = classChain(cls, resolve);
    const own = functionsOf(chain);
    const { members } = own;
    const supers = new Map<ts.ClassLikeDeclaration, Functions>();
    const inheritedBy = (written: ts.Node): Functions | undefined => {
      const at = classAround(written);
      const index = at === undefined ? -1 : chain.indexOf(at);
      if (at === undefined || index === -1) return undefined;
      let found = supers.get(at);
      if (found === undefined) {
        found = functionsOf(chain.slice(index + 1));
        supers.set(at, found);
      }
      return found;
    };
    // `this.#prime` is the `#prime` of the class it is written in.
    const privates = new Map<ts.ClassLikeDeclaration, Functions>();
    const privateIn = (written: ts.Node): Functions | undefined => {
      const at = classAround(written);
      if (at === undefined || !chain.includes(at)) return undefined;
      let found = privates.get(at);
      if (found === undefined) {
        found = privateFunctionsOf(at);
        privates.set(at, found);
      }
      return found;
    };
    // A field a ref is kept in, by name — a `#private` one with the class it is the field of.
    const fieldKey = (name: ts.MemberName, written: ts.Node): string => {
      if (!ts.isPrivateIdentifier(name)) return name.text;
      const at = classAround(written);
      return `${name.text}@${at === undefined ? -1 : chain.indexOf(at)}`;
    };

    // What the class renders — with its own render or one it inherits — read across its chain.
    // Read when an edit-shaped call first asks: most classes send none.
    let refsRead: Map<string, Held> | undefined;
    const refs = (): Map<string, Held> => {
      refsRead ??= refsOf(chain, boxesOf(chain, context), context, fieldKey);
      return refsRead;
    };

    // A ref's callback — `box = createRef(this.attached)` — runs in the commit, handed the element that
    // ref is attached to: its parameter is that element, and its body commit work.
    // One callback a class makes two refs with is handed the elements of both.
    const callbackOf = new Map<ts.ParameterDeclaration, string[]>();
    const callbackRoots: { name: string; fn: ts.Node }[] = [];
    for (const { name: written, at, callback } of chain.flatMap((cls) => refCallbacksIn(cls, resolve))) {
      const field = fieldKey(written, at);
      const name = written.text;
      const fn = functionHandedAs(callback);
      if (fn === undefined) continue;
      const parameter = fn.parameters[0];
      if (parameter !== undefined) callbackOf.set(parameter, [...(callbackOf.get(parameter) ?? []), field]);
      callbackRoots.push({ name, fn });
    }
    // The function a callback is handed as: written there, `this.attached`, a local one, or one `.bind`.
    function functionHandedAs(handed: ts.Expression): ts.SignatureDeclaration | undefined {
      let at = unwrap(handed);
      if (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression) && at.expression.name.text === "bind")
        at = unwrap(at.expression.expression);
      if (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) return at;
      if (ts.isIdentifier(at)) return localFunction(at, resolve);
      if (ts.isPropertyAccessExpression(at) && at.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const member = (ts.isPrivateIdentifier(at.name) ? privateIn(at)?.members : members)?.get(at.name.text);
        return member !== undefined && ts.isFunctionLike(member) ? member : undefined;
      }
      return undefined;
    }

    // The ref a receiver names: `this.box.current`, with `?.`, `!` or a `const` one name away.
    const heldBy = (receiver: ts.Expression, hops = 0): { name: string; held: Held } | undefined => {
      const at = unwrap(receiver);
      if (ts.isIdentifier(at) && hops < 4) {
        const declared = resolve(at)?.declarations?.[0];
        // A ref callback's parameter: the element its ref is attached to.
        const fields = declared !== undefined && ts.isParameter(declared) ? callbackOf.get(declared) : undefined;
        if (fields !== undefined) {
          const held = fields.flatMap((field) => refs().get(field) ?? []);
          return held.length === 0 ? undefined : { name: at.text, held: held.reduce(either) };
        }
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
      if (
        !ts.isPropertyAccessExpression(owner) ||
        owner.expression.kind !== ts.SyntaxKind.ThisKeyword ||
        !isTheComponent(owner.expression)
      )
        return undefined;
      const held = refs().get(fieldKey(owner.name, owner));
      return held === undefined ? undefined : { name: `this.${owner.name.text}`, held };
    };

    /**
     * Whether an event dispatched at `receiver` can reach a field: a field this class renders, held by
     * a ref, or an element found by a query — which may be one. `document`, `window` and any other
     * object — a store that extends `EventTarget` — cannot: a field hears what is dispatched at it.
     */
    const reachesAField = (receiver: ts.Expression, held: ReturnType<typeof heldBy>, hops = 0): boolean => {
      if (held !== undefined) return held.held.clicked || held.held.field;
      const at = unwrap(receiver);
      if (ts.isIdentifier(at) && hops < 4) {
        const declared = resolve(at)?.declarations?.[0];
        if (declared !== undefined && eachOfAQuery(declared, resolve)) return true;
        return (
          declared !== undefined &&
          ts.isVariableDeclaration(declared) &&
          declared.initializer !== undefined &&
          (ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) !== 0 &&
          reachesAField(declared.initializer, heldBy(declared.initializer), hops + 1)
        );
      }
      return isAnElementQuery(at, resolve);
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
          if (whenItRuns(at, resolve) === "now") enter(at);
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
        if (ts.isIdentifier(at) && whenItRuns(at, resolve) === "now") {
          const local = localFunction(at, resolve);
          if (local !== undefined) enter(local);
        }
        // `this.tick()`, and `super.tick()`, which names the inherited one.
        const functions =
          !ts.isPropertyAccessExpression(at) || !isTheComponent(at.expression)
            ? undefined
            : ts.isPrivateIdentifier(at.name)
              ? privateIn(at)
              : at.expression.kind === ts.SyntaxKind.ThisKeyword
                ? own
                : at.expression.kind === ts.SyntaxKind.SuperKeyword
                  ? inheritedBy(at)
                  : undefined;
        if (functions !== undefined && ts.isPropertyAccessExpression(at)) {
          const fn = functions.members.get(at.name.text);
          if (fn !== undefined && whenItRuns(at, resolve) === "now") enter(fn);
          // An accessor runs where it is used: a getter where it is read, a setter where it is written.
          const used = usedAs(at);
          const getter = functions.getters.get(at.name.text);
          const setter = functions.setters.get(at.name.text);
          if (getter !== undefined && used !== "written") enter(getter);
          if (setter !== undefined && used !== "read") enter(setter);
        }
        if (ts.isCallExpression(at)) {
          const callee = unwrap(at.expression);
          if (ts.isPropertyAccessExpression(callee)) {
            const method = callee.name.text;
            const held = method === "dispatchEvent" ? heldBy(callee.expression) : undefined;
            if (method === "dispatchEvent" && reachesAField(callee.expression, held)) {
              const event = at.arguments[0] === undefined ? undefined : eventBuilt(at.arguments[0], resolve);
              // Read as written, or off its type: `type: "focus" | "blur"` is those two.
              const name = event?.arguments?.[0];
              const types = name === undefined ? undefined : (literalsOf(name, resolve) ?? resolve.typeLiterals(name));
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
            if (method === "execCommand" && isDocument(callee.expression, resolve)) {
              // A command read as written or off its type; one that cannot be read may be an edit.
              const command = at.arguments[0];
              const commands =
                command === undefined ? undefined : (literalsOf(command, resolve) ?? resolve.typeLiterals(command));
              // A browser reads the name without regard to case: `InsertText` is `insertText`.
              if (commands === undefined || commands.some((name) => EDIT_COMMANDS.has(name.toLowerCase())))
                report(at, "exec-command", "execCommand");
            }
          }
        }
        // `.value` or `.checked` written — `=`, `+=`, `++`, a destructuring — by name or by `["checked"]`.
        const member = ts.isPropertyAccessExpression(at)
          ? at.name.text
          : ts.isElementAccessExpression(at) && ts.isStringLiteralLike(at.argumentExpression)
            ? at.argumentExpression.text
            : undefined;
        if ((member === "value" || member === "checked") && usedAs(at as ts.Expression) !== "read") {
          const held = heldBy((at as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression);
          // Only a field with a model: `.value` on a hidden input, `.checked` on a box no model holds,
          // is the element's own and the page's, as core reads it.
          if (held !== undefined && held.held.models.has(member)) report(at, "write", `${held.name}.${member}`);
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
      if (name === undefined || name === "render") continue;
      for (const { name: decorator } of coreDecorators(member, context)) {
        if (!COMMIT_DECORATORS.has(decorator)) continue;
        const fn = members.get(name);
        if (fn !== undefined) walk(fn, `@${decorator} ${name}`);
      }
    }
    // `render() {}`, `render = () => …`, or the render it inherits — what its commit renders with.
    const render = members.get("render");
    if (render !== undefined) walk(render, "render");
    for (const { name, fn } of callbackRoots) walk(fn, `the ref callback of this.${name}`);
    // `this.method()` reached from two roots is read once, and reported under the first.
    return found;
  },
} as const satisfies Rule<FieldSetByAnEventIssue>;

/** A class's functions by name: methods and arrow fields, and its accessors, kept apart — see `functionsOf`. */
interface Functions {
  members: Map<string, ts.Node>;
  getters: Map<string, ts.GetAccessorDeclaration>;
  setters: Map<string, ts.SetAccessorDeclaration>;
}

/**
 * The functions of these classes, by name — a class first, then the classes it extends: read from the
 * farthest base in, so a class's own takes the place of what it inherits. Methods and arrow fields, and
 * accessors, which run where they are read (`{this.view}`) or written (`this.on = true`).
 */
function functionsOf(classes: readonly ts.ClassLikeDeclaration[]): Functions {
  const found: Functions = { members: new Map(), getters: new Map(), setters: new Map() };
  for (const cls of [...classes].reverse()) {
    // A name the class declares, of any kind, hides every one it inherits: a field over a getter, a
    // method over a field. A `#private` name is its own class's alone — see `privateFunctionsOf`.
    // A `static` member is the class's, not its instances': `this.tick()` never names it.
    const instance = cls.members.filter((member) => !isStatic(member));
    const declared = instance
      .filter((member) => member.name === undefined || !ts.isPrivateIdentifier(member.name))
      .map((member) => memberName(member))
      .filter((name): name is string => name !== undefined);
    for (const name of declared) {
      found.members.delete(name);
      found.getters.delete(name);
      found.setters.delete(name);
    }
    for (const member of instance) {
      const name = memberName(member);
      if (name === undefined || (member.name !== undefined && ts.isPrivateIdentifier(member.name))) continue;
      if (ts.isGetAccessorDeclaration(member) && member.body !== undefined) found.getters.set(name, member);
      else if (ts.isSetAccessorDeclaration(member) && member.body !== undefined) found.setters.set(name, member);
      else if (ts.isMethodDeclaration(member) && member.body !== undefined) found.members.set(name, member);
      else if (ts.isPropertyDeclaration(member)) {
        // A field holding a function written there is one; any other — `start = this.go.bind(this)` —
        // is not one this reads, and hides what the class inherits under its name.
        const held = member.initializer === undefined ? undefined : unwrap(member.initializer);
        if (held !== undefined && (ts.isArrowFunction(held) || ts.isFunctionExpression(held)))
          found.members.set(name, held);
      }
    }
  }
  return found;
}

/** A class's `#private` functions: `this.#prime()` written in a class is that class's own `#prime`. */
function privateFunctionsOf(cls: ts.ClassLikeDeclaration): Functions {
  const found: Functions = { members: new Map(), getters: new Map(), setters: new Map() };
  for (const member of cls.members) {
    if (member.name === undefined || !ts.isPrivateIdentifier(member.name) || isStatic(member)) continue;
    const name = member.name.text;
    if (ts.isGetAccessorDeclaration(member) && member.body !== undefined) found.getters.set(name, member);
    else if (ts.isSetAccessorDeclaration(member) && member.body !== undefined) found.setters.set(name, member);
    else if (ts.isMethodDeclaration(member) && member.body !== undefined) found.members.set(name, member);
    else if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
      const held = unwrap(member.initializer);
      if (ts.isArrowFunction(held) || ts.isFunctionExpression(held)) found.members.set(name, held);
    }
  }
  return found;
}

/** Whether a class member is `static`. */
function isStatic(member: ts.ClassElement): boolean {
  return (ts.getCombinedModifierFlags(member as ts.Declaration) & ts.ModifierFlags.Static) !== 0;
}

/** The class a node is written in, nearest first. */
function classAround(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let at: ts.Node | undefined = node.parent;
  while (at !== undefined && !ts.isClassLike(at)) at = at.parent;
  return at;
}

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
 * prop's function is the receiving component's to call); `kept` — stored or returned, for whoever reads
 * it, or handed to `createRef`: its uses decide, and a ref's callback is read where it runs. Read
 * through what only passes it on: parentheses, `as`, `!`, an arm of `?:`, a side of `??`, `||` and
 * `&&`.
 */
function whenItRuns(value: ts.Node, resolve: Resolver): "now" | "later" | "kept" {
  const at = passedOn(value);
  const parent = at.parent;
  // `fn.call(…)` and `fn.apply(…)` run it there; `fn.bind(…)` is it again, run wherever that is.
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === at &&
    ["call", "apply", "bind"].includes(parent.name.text) &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return parent.name.text === "bind" ? whenItRuns(parent.parent, resolve) : "now";
  }
  if (ts.isCallExpression(parent)) {
    if (parent.expression === at) return "now";
    // A ref's callback runs when its element is attached — read from there, see `refCallbacks`.
    if (parent.arguments.some((argument) => argument === at))
      return resolve.coreName(parent.expression) === "createRef"
        ? "kept"
        : namedLater(parent.expression)
          ? "later"
          : "now";
  }
  if (ts.isNewExpression(parent) && parent.arguments?.some((argument) => argument === at)) {
    const made = unwrap(parent.expression);
    return ts.isIdentifier(made) && LATER_CONSTRUCTORS.has(made.text) ? "later" : "now";
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return "later";
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

/**
 * The outermost expression a value is passed on through, unchanged: parentheses, `as`, `!`,
 * `satisfies`, an arm of `?:`, a side of `??`, `||` and `&&`.
 */
function passedOn(value: ts.Node): ts.Node {
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
    return at;
  }
}

/**
 * Whether `this` here is the component: written in its class, not inside a `function` — whose `this` is
 * whatever calls it, `forEach(function () { … }, other)`, unless the class keeps it in a field as one of
 * its own — nor in an object's method. An arrow keeps the `this` around it.
 */
function isTheComponent(self: ts.Node): boolean {
  for (let at = self.parent; at !== undefined; at = at.parent) {
    if (ts.isClassLike(at)) return true;
    // A `function` kept in a field — `attach = function () { … }` — is called as the class's own method.
    if (ts.isFunctionDeclaration(at) || (ts.isFunctionExpression(at) && !ts.isPropertyDeclaration(passedOn(at).parent)))
      return false;
    if (
      (ts.isMethodDeclaration(at) || ts.isGetAccessorDeclaration(at) || ts.isSetAccessorDeclaration(at)) &&
      ts.isObjectLiteralExpression(at.parent)
    )
      return false;
  }
  return false;
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
function isAnElementQuery(expression: ts.Expression, resolve: Resolver): boolean {
  const at = unwrap(expression);
  // A form's `elements`, by the type of what it is taken from: a store's `elements` is no form's.
  const formsElements = (list: ts.Expression) => {
    const read = unwrap(list);
    return ts.isPropertyAccessExpression(read) && read.name.text === "elements" && resolve.mayBeAForm(read.expression);
  };
  if (formsElements(at)) return true;
  if (ts.isElementAccessExpression(at)) return isAnElementQuery(at.expression, resolve);
  if (ts.isPropertyAccessExpression(at)) return formsElements(at.expression);
  if (!ts.isCallExpression(at)) return false;
  const callee = unwrap(at.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text === "item" || callee.name.text === "namedItem")
    return isAnElementQuery(callee.expression, resolve);
  return ELEMENT_QUERIES.has(callee.name.text);
}

/**
 * Whether a name is each element of a query's list: `for (const el of root.querySelectorAll("input"))`,
 * or the first parameter of a callback handed to its `forEach`.
 */
function eachOfAQuery(declared: ts.Declaration, resolve: Resolver): boolean {
  const list = declared.parent;
  if (ts.isVariableDeclarationList(list) && ts.isForOfStatement(list.parent))
    return isAnElementQuery(list.parent.expression, resolve);
  if (!ts.isParameter(declared) || declared.parent.parameters[0] !== declared) return false;
  // Through what only passes the callback on: `forEach(((el) => …))`.
  let call: ts.Node = declared.parent.parent;
  while (ts.isParenthesizedExpression(call) || ts.isAsExpression(call) || ts.isSatisfiesExpression(call))
    call = call.parent;
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrap(call.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "forEach" &&
    isAnElementQuery(callee.expression, resolve)
  );
}

/**
 * The platform's `document` — not a `const document = editor.doc`, nor a model's `this.model.document` —
 * reached as `document`, `window.document` or `globalThis.document`, or an element's `ownerDocument`.
 */
function isDocument(expression: ts.Expression, resolve: Resolver): boolean {
  const at = unwrap(expression);
  if (ts.isIdentifier(at)) return at.text === "document" && namesThePlatform(at, resolve);
  if (!ts.isPropertyAccessExpression(at)) return false;
  if (at.name.text === "ownerDocument") return true;
  const owner = unwrap(at.expression);
  return (
    at.name.text === "document" &&
    ts.isIdentifier(owner) &&
    ["window", "globalThis", "self"].includes(owner.text) &&
    namesThePlatform(owner, resolve)
  );
}

/**
 * Whether an `<input>` written here may be a checkbox or a radio: its `type` says so, or cannot be read —
 * `type={kind}` with `kind: "checkbox" | "text"` may be either, and nothing says a click on it edits nothing.
 */
function isABox(node: ts.JsxElement | ts.JsxSelfClosingElement, context: RuleContext): boolean {
  return openingOf(node).tagName.getText() === "input" && mayBeABox(fieldKind(typeAttributeOf(node), context.resolve));
}

/** Whether an input of this kind may be a checkbox or a radio — see `isABox`. */
function mayBeABox(kind: FieldKind): boolean {
  return kind === "box" || kind === "unread";
}

/**
 * Whether clicking a `<label>` edits a field: it labels a checkbox or a radio — inside it, or named by
 * `for` — or what it labels cannot be read: an app's component inside it (core's place their children,
 * which are read), a `for` that is not a literal, or one that names no field this class renders. A label
 * of a text field only moves the focus.
 */
function labelsABox(
  label: ts.JsxElement | ts.JsxSelfClosingElement,
  boxes: Map<string, boolean>,
  context: RuleContext,
): boolean {
  const opening = openingOf(label);
  // A `for` written as nothing — `for={undefined}` — is none, as core reads it.
  const forAttribute = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) &&
      ["for", "htmlFor"].includes(p.name.getText()) &&
      says(opening, p.name.getText(), context.resolve),
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
      // Core's other components — `ErrorBoundary`, `Portal` — render their children where they stand,
      // and those are read here.
      const placesItsChildren = context.resolve.coreName(openingOf(node).tagName) !== undefined;
      if (!placesItsChildren && (/^[A-Z]/.test(tag) || tag.includes("."))) found = true;
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
    // A box's model is `checked`: its `.value` is only what the form sends. One whose `type` cannot be
    // read may be a box or a text field, and its model either.
    const kind = fieldKind(typeAttributeOf(node), context.resolve);
    if (mayBeABox(kind)) {
      return {
        clicked: true,
        field: true,
        models: kind === "unread" ? new Set([...model("checked"), ...model("value")]) : model("checked"),
      };
    }
    // A hidden, a button, a file input holds no model, whatever its `value`.
    if (kind === "unedited") return NEITHER;
    return { clicked: false, field: true, models: model("value") };
  }
  if (tag === "select" || tag === "textarea") return { clicked: false, field: true, models: model("value") };
  return NEITHER;
}

/**
 * The fields with a literal `id` this class renders — an `<input>`, a `<select>`, a `<textarea>`, core's
 * `Select` and `TextArea` — and whether each is a box: what a `for` names.
 */
function boxesOf(classes: readonly ts.ClassLikeDeclaration[], context: RuleContext): Map<string, boolean> {
  const boxes = new Map<string, boolean>();
  const ids = (node: ts.Node): void => {
    if (ts.isClassLike(node) && !classes.includes(node)) return;
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
      // An id on more than one element — one per branch of a `?:` — names a box if any of them is one.
      for (const literal of attributeLiterals(id, context.resolve) ?? [])
        boxes.set(literal, (boxes.get(literal) ?? false) || isABox(node, context));
    }
    ts.forEachChild(node, ids);
  };
  for (const cls of classes) ids(cls);
  return boxes;
}

/** What two elements a ref may be on hold together: what either does — see `Held`. */
function either(a: Held, b: Held): Held {
  return { clicked: a.clicked || b.clicked, field: a.field || b.field, models: new Set([...a.models, ...b.models]) };
}

/**
 * Each ref a class makes with a callback — `box = createRef(this.attached)`, or `this.box = createRef(cb)`
 * — by the field it is kept in: core calls the callback when the element is attached, in the commit. A
 * class written inside it makes refs of its own, and is not read. Read once for each class.
 */
function refCallbacksIn(
  cls: ts.ClassLikeDeclaration,
  resolve: Resolver,
): { name: ts.MemberName; at: ts.Node; callback: ts.Expression }[] {
  const known = refCallbacksRead.get(cls);
  if (known !== undefined) return known;
  const found: { name: ts.MemberName; at: ts.Node; callback: ts.Expression }[] = [];
  const handedTo = (value: ts.Expression | undefined): ts.Expression | undefined => {
    const call = value === undefined ? undefined : unwrap(value);
    if (call === undefined || !ts.isCallExpression(call) || resolve.coreName(call.expression) !== "createRef")
      return undefined;
    return call.arguments[0];
  };
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node) && node !== cls) return;
    if (ts.isPropertyDeclaration(node) && (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))) {
      const callback = handedTo(node.initializer);
      if (callback !== undefined) found.push({ name: node.name, at: node, callback });
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const callback = handedTo(node.right);
      if (callback !== undefined) found.push({ name: node.left.name, at: node, callback });
    }
    ts.forEachChild(node, visit);
  };
  visit(cls);
  refCallbacksRead.set(cls, found);
  return found;
}

/** What `refCallbacksIn` read of each class. */
const refCallbacksRead = new WeakMap<
  ts.ClassLikeDeclaration,
  { name: ts.MemberName; at: ts.Node; callback: ts.Expression }[]
>();

/**
 * Every ref this class renders, by field name, and what it is attached to: a checkbox or a radio, a
 * `<label>` of one, a field written with its model (`value`, `checked`), or anything else.
 */
function refsOf(
  classes: readonly ts.ClassLikeDeclaration[],
  boxes: Map<string, boolean>,
  context: RuleContext,
  fieldKey: (name: ts.MemberName, written: ts.Node) => string,
): Map<string, Held> {
  const refs = new Map<string, Held>();
  const visit = (node: ts.Node): void => {
    // A class written inside one keeps refs of its own.
    if (ts.isClassLike(node) && !classes.includes(node)) return;
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
        const key = fieldKey(held.name, held);
        const before = refs.get(key);
        refs.set(key, before === undefined ? element : either(before, element));
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const cls of classes) visit(cls);
  return refs;
}
