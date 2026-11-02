import { UNEDITED_INPUT_TYPES } from "@ramonda/dom-facts";
import ts from "typescript";
import { memberName, positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { holdsNothing as holdsNothingIn, openingOf, says, tagOf } from "./element";
import { unwrap } from "./follow-value";
import type { Resolver, Where } from "./rule";

/**
 * The project's `@ramonda/form` forms, the fields inside them, and every place a component is used
 * inside one — collected in one pass, judged by `form-field-without-what-the-form-needs`.
 *
 * Most questions here are about DECLARATIONS and source: where a field of a class was declared and what
 * initialises it, where an identifier was imported from, what attributes an element is written with. Two
 * are asked of a TYPE, where the source does not say: the names a spread on a component hands
 * (`resolve.propertyNames`), and the strings an attribute written as an expression can be
 * (`resolve.typeLiterals`). A form is recognised by exactly one shape — see `ramondaFormElements` — so
 * nothing is inferred from names or guessed through a chain.
 */

/** What `@ramonda/form` needs on a control, each written by name. */
export const FORM_ATTRIBUTES = ["name", "value", "oninput", "onblur", "aria-invalid"] as const;

/** Where a field's attribute comes from: written on it, a prop of its component, or nowhere. */
export type AttributeSource = { kind: "written" } | { kind: "prop"; prop: string } | { kind: "missing" };

/** A controlled field, as the rule needs to see it. */
export interface FormField extends Where {
  /** The class whose render writes it, or `undefined` in a function outside any class. */
  owner: ts.ClassLikeDeclaration | undefined;
  /** Whether a `@ramonda/form` form encloses it within the same render. */
  inForm: boolean;
  /** Each of `FORM_ATTRIBUTES`, and where it comes from. `value` stands for `checked` on a box. */
  attributes: Record<(typeof FORM_ATTRIBUTES)[number], AttributeSource>;
  /** How the field is written, for a report: `input`, `Select`, `TextArea`. */
  tag: string;
}

/** One place a component is used, as the rule needs to see it. */
export interface ComponentSite extends Where {
  /** The class whose render writes the tag. */
  owner: ts.ClassLikeDeclaration | undefined;
  /** The component it names, when its declaration has a body this can read. */
  target: ts.ClassLikeDeclaration | undefined;
  /** The tag as written, for a report. */
  tag: string;
  /** Whether a `@ramonda/form` form encloses this use within the same render. */
  inForm: boolean;
  /** Each attribute written on the tag, by name, with its value. `undefined` is a bare attribute. */
  props: Map<string, ts.Expression | undefined>;
  /**
   * Every name the spreads on the tag may hand, read off their types — `undefined` when one cannot be read
   * (`any`). Only MAY: a type does not say what a spread copies — a getter, as a form field's `inputValue`
   * is, is not copied, though its type names it — so no name is handed by a spread for sure.
   */
  spreadMayHand: ReadonlySet<string> | undefined;
  /**
   * Whether the tag spreads its owner's own props, `{...this.props}`: a name it needs comes from the
   * owner's uses, as `name={this.props.name}` does. Not read into `spreadMayHand`.
   */
  spreadsOwnProps: boolean;
}

/** A class that holds a `Form` and what became of it. */
export interface FormHolder extends Where {
  component: string;
  /** A hook holding one — `class SignupForm extends Hook { form = this.use(Form, …) }`. */
  isHook: boolean;
  /** The fields that hold one — `signup` in `signup = this.use(Form, …)` — for the report to name. */
  fields: readonly string[];
  /** Those of them for which the class renders no `<form onsubmit={this.X.submit}>`. */
  unattached: readonly string[];
}

/** `{...this.props.P}` on a field: what `P` holds is read where the component is used. */
export interface SpreadBag extends Where {
  owner: ts.ClassLikeDeclaration | undefined;
  prop: string;
  /** Whether the field writes its own handler by name, so a `value` in the spread has one. */
  handled: boolean;
  /** A select, a checkbox or a radio, whose handler may be `onchange`; a text field's is `oninput`. */
  pick: boolean;
  /** A checkbox or a radio, whose model is `checked`; a `value` on it is only what the form sends. */
  box: boolean;
  /**
   * An `<input>` whose `type` cannot be read, written without `checked`: a box or a text field, by what
   * the spread hands — a box when it hands `checked`.
   */
  unread: boolean;
  /** The attributes the field writes after the spread, which it therefore cannot override. */
  shadowed: readonly string[];
  /**
   * The form's attributes the field writes before it, with something — what the spread can take away.
   * Its form attributes by its kind: a text field's handler is `oninput`, so its own `onchange` is not
   * one. A handler is taken away under its own spelling only: `"on:input": undefined` leaves `oninput`.
   */
  overridable: readonly string[];
}

export interface FormFacts {
  /**
   * Whether an expression holds nothing — `null`, `undefined`, or a `const` holding one — so a
   * shorthand `{ oninput }` is read as `{ oninput: undefined }` is.
   */
  holdsNothing(expression: ts.Expression): boolean;
  fields: FormField[];
  bags: SpreadBag[];
  sites: ComponentSite[];
  holders: FormHolder[];
}

/**
 * What an `<input>`'s `type` makes the field: a `box` (its model is `checked`), a `text` field (`value`),
 * one no one edits, or one whose type cannot be read — and then either may be its model. One reading
 * for every rule, so no two of them decide the same field differently.
 */
export type FieldKind = "box" | "text" | "unedited" | "unread";

function kindOfType(type: string): FieldKind {
  const lower = type.toLowerCase();
  if (lower === "checkbox" || lower === "radio") return "box";
  return UNEDITED_INPUT_TYPES.has(lower) ? "unedited" : "text";
}

/**
 * The strings an expression can be, as written: a literal, or every arm of `?:`, `??` and `||` —
 * `type={busy ? "button" : "submit"}` is one of two. `undefined` when any of them cannot be read.
 */
export function literalsOf(expression: ts.Expression | undefined, resolve: Resolver, depth = 0): string[] | undefined {
  if (expression === undefined || depth > 8) return undefined;
  const value = unwrap(expression);
  if (ts.isStringLiteralLike(value)) return [value.text];
  // A `const` holding one: `const HIDDEN = "hidden"`.
  if (ts.isIdentifier(value)) {
    const declared = resolve(value)?.declarations?.[0];
    if (
      declared === undefined ||
      !ts.isVariableDeclaration(declared) ||
      declared.initializer === undefined ||
      (ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) === 0
    ) {
      return undefined;
    }
    return literalsOf(declared.initializer, resolve, depth + 1);
  }
  if (ts.isConditionalExpression(value)) {
    const yes = literalsOf(value.whenTrue, resolve, depth + 1);
    const no = literalsOf(value.whenFalse, resolve, depth + 1);
    return yes === undefined || no === undefined ? undefined : [...yes, ...no];
  }
  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const left = literalsOf(value.left, resolve, depth + 1);
    const right = literalsOf(value.right, resolve, depth + 1);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  return undefined;
}

/**
 * The strings a JSX attribute holds — as written (see `literalsOf`), or, where it is an expression no
 * literal reaches, off its TYPE: `type={this.props.type}` typed `"text" | "email"` holds those two. A
 * bare attribute holds none. One reading for every rule, so no two of them read one attribute apart.
 */
export function attributeLiterals(
  attribute: ts.JsxAttribute | undefined,
  resolve: Resolver,
  absentAs?: string,
): string[] | undefined {
  const written = attribute?.initializer;
  if (written === undefined) return undefined;
  const expression = ts.isJsxExpression(written) ? written.expression : written;
  return (
    literalsOf(expression, resolve) ??
    (expression === undefined ? undefined : resolve.typeLiterals(expression, absentAs))
  );
}

/**
 * An `<input>`'s `type`, every string it can be — as `attributeLiterals` reads it, and a `type` that may
 * be left off (`type?: "email"`) as `"text"` too, which is what an input with none is.
 */
export function typeLiterals(typeAttribute: ts.JsxAttribute, resolve: Resolver): string[] | undefined {
  return attributeLiterals(typeAttribute, resolve, "text");
}

/** An element's `type` attribute, as written. */
export function typeAttributeOf(element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttribute | undefined {
  return openingOf(element).attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText().toLowerCase() === "type",
  );
}

/**
 * The kind of field an `<input>` is, by its `type` attribute — every string it can be, through a
 * `const` as much as written in place. A `type` that can be either kind, or cannot be read, is `unread`.
 */
export function fieldKind(typeAttribute: ts.JsxAttribute | undefined, resolve: Resolver): FieldKind {
  return typeAttribute === undefined ? "text" : kindOfLiterals(typeLiterals(typeAttribute, resolve));
}

/** The kind of field the strings a `type` can be make it — `unread` when they disagree or are unknown. */
export function kindOfLiterals(literals: readonly string[] | undefined): FieldKind {
  if (literals === undefined) return "unread";
  const kinds = new Set(literals.map(kindOfType));
  return kinds.size === 1 ? [...kinds][0] : "unread";
}

/** The attribute that is a field's model, for its kind: both when its kind cannot be read. */
export function modelNames(kind: FieldKind): readonly string[] {
  if (kind === "box") return ["checked"];
  if (kind === "text") return ["value"];
  if (kind === "unread") return ["value", "checked"];
  return [];
}

/** `this.use(Form, …)` or `this.use(Form<typeof schema>, …)`, with `Form` imported from `@ramonda/form`. */
function isFormHook(initializer: ts.Expression | undefined, resolve: Resolver): boolean {
  if (initializer === undefined) return false;
  const call = unwrap(initializer);
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "use") return false;
  if (callee.expression.kind !== ts.SyntaxKind.ThisKeyword) return false;
  const first = call.arguments[0];
  if (first === undefined) return false;
  const hook = ts.isExpressionWithTypeArguments(first) ? first.expression : unwrap(first);
  if (!ts.isIdentifier(hook) || !resolve.fromPackage(hook, "@ramonda/form")) return false;
  const declared = resolve(hook)?.declarations?.[0];
  return declared !== undefined && ts.isClassDeclaration(declared) && declared.name?.text === "Form";
}

