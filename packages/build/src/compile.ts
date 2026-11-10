/**
 * The JSX compiler: an element tree whose shape never changes becomes a TEMPLATE, built once, and per
 * render only the values of its holes — what `@ramonda/core`'s `__template` and `__block` take (see
 * `core/block.ts` there). `render()` and the JSX in an app are unchanged; this rewrites what the JSX
 * becomes, before the transform that compiles the rest of it to `jsx()` calls.
 *
 * ## What is compiled
 *
 * A JSX element whose tag is a host element (`<div>`, `<svg>`, `<my-widget>`) is the root of a block. Its
 * attributes and children become the template, except:
 *
 * - an attribute that is an expression, or a literal some rule of the attribute diff looks at (`value`,
 *   `checked`, `style`, `ref`, a listener, a boolean attribute, anything on a form or media element) — a
 *   hole, written through those rules;
 * - an element's one `{…}` child — a hole that holds text or markup;
 * - children that mix text, `{…}`, components or fragments — one hole for all of them, diffed as children;
 * - a `key` — the block's own, on the root only.
 *
 * ## What is left as it is, for the transform after this
 *
 * A component, a fragment, an element with a spread (`{...props}`, whose attributes are not known here), a
 * namespaced tag or attribute, a `class` attribute (the runtime reports it and renames it), a `key` below
 * the root, and text holding an entity (`&amp;`), which the transform after this decodes. A host element
 * inside one of these is still compiled, as a block of its own.
 */
import { parseSync } from "oxc-parser";
import MagicString from "magic-string";
import { BOOLEAN_ATTRIBUTES } from "@ramonda/dom-facts";

const RUNTIME = "@ramonda/core/jsx-runtime";
const TEMPLATE = "__ramondaTemplate";
const BLOCK = "__ramondaBlock";

/**
 * Elements whose attributes all go through the attribute diff: a field's rules, a media element's. Holds
 * every element of `@ramonda/dom-facts`' property-only table (`keptInAProperty`), whose names have no
 * attribute to set.
 */
const RULED_ELEMENTS = new Set(["input", "textarea", "select", "option", "video", "audio"]);

/** Names the attribute diff treats as more than a string to set. */
const RULED_NAMES = new Set([
  "key",
  "ref",
  "style",
  "value",
  "checked",
  "selected",
  "muted",
  "indeterminate",
  "defaultValue",
  "defaultChecked",
]);

/** The DOM's name for an attribute JSX spells as the property. */
const ATTRIBUTE_NAME: Record<string, string> = { className: "class", htmlFor: "for" };

// The node shapes this reads, as `oxc-parser` hands them over (ESTree, with `start` / `end` offsets).
interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
interface JSXElement extends Node {
  openingElement: { name: Node; attributes: Node[] };
  children: Node[];
}

export interface Compiled {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
}

/** Compiles the JSX in one module. `undefined` when there is nothing to compile, or it does not parse. */
export function compileJsx(code: string, id: string): Compiled | undefined {
  if (!code.includes("<")) return undefined;
  const lang = id.endsWith(".tsx") ? "tsx" : id.endsWith(".jsx") ? "jsx" : undefined;
  if (lang === undefined) return undefined;
  const parsed = parseSync(id, code, { lang, sourceType: "module" });
  // The transform after this reports what does not parse, in its own words.
  if (parsed.errors.length > 0) return undefined;

  const compiler = new Compiler(code);
  const out = new MagicString(code);
  for (const node of outermostJsx(parsed.program as unknown as Node)) {
    const emitted = compiler.emit(node);
    if (emitted !== code.slice(node.start, node.end)) out.overwrite(node.start, node.end, emitted);
  }
  if (compiler.templates.length === 0) return undefined;

  const body = (parsed.program as unknown as { body: Node[] }).body;
  // After the imports, and before any code that may build a block while the module loads.
  let at = 0;
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") at = statement.end;
    else if (at === 0 && statement.type === "ExpressionStatement" && statement.directive !== undefined) {
      at = statement.end;
    } else break;
  }
  const head =
    `\nimport { __template as ${TEMPLATE}, __block as ${BLOCK} } from "${RUNTIME}";\n` +
    compiler.templates.map((t, i) => `const ${templateName(i)} = /* @__PURE__ */ ${TEMPLATE}(${t});\n`).join("");
  out.appendLeft(at, head);
  return { code: out.toString(), map: out.generateMap({ source: id, includeContent: true, hires: true }) };
}

