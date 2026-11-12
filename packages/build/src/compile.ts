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
 * namespaced tag or attribute, a `class` attribute (the runtime reports it and renames it), a `children`
 * attribute (JSX's way to give an element its children), a `key` below
 * the root, and text or an attribute holding an entity (`&amp;`), which the transform after this decodes.
 * A host element inside one of these is still compiled, as a block of its own.
 *
 * ## The source stays where it was
 *
 * Every expression the app wrote — a hole's value, a handler, a callback — keeps its place and its text;
 * only the JSX syntax around it is rewritten, and the holes are passed in the order they stand in the
 * source (the key among them). So the source map points a stack trace or a breakpoint inside a handler at
 * the line it was written on.
 */
import { parseSync } from "oxc-parser";
import MagicString from "magic-string";
import { ATTRIBUTE_OF_PROPERTY, BOOLEAN_ATTRIBUTES, svgElements } from "@ramonda/dom-facts";

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
  /** Each template's description, in the order the module numbers them. */
  templates: string[];
}

/** Compiles the JSX in one module. `undefined` when there is nothing to compile, or it does not parse. */
export function compileJsx(code: string, id: string): Compiled | undefined {
  if (!code.includes("<")) return undefined;
  const lang = id.endsWith(".tsx") ? "tsx" : id.endsWith(".jsx") ? "jsx" : undefined;
  if (lang === undefined) return undefined;
  const parsed = parseSync(id, code, { lang, sourceType: "module" });
  // The transform after this reports what does not parse, in its own words.
  if (parsed.errors.length > 0) return undefined;

  const out = new MagicString(code);
  const compiler = new Compiler(out);
  compiler.expression(parsed.program as unknown as Node);
  if (compiler.templates.length === 0) return undefined;

  const body = (parsed.program as unknown as { body: Node[] }).body;
  // After the imports and the directives, and before any code that may build a block while the module
  // loads — and never ahead of a `#!` line, which has to stay the first.
  let at = code.startsWith("#!") ? code.indexOf("\n") + 1 || code.length : 0;
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") at = statement.end;
    else if (statement.type === "ExpressionStatement" && statement.directive !== undefined && at <= statement.start) {
      at = statement.end;
    } else break;
  }
  // A `var` for each template made where first used; one made where the module is evaluated needs none.
  const names = compiler.kept.length > 0 ? `var ${compiler.kept.join(", ")};\n` : "";
  out.appendLeft(at, `\nimport { __template as ${TEMPLATE}, __block as ${BLOCK} } from "${RUNTIME}";\n${names}`);
  return {
    code: out.toString(),
    map: out.generateMap({ source: id, includeContent: true, hires: true }),
    templates: compiler.templates,
  };
}

function templateName(index: number): string {
  return `__ramondaT${index}`;
}

function isJsx(node: unknown): node is JSXElement {
  const type = (node as Node | null)?.type;
  return type === "JSXElement" || type === "JSXFragment";
}

/**
 * Code that may run more than once, or later than where it stands: a function's body — a method's, an
 * arrow's — a class's, and a loop's. JSX outside all of them runs once, as the module is evaluated.
 */
const RUNS_LATER = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassBody",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

/**
 * The JSX nodes under `root` that no other JSX node holds, in source order — each with whether it stands
 * where code runs later than `root` does (see `RUNS_LATER`).
 */
function outermostJsx(root: Node): { node: Node; later: boolean }[] {
  const found: { node: Node; later: boolean }[] = [];
  const walk = (value: unknown, later: boolean): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, later);
      return;
    }
    if (isJsx(value)) {
      found.push({ node: value, later });
      return;
    }
    const inner = later || RUNS_LATER.has((value as Node).type);
    for (const key in value as Record<string, unknown>) {
      if (key === "start" || key === "end") continue;
      walk((value as Record<string, unknown>)[key], inner);
    }
  };
  walk(root, false);
  return found.sort((a, b) => a.node.start - b.node.start);
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