/** The names of a class's fields that hold a `Form`. */
function formFieldsOf(cls: ts.ClassLikeDeclaration, resolve: Resolver): Set<string> {
  const names = new Set<string>();
  for (const member of cls.members) {
    // A private one too, `#form`, read as `this.#form.submit`.
    if (
      ts.isPropertyDeclaration(member) &&
      (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) &&
      isFormHook(member.initializer, resolve)
    ) {
      names.add(member.name.text);
    }
  }
  return names;
}

/** Whether a class extends core's `Hook` — itself, or through a class of the project's that does. */
function isHookClass(cls: ts.ClassLikeDeclaration, resolve: Resolver): boolean {
  return classChain(cls, resolve).some((at) =>
    (at.heritageClauses ?? []).some(
      (clause) =>
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        clause.types.some((type) => resolve.coreName(type.expression) === "Hook"),
    ),
  );
}

function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at) || ts.isClassExpression(at)) return at;
  }
  return undefined;
}

/** `this.props`, as written. */
function isOwnProps(expression: ts.Expression): boolean {
  const written = unwrap(expression);
  return (
    ts.isPropertyAccessExpression(written) &&
    written.name.text === "props" &&
    unwrap(written.expression).kind === ts.SyntaxKind.ThisKeyword
  );
}