function templateName(index: number): string {
  return `__ramondaT${index}`;
}

function isJsx(node: unknown): node is JSXElement {
  const type = (node as Node | null)?.type;
  return type === "JSXElement" || type === "JSXFragment";
}

/** The JSX nodes under `root` that no other JSX node holds, in source order. */
function outermostJsx(root: Node): Node[] {
  const found: Node[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (isJsx(value)) {
      found.push(value);
      return;
    }
    for (const key in value as Record<string, unknown>) {
      if (key === "start" || key === "end") continue;
      walk((value as Record<string, unknown>)[key]);
    }
  };
  walk(root);
  return found.sort((a, b) => a.start - b.start);
}

/** The text JSX makes of a text child: lines trimmed where they meet, blank lines gone. */
function cleanText(raw: string): string | undefined {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i;
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, " ");
    if (i !== 0) line = line.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, "");
    if (line) {
      if (i !== last) line += " ";
      text += line;
    }
  }
  return text === "" ? undefined : text;
}

/** A host element's tag, or `undefined` for a component, a member expression or a namespaced name. */
function hostTag(element: JSXElement): string | undefined {
  if (element.type !== "JSXElement") return undefined;
  const name = element.openingElement.name;
  if (name.type !== "JSXIdentifier") return undefined;
  const tag = name.name as string;
  return /^[a-z]/.test(tag) ? tag : undefined;
}

function attributeName(attribute: Node): string | undefined {
  const name = attribute.name as Node;
  return name.type === "JSXIdentifier" ? (name.name as string) : undefined;
}

/** A child as JSX means it: text (cleaned), an expression, an element — or nothing (blank, a comment). */
type Child =
  | { kind: "text"; text: string }
  | { kind: "expression"; node: Node }
  | { kind: "element"; node: JSXElement };

function childrenOf(element: JSXElement): Child[] | undefined {
  const children: Child[] = [];
  for (const child of element.children) {
    if (child.type === "JSXText") {
      const text = cleanText(child.value as string);
      if (text === undefined) continue;
      // An entity is decoded by the transform after this one; this one leaves the element to it.
      if (text.includes("&")) return undefined;
      children.push({ kind: "text", text });
    } else if (child.type === "JSXExpressionContainer") {
      const expression = child.expression as Node;
      if (expression.type === "JSXEmptyExpression") continue;
      children.push({ kind: "expression", node: expression });
    } else if (child.type === "JSXElement" || child.type === "JSXFragment") {
      children.push({ kind: "element", node: child as JSXElement });
    } else {
      return undefined;
    }
  }
  return children;
}

/** Whether `element` can be in a template — as the root, or as a child of a templated element. */
function templatable(element: JSXElement, root: boolean): boolean {
  const tag = hostTag(element);
  if (tag === undefined) return false;
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type !== "JSXAttribute") return false;
    const name = attributeName(attribute);
    if (name === undefined || name === "class") return false;
    if (name === "key" && !root) return false;
  }
  return childrenOf(element) !== undefined;
}

/** Whether a literal attribute can be set on the template, where no rule of the attribute diff sees it. */
function bakeable(tag: string, name: string): boolean {
  if (RULED_ELEMENTS.has(tag) || RULED_NAMES.has(name) || name.startsWith("on")) return false;
  return !BOOLEAN_ATTRIBUTES.has(name.toLowerCase());
}

class Compiler {
  readonly templates: string[] = [];
  private readonly code: string;
  constructor(code: string) {
    this.code = code;
  }

  /** The code for `node`, with every JSX inside it compiled. */
  emit(node: Node): string {
    if (isJsx(node)) {
      return templatable(node as JSXElement, true) ? this.block(node as JSXElement) : this.keep(node as JSXElement);
    }
    return this.splice(node.start, node.end, outermostJsx(node));
  }

  /** The source between `start` and `end`, each node in `inner` replaced by what `emit` makes of it. */
  private splice(start: number, end: number, inner: Node[], wrap = false): string {
    let text = "";
    let at = start;
    for (const node of inner) {
      text += this.code.slice(at, node.start);
      const emitted = this.emit(node);
      text += wrap && emitted !== this.code.slice(node.start, node.end) ? `{${emitted}}` : emitted;
      at = node.end;
    }
    return text + this.code.slice(at, end);
  }

