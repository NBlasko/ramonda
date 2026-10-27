import { UNEDITED_INPUT_TYPES } from "@ramonda/dom-facts";
import ts from "typescript";
import { positionOf } from "../syntax";
import { coreElementTag } from "./coreElements";
import { isNothing, openingOf, tagOf } from "./element";
import { unwrap } from "./follow-value";
import { enclosingElement } from "./html";
import type { Resolver, Where } from "./rule";

/**
 * The project's `@ramonda/form` forms, the fields inside them, and every place a component is used
 * inside one — collected in one pass, judged by `form-field-without-what-the-form-needs`.
 *
 * Every question here is about DECLARATIONS and source, never about types, as everywhere in this
 * package: where a field of a class was declared and what initialises it, where an identifier was
 * imported from, what attributes an element is written with. A form is recognised by exactly one
 * shape — see `ramondaFormElements` — so nothing is inferred from names or guessed through a chain.
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
  /** Whether a spread is written on the tag. */
  spreads: boolean;
}

/** A class that holds a `Form` and what became of it. */
export interface FormHolder extends Where {
  component: string;
  /** A hook holding one — `class SignupForm extends Hook { form = this.use(Form, …) }`. */
  isHook: boolean;
  /** Whether the class renders a `<form onsubmit={this.X.submit}>` for it. */
  attached: boolean;
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
  /** The attributes the field writes after the spread, which it therefore cannot override. */
  shadowed: readonly string[];
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

/** The strings a JSX attribute holds as written — see `literalsOf`. A bare attribute holds none. */
export function attributeLiterals(attribute: ts.JsxAttribute | undefined, resolve: Resolver): string[] | undefined {
  const written = attribute?.initializer;
  if (written === undefined) return undefined;
  return literalsOf(ts.isJsxExpression(written) ? written.expression : written, resolve);
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
  return typeAttribute === undefined ? "text" : kindOfLiterals(attributeLiterals(typeAttribute, resolve));
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
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && isFormHook(member.initializer, resolve)) {
      names.add(member.name.text);
    }
  }
  return names;
}

/** Whether a class extends core's `Hook`. */
function isHookClass(cls: ts.ClassLikeDeclaration, resolve: Resolver): boolean {
  for (const clause of cls.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) if (resolve.coreName(type.expression) === "Hook") return true;
  }
  return false;
}

function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isClassDeclaration(at) || ts.isClassExpression(at)) return at;
  }
  return undefined;
}

/** `this.props.P`, as written — the name, or `undefined`. */
export function propRead(expression: ts.Expression | undefined): string | undefined {
  if (expression === undefined) return undefined;
  const written = unwrap(expression);
  if (!ts.isPropertyAccessExpression(written)) return undefined;
  const object = unwrap(written.expression);
  if (!ts.isPropertyAccessExpression(object) || object.name.text !== "props") return undefined;
  return object.expression.kind === ts.SyntaxKind.ThisKeyword ? written.name.text : undefined;
}

function valueOf(attribute: ts.JsxAttribute): ts.Expression | undefined {
  const initializer = attribute.initializer;
  if (initializer === undefined) return undefined;
  if (ts.isJsxExpression(initializer)) return initializer.expression;
  return ts.isStringLiteral(initializer) ? initializer : undefined;
}

/** A component class this can read the render of: declared in source, with a body. */
function readableClass(tagName: ts.JsxTagNameExpression, resolve: Resolver): ts.ClassLikeDeclaration | undefined {
  const declared = resolve(tagName)?.declarations?.[0];
  if (declared === undefined || !(ts.isClassDeclaration(declared) || ts.isClassExpression(declared))) return undefined;
  // A `declare class` has no render, wherever it is written — the same as one from a package's `.d.ts`.
  const ambient = ts.getCombinedModifierFlags(declared as ts.Declaration) & ts.ModifierFlags.Ambient;
  return declared.getSourceFile().isDeclarationFile || ambient !== 0 ? undefined : declared;
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
  const firstPass = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const held = formFieldsOf(node, resolve);
      if (held.size > 0) {
        let attached = false;
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
              attached = true;
            }
          }
          ts.forEachChild(inner, look);
        };
        ts.forEachChild(node, look);
        holders.push({
          component: node.name?.text ?? "(anonymous)",
          isHook: isHookClass(node, resolve),
          attached,
          ...positionOf(node.name ?? node),
        });
      }
    }
    ts.forEachChild(node, firstPass);
  };
  for (const file of sources) firstPass(file);

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
    // The element that holds `node` — an expression's nearest one, or an element's own parent.
    let first: ts.Node | undefined = node.parent;
    while (first !== undefined && !ts.isJsxElement(first) && !ts.isJsxSelfClosingElement(first)) first = first.parent;
    const start = ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) ? enclosingElement(node) : first;
    for (
      let at = start as ts.JsxElement | ts.JsxSelfClosingElement | undefined;
      at !== undefined;
      at = enclosingElement(at)
    ) {
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
    let spreads = false;
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) spreads = true;
      else props.set(attribute.name.getText(), valueOf(attribute));
    }
    sites.push({
      owner: enclosingClass(element),
      target: readableClass(opening.tagName, resolve),
      tag: opening.tagName.getText(),
      inForm: insideAForm(element, true),
      props,
      spreads,
      ...positionOf(opening),
    });
  };

  // `null` or `undefined`, through a `const` that holds one: what core reads as no value.
  const holdsNothing = (expression: ts.Expression, depth = 0): boolean => {
    const value = unwrap(expression);
    if (isNothing(value)) return true;
    if (!ts.isIdentifier(value) || depth > 8) return false;
    const declared = resolve(value)?.declarations?.[0];
    if (declared === undefined || !ts.isVariableDeclaration(declared) || declared.initializer === undefined)
      return false;
    if ((ts.getCombinedNodeFlags(declared) & ts.NodeFlags.Const) === 0) return false;
    return holdsNothing(declared.initializer, depth + 1);
  };

  const readField = (element: ts.JsxElement | ts.JsxSelfClosingElement, tag: string): void => {
    const opening = openingOf(element);
    const written = new Map<string, ts.JsxAttribute>();
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxAttribute(attribute)) written.set(attribute.name.getText(), attribute);
    }
    // Written, and saying something: `{null}` and `{undefined}` are no attribute, as core reads them and
    // as `field-the-user-cannot-change` does.
    const said = (name: string): boolean => {
      const attribute = written.get(name);
      if (attribute === undefined) return false;
      const value = attribute.initializer;
      return !(
        value !== undefined &&
        ts.isJsxExpression(value) &&
        value.expression !== undefined &&
        holdsNothing(value.expression)
      );
    };
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
      bags.push({ owner: enclosingClass(element), prop, handled, pick, box, shadowed, ...positionOf(opening) });
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