/** `this.props.P`, or `this.props["aria-invalid"]`, as written — the name, or `undefined`. */
export function propRead(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const written = unwrap(expression);
  let name: string;
  if (ts.isPropertyAccessExpression(written)) name = written.name.text;
  else if (ts.isElementAccessExpression(written) && ts.isStringLiteralLike(written.argumentExpression))
    name = written.argumentExpression.text;
  else return undefined;
  const object = unwrap(written.expression);
  if (!ts.isPropertyAccessExpression(object) || object.name.text !== "props") return undefined;
  return object.expression.kind === ts.SyntaxKind.ThisKeyword ? name : undefined;
}

function valueOf(attribute: ts.JsxAttribute): ts.Expression | undefined {
  const initializer = attribute.initializer;
  if (initializer === undefined) return undefined;
  if (ts.isJsxExpression(initializer)) return initializer.expression;
  return ts.isStringLiteral(initializer) ? initializer : undefined;
}

/** A component class this can read the render of: declared in source, with a body. */
function readableClass(tagName: ts.JsxTagNameExpression, resolve: Resolver): ts.ClassLikeDeclaration | undefined {
  const declaration = resolve(tagName)?.declarations?.[0];
  if (declaration === undefined) return undefined;
  // Asked of every component around every element read: answered once for each declaration.
  const known = readableClasses.get(declaration);
  if (known !== undefined) return known ?? undefined;
  const declared = classOf(declaration);
  // The class whose render it renders with — its own, or the nearest it inherits: the fields written
  // there are that class's. One a package declares cannot be read, and neither can the class using it.
  const renders =
    declared === undefined || !isReadable(declared)
      ? undefined
      : classChain(declared, resolve).find((cls) => cls.members.some((member) => memberName(member) === "render"));
  const found =
    declared === undefined || !isReadable(declared)
      ? undefined
      : renders === undefined
        ? declared
        : isReadable(renders)
          ? renders
          : undefined;
  readableClasses.set(declaration, found ?? null);
  return found;
}