  /** JSX left for the transform after this, with the elements inside it compiled. */
  private keep(element: JSXElement): string {
    const replaced: { start: number; end: number; text: string }[] = [];
    const attributes = element.type === "JSXElement" ? element.openingElement.attributes : [];
    for (const attribute of attributes) {
      const value = (attribute.type === "JSXSpreadAttribute" ? attribute.argument : attribute.value) as Node | null;
      if (value === null || value === undefined) continue;
      const inner = value.type === "JSXExpressionContainer" ? (value.expression as Node) : value;
      if (inner.type === "JSXEmptyExpression" || inner.type === "Literal") continue;
      const emitted = this.emit(inner);
      if (emitted !== this.code.slice(inner.start, inner.end)) {
        replaced.push({ start: inner.start, end: inner.end, text: inner === value ? `{${emitted}}` : emitted });
      }
    }
    for (const child of element.children) {
      if (child.type === "JSXExpressionContainer") {
        const expression = child.expression as Node;
        if (expression.type === "JSXEmptyExpression") continue;
        const emitted = this.emit(expression);
        if (emitted !== this.code.slice(expression.start, expression.end)) {
          replaced.push({ start: expression.start, end: expression.end, text: emitted });
        }
      } else if (isJsx(child)) {
        const emitted = this.emit(child);
        if (emitted !== this.code.slice(child.start, child.end)) {
          // A compiled child is an expression, which JSX takes in braces.
          const text = templatable(child as JSXElement, true) ? `{${emitted}}` : emitted;
          replaced.push({ start: child.start, end: child.end, text });
        }
      }
    }
    let text = "";
    let at = element.start;
    for (const r of replaced.sort((a, b) => a.start - b.start)) {
      text += this.code.slice(at, r.start) + r.text;
      at = r.end;
    }
    return text + this.code.slice(at, element.end);
  }

  /** A compiled root: `__ramondaBlock(template, [hole values], key)`. */
  private block(element: JSXElement): string {
    const holes: string[] = [];
    let key: string | undefined;
    const describe = (node: JSXElement, root: boolean): string => {
      const tag = hostTag(node) as string;
      const baked: string[] = [];
      const dynamic: string[] = [];
      for (const attribute of node.openingElement.attributes) {
        const name = attributeName(attribute) as string;
        const value = attribute.value as Node | null;
        let expression: string;
        if (value === null) {
          expression = "true";
        } else if (value.type === "Literal") {
          if (name !== "key" && typeof value.value === "string" && bakeable(tag, name)) {
            baked.push(`${JSON.stringify(ATTRIBUTE_NAME[name] ?? name)}: ${JSON.stringify(value.value)}`);
            continue;
          }
          expression = this.code.slice(value.start, value.end);
        } else if (value.type === "JSXExpressionContainer") {
          const inner = value.expression as Node;
          if (inner.type === "JSXEmptyExpression") continue;
          expression = this.emit(inner);
        } else {
          expression = this.emit(value);
        }
        if (name === "key" && root) {
          key = expression;
          continue;
        }
        holes.push(expression);
        dynamic.push(`[${JSON.stringify(name)}, ${holes.length - 1}]`);
      }
      const parts = [`t: ${JSON.stringify(tag)}`];
      if (baked.length > 0) parts.push(`a: { ${baked.join(", ")} }`);
      if (dynamic.length > 0) parts.push(`d: [${dynamic.join(", ")}]`);

      const children = childrenOf(node) as Child[];
      const fixed = children.every(
        (child) => child.kind === "text" || (child.kind === "element" && templatable(child.node, false)),
      );
      if (children.length === 0) {
        // nothing
      } else if (fixed) {
        const described = children.map((child) =>
          child.kind === "text" ? JSON.stringify(child.text) : describe((child as { node: JSXElement }).node, false),
        );
        parts.push(`c: [${described.join(", ")}]`);
      } else if (children.length === 1 && children[0].kind === "expression") {
        holes.push(this.emit(children[0].node));
        parts.push(`h: ${holes.length - 1}`);
      } else {
        const values = children.map((child) =>
          child.kind === "text" ? JSON.stringify(child.text) : this.emit(child.node),
        );
        holes.push(`[${values.join(", ")}]`);
        parts.push(`k: ${holes.length - 1}`);
      }
      return `{ ${parts.join(", ")} }`;
    };
    const description = describe(element, true);
    this.templates.push(description);
    const name = templateName(this.templates.length - 1);
    return `${BLOCK}(${name}, [${holes.join(", ")}]${key === undefined ? "" : `, ${key}`})`;
  }
}