/** A child as JSX means it: text (cleaned, with its source range), an expression, an element. */
type Child =
  | { kind: "text"; text: string; node: Node }
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
      children.push({ kind: "text", text, node: child });
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
    // `children` is JSX's own: the element's children, never an attribute of that name.
    if (name === undefined || name === "class" || name === "children") return false;
    if (name === "key" && !root) return false;
    // An entity in a literal is decoded by the transform after this one, as it is in text.
    const value = attribute.value as Node | null;
    if (value?.type === "Literal" && typeof value.value === "string" && value.value.includes("&")) return false;
  }
  return childrenOf(element) !== undefined;
}

/** Whether a literal attribute can be set on the template, where no rule of the attribute diff sees it. */
function bakeable(tag: string, name: string): boolean {
  if (RULED_ELEMENTS.has(tag) || RULED_NAMES.has(name) || name.startsWith("on")) return false;
  return !BOOLEAN_ATTRIBUTES.has(name.toLowerCase());
}

/**
 * What a compiled root's call is made of, in source order: text the compiler writes, and expressions the
 * app wrote, which stay where they are.
 */
type Piece = string | Node;

class Compiler {
  readonly templates: string[] = [];
  /** The names of the templates made where first used and kept in a `var` — see `later`. */
  readonly kept: string[] = [];
  private readonly out: MagicString;

  constructor(out: MagicString) {
    this.out = out;
  }

  /**
   * One JSX node: a compiled block, or JSX left for the transform after this with what is inside it
   * compiled. `inChildren` says it stands among JSX children, where a block, being an expression, goes
   * in braces.
   */
  jsx(node: Node, inChildren: boolean): void {
    if (templatable(node as JSXElement, true)) {
      this.block(node as JSXElement, inChildren);
    } else {
      this.keep(node as JSXElement);
    }
  }

  /**
   * Whether the JSX being compiled runs where code may run more than once — see `RUNS_LATER`. Outside
   * that, as the module is evaluated, a block is made once, and so is its template.
   */
  private later = false;

  /** Every JSX node inside an expression the app wrote — or the module's whole program. */
  expression(node: Node): void {
    for (const inner of outermostJsx(node)) {
      const was = this.later;
      this.later = was || inner.later;
      this.jsx(inner.node, false);
      this.later = was;
    }
  }

  /** JSX left for the transform after this, with the elements inside it compiled. */
  private keep(element: JSXElement): void {
    const attributes = element.type === "JSXElement" ? element.openingElement.attributes : [];
    for (const attribute of attributes) {
      const value = (attribute.type === "JSXSpreadAttribute" ? attribute.argument : attribute.value) as Node | null;
      if (value === null || value === undefined) continue;
      if (value.type === "JSXExpressionContainer") this.expression(value.expression as Node);
      else if (isJsx(value)) this.jsx(value, true);
      else if (value.type !== "Literal") this.expression(value);
    }
    for (const child of element.children) {
      if (child.type === "JSXExpressionContainer") this.expression(child.expression as Node);
      else if (isJsx(child)) this.jsx(child, true);
    }
  }