/** What `readableClass` answered for each declaration — `null` for none. */
const readableClasses = new WeakMap<ts.Node, ts.ClassLikeDeclaration | null>();

/** A class with a body this can read: a `declare class` has none, wherever it is written, nor a package's `.d.ts`. */
function isReadable(cls: ts.ClassLikeDeclaration): boolean {
  const ambient = ts.getCombinedModifierFlags(cls as ts.Declaration) & ts.ModifierFlags.Ambient;
  return !cls.getSourceFile().isDeclarationFile && ambient === 0;
}

/**
 * A class, then each class it extends that the project's source or a package declares, nearest first —
 * named as `Base` or `ui.Base`, declared as a class or held by a `const`.
 */
export function classChain(cls: ts.ClassLikeDeclaration, resolve: Resolver): ts.ClassLikeDeclaration[] {
  const chain = [cls];
  for (let at = cls; ; ) {
    const clause = at.heritageClauses?.find((heritage) => heritage.token === ts.SyntaxKind.ExtendsKeyword);
    const base = clause?.types[0]?.expression;
    const named = base !== undefined && (ts.isIdentifier(base) || ts.isPropertyAccessExpression(base));
    const declared = named ? classOf(resolve(base)?.declarations?.[0]) : undefined;
    if (declared === undefined || chain.includes(declared)) return chain;
    chain.push(declared);
    at = declared;
  }
}

/** The class a declaration is, or the one a `const` holds: `const Row = class extends Component { … }`. */
function classOf(declaration: ts.Declaration | undefined): ts.ClassLikeDeclaration | undefined {
  const held =
    declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
      ? unwrap(declaration.initializer)
      : declaration;
  return held !== undefined && (ts.isClassDeclaration(held) || ts.isClassExpression(held)) ? held : undefined;
}

