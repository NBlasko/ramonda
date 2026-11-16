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
 * attribute (JSX's way to give an element its children), a `key` below the root, an element that writes
 * one attribute twice (`for` beside `htmlFor`), a `__proto__` attribute (an object literal's prototype), a
 * `<this>` tag, text holding U+0085 or U+200B (which esbuild and Oxc clean differently), and text or an
 * attribute with an `&` in it, which may begin an entity (`&amp;`) that only the transform after this decodes.
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
import { ATTRIBUTE_OF_PROPERTY, BOOLEAN_ATTRIBUTES, attributeWrittenBy, svgElements } from "@ramonda/dom-facts";

const RUNTIME = "@ramonda/core/jsx-runtime";
const DEV_RUNTIME = "@ramonda/core/jsx-dev-runtime";
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

/** How to compile a module. */
export interface CompileOptions {
  /**
   * A development build: write where each element was written — the file once, and each element's line
   * and column — into its template, as the development JSX transform hands `jsxDEV` the place of every
   * tag, so a diagnostic can name the line (RMD020); and import the runtime from
   * `@ramonda/core/jsx-dev-runtime`, the module that transform imports and the dev server's dependency scan
   * already pre-bundles. A production bundle carries no file paths and imports `jsx-runtime`.
   */
  development?: boolean;
}

/** Compiles the JSX in one module. `undefined` when there is nothing to compile, or it does not parse. */
export function compileJsx(code: string, id: string, options: CompileOptions = {}): Compiled | undefined {
  if (!code.includes("<")) return undefined;
  const lang = id.endsWith(".tsx") ? "tsx" : id.endsWith(".jsx") ? "jsx" : undefined;
  if (lang === undefined) return undefined;
  const parsed = parseSync(id, code, { lang, sourceType: "module" });
  // The transform after this reports what does not parse, in its own words.
  if (parsed.errors.length > 0) return undefined;

  const out = new MagicString(code);
  const development = options.development === true;
  const compiler = new Compiler(out, development ? placesIn(code, id) : undefined);
  compiler.expression(parsed.program as unknown as Node);
  if (compiler.templates.length === 0) return undefined;

  const body = (parsed.program as unknown as { body: Node[] }).body;
  // After the imports and the directives, and before any code that may build a block while the module
  // loads — and never ahead of a `#!` line, which has to stay the first.
  let at = afterHashbang(code, parsed.program as unknown as { hashbang?: { end: number } | null });
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") at = statement.end;
    else if (
      statement.type === "ExpressionStatement" &&
      typeof statement.directive === "string" &&
      at <= statement.start
    ) {
      at = statement.end;
    } else break;
  }
  // A `var` for each template made where first used; one made where the module is evaluated needs none.
  const names = compiler.kept.length > 0 ? `var ${compiler.kept.join(", ")};\n` : "";
  const runtime = development ? DEV_RUNTIME : RUNTIME;
  out.appendLeft(at, `\nimport { __template as ${TEMPLATE}, __block as ${BLOCK} } from "${runtime}";\n${names}`);
  return {
    code: out.toString(),
    // A mapping per word rather than per character: a breakpoint and a stack frame land on a token either
    // way, and the map is half the size (measured on the SSR template's App.tsx: 13,414 → 6,439 bytes).
    map: out.generateMap({ source: id, includeContent: true, hires: "boundary" }),
    templates: compiler.templates,
  };
}

/** A module's file and the line and column of an offset in it, both counted from 1 as `jsxDEV`'s are. */
interface Places {
  file: string;
  at(offset: number): [number, number];
}

function placesIn(code: string, file: string): Places {
  // Every line terminator JavaScript knows, as the JSX transforms count them for `jsxDEV`: `\r\n` once, a
  // lone `\r`, `\n`, U+2028 and U+2029. Columns are UTF-16 units, as theirs are.
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c === 13 && code.charCodeAt(i + 1) === 10) continue;
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) starts.push(i + 1);
  }
  return {
    file,
    at(offset) {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle] <= offset) low = middle;
        else high = middle - 1;
      }
      return [low + 1, offset - starts[low] + 1];
    },
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

/**
 * The text JSX makes of a text child, as esbuild and Oxc make it — the transforms `jsx()` runs through, so
 * a compiled tree and an uncompiled one hold the same text: split into lines at every line terminator
 * (`\r`, `\n`, U+2028, U+2029), whitespace taken off where a line meets the next — every JavaScript
 * whitespace, a non-breaking space among them — blank lines dropped, and what is left joined by one space.
 * A tab inside a line stays a tab.
 */