  /** A compiled root: `__ramondaBlock(template, [hole values in source order])`. */
  private block(element: JSXElement, braced: boolean): void {
    const holes: Piece[][] = [];
    let keyHole: number | undefined;
    const hole = (pieces: Piece[]): number => holes.push(pieces) - 1;

    const describe = (node: JSXElement, root: boolean): string => {
      const tag = hostTag(node) as string;
      const baked: string[] = [];
      const dynamic: string[] = [];
      // An attribute written twice is the last one's, as `jsx()` makes it: neither is baked, so the holes,
      // in source order, leave it the value the last one wrote. Twice by the attribute it writes — `htmlFor`
      // and `for`, `tabIndex` and `tabindex` are one — on an HTML element, which folds the name.
      const svg = svgElements.has(tag);
      const written = (name: string): string => {
        const attribute = ATTRIBUTE_OF_PROPERTY[name] ?? name;
        return svg ? attribute : attribute.toLowerCase();
      };
      const seen = new Set<string>();
      const twice = new Set<string>();
      for (const attribute of node.openingElement.attributes) {
        const name = written(attributeName(attribute) as string);
        if (seen.has(name)) twice.add(name);
        seen.add(name);
      }
      for (const attribute of node.openingElement.attributes) {
        const name = attributeName(attribute) as string;
        const value = attribute.value as Node | null;
        let pieces: Piece[];
        if (value === null) {
          pieces = ["true"];
        } else if (value.type === "Literal") {
          const text = value.value as string;
          if (name !== "key" && !twice.has(written(name)) && bakeable(tag, name)) {
            // With line breaks as HTML gives them back — a CRLF checkout's arrive as LF in a served page.
            const written = text.replace(/\r\n?/g, "\n");
            baked.push(`${JSON.stringify(ATTRIBUTE_OF_PROPERTY[name] ?? name)}: ${JSON.stringify(written)}`);
            continue;
          }
          // JSX's string, which has no escapes, as a JavaScript one.
          pieces = [JSON.stringify(text)];
        } else if (value.type === "JSXExpressionContainer") {
          const inner = value.expression as Node;
          if (inner.type === "JSXEmptyExpression") continue;
          pieces = [inner];
        } else {
          pieces = [value];
        }
        if (name === "key" && root) {
          keyHole = hole(pieces);
          continue;
        }
        dynamic.push(`[${JSON.stringify(name)}, ${hole(pieces)}]`);
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
        const described: string[] = [];
        for (const child of children) {
          if (child.kind !== "text") {
            described.push(describe((child as { node: JSXElement }).node, false));
            continue;
          }
          // Text runs side by side — split by a JSX comment — are one text node, as a server sends them.
          const last = described.length - 1;
          if (last >= 0 && described[last].startsWith('"')) {
            described[last] = JSON.stringify((JSON.parse(described[last]) as string) + child.text);
          } else {
            described.push(JSON.stringify(child.text));
          }
        }
        parts.push(`c: [${described.join(", ")}]`);
      } else if (children.length === 1 && children[0].kind === "expression") {
        parts.push(`h: ${hole([children[0].node])}`);
      } else {
        const pieces: Piece[] = ["["];
        children.forEach((child, i) => {
          if (i > 0) pieces.push(", ");
          pieces.push(child.kind === "text" ? JSON.stringify(child.text) : child.node);
        });
        pieces.push("]");
        parts.push(`k: ${hole(pieces)}`);
      }
      if (root && keyHole !== undefined) parts.push(`y: ${keyHole}`);
      return `{ ${parts.join(", ")} }`;
    };

    const description = describe(element, true);
    this.templates.push(description);
    const name = templateName(this.templates.length - 1);
    if (this.later) this.kept.push(name);

    /**
     * The call, in source order: the app's expressions stay where they are, everything else is written —
     * the braces it takes among JSX children too, as part of the call. The template is made where it is
     * first used, into a `var` the module declares: a function that builds a block can run before the
     * module's own body has (a circular import), and finds it then as it would any other day.
     */
    // Where the module is evaluated, the block is made once: its template is made right there, and both
    // calls are pure, so a bundler leaves out what nothing imports, as it does a `jsx()` call.
    const template = this.later
      ? `${name} || (${name} = ${TEMPLATE}(${description}))`
      : `/* @__PURE__ */ ${TEMPLATE}(${description})`;
    const pieces: Piece[] = [`${braced ? "{" : ""}${this.later ? "" : "/* @__PURE__ */ "}${BLOCK}(${template}, [`];
    holes.forEach((hole, i) => {
      if (i > 0) pieces.push(", ");
      pieces.push(...hole);
    });
    pieces.push(braced ? "])}" : "])");
    this.write(element.start, element.end, pieces);
  }

  /**
   * Rewrites `start`–`end` as `pieces`: each node keeps its source — with the JSX inside it compiled — and
   * the text between them replaces whatever stood there.
   */
  private write(start: number, end: number, pieces: Piece[]): void {
    let at = start;
    let text = "";
    const flush = (until: number): void => {
      if (until > at) this.out.overwrite(at, until, text);
      else if (text !== "") this.out.appendLeft(at, text);
      text = "";
    };
    for (const piece of pieces) {
      if (typeof piece === "string") {
        text += piece;
        continue;
      }
      flush(piece.start);
      if (isJsx(piece)) this.jsx(piece, false);
      else this.expression(piece);
      at = piece.end;
    }
    flush(end);
  }
}