export function formTableFor(sources: readonly ts.SourceFile[], resolve: Resolver): FormFacts {
  const fields: FormField[] = [];
  const sites: ComponentSite[] = [];
  const holders: FormHolder[] = [];
  const bags: SpreadBag[] = [];

  /** Every `<form onsubmit={this.X.submit}>` whose `X` holds a `Form`, and the class that renders it. */
  const formElements = new Set<ts.Node>();
  /** Classes whose render places `this.props.children` inside such a form. */
  const childrenInForm = new Set<ts.ClassLikeDeclaration>();

  // Pass one: the forms, the classes holding them, and where children land.
  /** The forms each class attaches, by the field that holds them — its own, or one it inherits. */
  const attachedBy = new Map<ts.ClassLikeDeclaration, { chain: ts.ClassLikeDeclaration[]; fields: Set<string> }>();
  /** The classes that hold a form in a field of their own. */
  const ownForms: { cls: ts.ClassLikeDeclaration; fields: Set<string> }[] = [];
  const firstPass = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const chain = classChain(node, resolve);
      const own = formFieldsOf(node, resolve);
      if (own.size > 0) ownForms.push({ cls: node, fields: own });
      // What it holds: its own, and what it inherits.
      const held = new Set([...own, ...chain.slice(1).flatMap((base) => [...formFieldsOf(base, resolve)])]);
      if (held.size > 0) {
        const attached = new Set<string>();
        const look = (inner: ts.Node): void => {
          if ((ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner)) && tagOf(inner) === "form") {
            const submit = openingOf(inner).attributes.properties.find(
              (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "onsubmit",
            );
            const handler = submit === undefined ? undefined : valueOf(submit);
            const written = handler === undefined ? undefined : unwrap(handler);
            if (
              written !== undefined &&
              ts.isPropertyAccessExpression(written) &&
              written.name.text === "submit" &&
              ts.isPropertyAccessExpression(written.expression) &&
              written.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
              held.has(written.expression.name.text) &&
              enclosingClass(inner) === node
            ) {
              formElements.add(inner);
              attached.add(written.expression.name.text);
            }
          }
          ts.forEachChild(inner, look);
        };
        ts.forEachChild(node, look);
        attachedBy.set(node, { chain, fields: attached });
      }
    }
    ts.forEachChild(node, firstPass);
  };
  for (const file of sources) firstPass(file);
  // A class's form is attached where it, or a class extending it, renders `<form onsubmit={this.X.submit}>`.
  for (const { cls, fields } of ownForms) {
    const attached = new Set<string>();
    for (const { chain, fields: by } of attachedBy.values()) {
      if (chain.includes(cls)) for (const field of by) attached.add(field);
    }
    holders.push({
      component: cls.name?.text ?? "(anonymous)",
      isHook: isHookClass(cls, resolve),
      fields: [...fields],
      unattached: [...fields].filter((field) => !attached.has(field)),
      ...positionOf(cls.name ?? cls),
    });
  }

  // Where `this.props.children` sits inside one of those forms.
  const childrenPass = (node: ts.Node): void => {
    if (propRead(ts.isExpression(node) ? node : undefined) === "children" && insideAForm(node, false)) {
      const owner = enclosingClass(node);
      if (owner !== undefined) childrenInForm.add(owner);
    }
    ts.forEachChild(node, childrenPass);
  };

  /** Whether a form — or a component placing its children in one — encloses this, in the same render. */
  function insideAForm(node: ts.Node, throughChildren: boolean): boolean {
    // A project with no `@ramonda/form` form asks nothing of any ancestor.
    if (formElements.size === 0) return false;
    // Every element around it in the render that writes it — through a callback's body too,
    // `{items.map((item) => { return <input … />; })}` — up to the class member it is written in.
    for (let at = node.parent; at !== undefined && !ts.isClassElement(at); at = at.parent) {
      if (!ts.isJsxElement(at) && !ts.isJsxSelfClosingElement(at)) continue;
      if (formElements.has(at)) return true;
      if (throughChildren) {
        const opening = openingOf(at);
        const target = tagOf(at) === undefined ? readableClass(opening.tagName, resolve) : undefined;
        if (target !== undefined && childrenInForm.has(target)) return true;
      }
    }
    return false;
  }
  for (const file of sources) childrenPass(file);

  // Pass two: fields and component sites.
  const readElement = (element: ts.JsxElement | ts.JsxSelfClosingElement): void => {
    const opening = openingOf(element);
    const host = tagOf(element);
    const core = host === undefined ? coreElementTag(opening.tagName, resolve) : undefined;
    const fieldTag = host === "input" ? "input" : core;

    if (fieldTag === "input" || fieldTag === "select" || fieldTag === "textarea") {
      readField(element, fieldTag);
      return;
    }
    // A component — core's own render their children where they stand, and hold no field of theirs.
    if (host !== undefined || resolve.coreName(opening.tagName) !== undefined) return;

    const props = new Map<string, ts.Expression | undefined>();
    let spreadMayHand: Set<string> | undefined = new Set<string>();
    let spreadsOwnProps = false;
    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxSpreadAttribute(attribute)) {
        props.set(attribute.name.getText(), valueOf(attribute));
        continue;
      }
      if (isOwnProps(attribute.expression)) {
        spreadsOwnProps = true;
        continue;
      }
      const names = resolve.propertyNames(attribute.expression);
      if (names === undefined) spreadMayHand = undefined;
      for (const name of names ?? []) spreadMayHand?.add(name);
    }
    sites.push({
      owner: enclosingClass(element),
      target: readableClass(opening.tagName, resolve),
      tag: opening.tagName.getText(),
      inForm: insideAForm(element, true),
      props,
      spreadMayHand,
      spreadsOwnProps,
      ...positionOf(opening),
    });
  };

  const holdsNothing = (expression: ts.Expression): boolean => holdsNothingIn(expression, resolve);

  const readField = (element: ts.JsxElement | ts.JsxSelfClosingElement, tag: string): void => {
    const opening = openingOf(element);
    const written = new Map<string, ts.JsxAttribute>();
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxAttribute(attribute)) written.set(attribute.name.getText(), attribute);
    }
    // Written, and saying something — see `says`: as core reads it, and as every rule here does.
    const said = (name: string): boolean => says(opening, name, resolve);
    // What its `type` makes it — see `fieldKind`. One whose type cannot be read is a box when it is
    // written with `checked` — a `value` beside it is then what the box sends, as on a radio — and a
    // text field otherwise: the same reading as `field-the-user-cannot-change`.
    const kind = tag === "input" ? fieldKind(typeAttributeOf(element), resolve) : "text";
    if (kind === "unedited") return;
    const box = kind === "box" || (kind === "unread" && said("checked"));
    const pick = tag === "select" || box;

    // Every `{...this.props.P}` on a field, controlled or not: it may carry a model, or take one away.
    // A text field's own handler is `oninput` — its `change` comes on blur; a pick's is either.
    const writes = pick ? ["oninput", "onchange", "on:input", "on:change"] : ["oninput", "on:input"];
    // What the form writes on a field of this kind, under every spelling of its handler — a box's
    // `value` too, which tells a radio from the others in its group.
    const formAttributes = ["name", "value", ...(box ? ["checked"] : []), ...writes, "onblur", "aria-invalid"];
    const properties = opening.attributes.properties;
    properties.forEach((attribute, index) => {
      if (!ts.isJsxSpreadAttribute(attribute)) return;
      const prop = propRead(attribute.expression);
      if (prop === undefined) return;
      const handled = writes.some((name) => said(name));
      // What is written AFTER the spread wins over it: the spread cannot override those.
      const shadowed = properties
        .slice(index + 1)
        .filter((later): later is ts.JsxAttribute => ts.isJsxAttribute(later))
        .map((later) => later.name.getText());
      const overridable = properties
        .slice(0, index)
        .filter((earlier): earlier is ts.JsxAttribute => ts.isJsxAttribute(earlier))
        .map((earlier) => earlier.name.getText())
        .filter((name) => formAttributes.includes(name) && said(name) && !shadowed.includes(name));
      bags.push({
        owner: enclosingClass(element),
        prop,
        handled,
        pick,
        box,
        unread: kind === "unread" && !box,
        shadowed,
        overridable,
        ...positionOf(opening),
      });
    });

    const modelName = box ? "checked" : "value";
    // No model — not written, or written as nothing, through a `const` too: the field is the user's.
    if (!said(modelName)) return;

    const sourceOf = (name: string): AttributeSource => {
      const attribute = written.get(name);
      if (attribute === undefined) return { kind: "missing" };
      const value = valueOf(attribute);
      const prop = propRead(value);
      if (prop !== undefined) return { kind: "prop", prop };
      if (!said(name)) return { kind: "missing" };
      return { kind: "written" };
    };
    // `on:input` is as much the field's own as `oninput`; a spelling written as nothing is no handler.
    const spelled = (name: string) => (said(name) ? name : `on:${name.slice(2)}`);
    const writer =
      said("oninput") || said("on:input") || !pick ? sourceOf(spelled("oninput")) : sourceOf(spelled("onchange"));

    fields.push({
      owner: enclosingClass(element),
      inForm: insideAForm(element, true),
      attributes: {
        name: sourceOf("name"),
        value: sourceOf(modelName),
        oninput: writer,
        onblur: sourceOf("onblur"),
        "aria-invalid": sourceOf("aria-invalid"),
      },
      tag: tag === "select" ? "Select" : tag === "textarea" ? "TextArea" : "input",
      ...positionOf(opening),
    });
  };

  const secondPass = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) readElement(node);
    ts.forEachChild(node, secondPass);
  };
  for (const file of sources) secondPass(file);

  return { holdsNothing, fields, bags, sites, holders };
}