function cleanText(raw: string): string | undefined {
  const lines = raw.split(/\r\n|[\n\r\u2028\u2029]/);
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i !== 0) line = line.replace(/^\s+/, "");
    if (i !== lines.length - 1) line = line.replace(/\s+$/, "");
    if (line === "") continue;
    if (text !== "") text += " ";
    text += line;
  }
  return text === "" ? undefined : text;
}

/** A host element's tag, or `undefined` for a component, a member expression or a namespaced name. */
function hostTag(element: JSXElement): string | undefined {
  if (element.type !== "JSXElement") return undefined;
  const name = element.openingElement.name;
  if (name.type !== "JSXIdentifier") return undefined;
  const tag = name.name as string;
  // `<this>` is the `this` expression to Oxc and the string "this" to esbuild: left to whichever runs.
  if (tag === "this") return undefined;
  return /^[a-z]/.test(tag) ? tag : undefined;
}

/**
 * Where a module's first line ends when it is a `#!` line, which has to stay the first: past the line
 * terminator that ends it — any JavaScript knows, `\r\n` as one — as the parser found it.
 */
function afterHashbang(code: string, program: { hashbang?: { end: number } | null }): number {
  const end = program.hashbang?.end;
  if (end === undefined) return 0;
  if (code.startsWith("\r\n", end)) return end + 2;
  return /[\n\r\u2028\u2029]/.test(code.charAt(end)) ? end + 1 : end;
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
      // Two characters the JSX transforms disagree on — Oxc trims U+0085 and U+200B where lines meet, esbuild
      // keeps them (measured over every character of the BMP; on all others they agree, and so does this
      // compiler) — so no one cleaning matches both: the element is left to whichever transform runs.
      if (/[\u0085\u200b]/.test(child.value as string)) return undefined;
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
  const written = new Set<string>();
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type !== "JSXAttribute") return false;
    const name = attributeName(attribute);
    // `children` is JSX's own: the element's children, never an attribute of that name.
    if (name === undefined || name === "class" || name === "children") return false;
    // `__proto__` in an object literal sets the prototype rather than an entry — in a template's baked
    // attributes as in the props `jsx()` is handed — so it is left to `jsx()`, where it already does that.
    if (name === "__proto__") return false;
    if (name === "key" && !root) return false;
    // One attribute written twice — `for` and `htmlFor`, `tabIndex` and `tabindex`, or a name repeated in a
    // `.jsx` file — is left to `jsx()`, which writes them as it always has: one hole per attribute is what
    // a template holds.
    const once = attributeWrittenBy(name, svgElements.has(tag));
    if (written.has(once)) return false;
    written.add(once);
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

  /** Where each element was written, in a development build — see `CompileOptions.development`. */
  private readonly places: Places | undefined;

  constructor(out: MagicString, places: Places | undefined) {
    this.out = out;
    this.places = places;
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
      for (const attribute of node.openingElement.attributes) {
        const name = attributeName(attribute) as string;
        const value = attribute.value as Node | null;
        let pieces: Piece[];
        if (value === null) {
          pieces = ["true"];
        } else if (value.type === "Literal") {
          const text = value.value as string;
          if (name !== "key" && bakeable(tag, name)) {
            // As written, a CRLF checkout's line breaks too — esbuild and Oxc keep them in the props `jsx()` is
            // handed. A served page's come back as LF; hydration's `matches` reads them as the same.
            baked.push(`${JSON.stringify(ATTRIBUTE_OF_PROPERTY[name] ?? name)}: ${JSON.stringify(text)}`);
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
      if (this.places !== undefined) {
        if (root) parts.push(`f: ${JSON.stringify(this.places.file)}`);
        const [line, column] = this.places.at(node.start);
        parts.push(`l: [${line}, ${column}]`);
      }
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
        // Text runs side by side — split by a JSX comment — are one text node, as a server sends them.
        let text: string | undefined;
        for (const child of children) {
          if (child.kind === "text") {
            text = (text ?? "") + child.text;
            continue;
          }
          if (text !== undefined) described.push(JSON.stringify(text));
          text = undefined;
          described.push(describe((child as { node: JSXElement }).node, false));
        }
        if (text !== undefined) described.push(JSON.stringify(text));
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