/**
 * Whether a spread is the schema's HTML constraints from `@ramonda/form/bguard`: `html(path)`, where
 * `html` is made by `htmlConstraints(schema)` — a `const`, or a class's field (`this.html(path)`). Those
 * carry only validation attributes — `required`, `minlength`, `maxlength`, `min`, `max`, `pattern`,
 * `step`, and a `type` of email, url, date, time or datetime-local — none a field is written with, so the
 * spread cannot take a handler away, make a field controlled, or turn a field into a number control.
 * Every rule that reads a field with a spread asks this, so none of them reads one apart.
 *
 * One step, and both halves are questions about declarations: where `html` was declared, and where
 * the function that made it was imported from.
 */
export function isConstraints(expression: ts.Expression, resolve: Resolver): boolean {
  const written = unwrap(expression);
  if (!ts.isCallExpression(written)) return false;
  const callee = written.expression;
  const name = ts.isIdentifier(callee)
    ? callee
    : ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword
      ? callee.name
      : undefined;
  if (name === undefined) return false;
  const declaration = resolve(name)?.declarations?.[0];
  if (declaration === undefined || !(ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)))
    return false;
  const made = declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
  if (made === undefined || !ts.isCallExpression(made) || !ts.isIdentifier(made.expression)) return false;
  return resolve.fromPackage(made.expression, "@ramonda/form/bguard");
}
