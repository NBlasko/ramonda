import { diagnose } from "../debug/diagnostics";
import { CSS_SYM } from "../helpers/constants";
import type { CssBlockValue } from "../types/cssBlock";
import type { EnhancedHTMLNode } from "../types/vdom";

/**
 * Applies a compiled style block to one element: the custom properties half.
 *
 * The class half is not here. It is merged into `className` by `formatAttributes`, so it travels the
 * ordinary attribute path — which is what makes it diff, hydrate and read back correctly on an SVG
 * element with no second rule for any of it.
 *
 * ## Why `setProperty` rather than the style string
 *
 * A hole's value is whatever the author's expression evaluated to, and an expression can read a
 * record — so "the author wrote it" is not a defence. Measured in this repository's harness, the
 * same hostile value both ways:
 *
 *     style.cssText = `--r-0: ${value}`   ->  position: fixed, width: 100vw — real, applied
 *     style.setProperty("--r-0", value)   ->  position: "", width: "" — nothing else exists
 *
 * A full-viewport fixed overlay out of a colour that came from a database. `setProperty` writes ONE
 * declaration whatever it is handed, which closes it on the client.
 *
 * **It does not close it on the server, and that had to be measured to be found.** A server render
 * does not end at the DOM: the element is serialized to HTML and the browser PARSES the style
 * attribute back, and a parse applies the CSS grammar to whatever text the serializer produced. Run
 * through `renderToString` and back through `innerHTML`, the same value came out as
 * `position: fixed; width: 100vw; z-index: 9999` — real, applied declarations, on a page the client
 * guarantee never touched. See `__tests__/hydration/CssBlockSsr.test.tsx`.
 *
 * So the value is checked here instead of relying on the DOM to refuse it, which only one of the two
 * paths does. {@link holdsOneDeclaration} is the whole of it.
 *
 * ## Why it runs after the attribute loop rather than inside it
 *
 * `css` is not a DOM attribute, so it is never among the attributes read back off the node — the
 * same position `ref` is in, and it is handled the same way, in one call per element that both
 * writes and releases. Inside the loop, a block that DISAPPEARED would be invisible: the loop walks
 * the keys the render produced, and a key that is gone is not one of them.
 */
export function applyCssBlock(enhancedNode: EnhancedHTMLNode, next: CssBlockValue | undefined | null): void {
  const written = enhancedNode[CSS_SYM];
  if (written === undefined && (next === undefined || next === null)) return;

  const usable = next == null || isCompiledBlock(next);
  if (__DEV__ && next != null && !usable) reportNotABlock(next);
  const names = next == null || !usable ? EMPTY : next.properties;

  /**
   * Everything this element carried last time and does not now.
   *
   * Without it a block that is swapped for another, or dropped, leaves its properties behind — set
   * on the element, referenced by no rule, and invisible to every diff because they were never
   * attributes the render produced.
   */
  if (written !== undefined) {
    for (const name of written) {
      if (!names.includes(name)) enhancedNode.style.removeProperty(name);
    }
  }

  if (next == null || !usable) {
    enhancedNode[CSS_SYM] = undefined;
    return;
  }

  /**
   * A hole with no value, which is what an UNCALLED descriptor is.
   *
   * `block(className, properties)` returns a callable carrying `values: []`, so `css={_s0}` where
   * `_s0(…)` was meant has every property name and no value for any of them. The transform never
   * writes that — it comes from hand-written code or from a wrapper — and measured, the element then
   * renders with the class and no custom properties at all: every declaration in the rule that reads
   * one falls back, and nothing says so.
   */
  if (__DEV__ && names.length > next.values.length) {
    diagnose(
      "RMD062",
      next.className,
      `\`${next.className}\` was applied with ${next.values.length} value(s) for ${names.length} ` +
        `hole(s), so ${names.slice(next.values.length).join(", ")} ${names.length - next.values.length === 1 ? "is" : "are"} ` +
        `not set on the element and every declaration reading ${names.length - next.values.length === 1 ? "it" : "them"} falls back.`,
      { className: next.className, properties: names, values: next.values },
    );
  }

  for (let index = 0; index < names.length; index++) {
    const value = next.values[index];

    /**
     * A value that would not be one declaration is not written at all.
     *
     * The declaration then has no value, so it is dropped and the element is left unstyled in that
     * one respect — visible, and the right way round: a missing border beats a full-viewport overlay
     * somebody's record asked for. Saying so out loud is the runtime diagnostic, which `PLAN.md`
     * puts last so it is written against a feature that has stopped moving.
     */
    if (typeof value === "string" && !holdsOneDeclaration(value)) {
      if (__DEV__) {
        diagnose(
          "RMD063",
          `${next.className}:${names[index]}`,
          `${names[index]} was not set: its value holds a \`;\`, which would be a second declaration ` +
            `rather than a value. The declaration is dropped instead.`,
          { className: next.className, property: names[index], value },
        );
      }
      enhancedNode.style.removeProperty(names[index]);
      continue;
    }
    /**
     * A property name with no value beside it. The types refuse it, so what reaches here is a
     * descriptor read without being called — `css={_s0}` where `_s0(…)` was meant, on a block that
     * has holes.
     *
     * Removed rather than written as the text `"undefined"`, which is a value CSS would keep and
     * nothing could see through. Saying so out loud is the runtime diagnostic, which is written
     * against a feature that has stopped moving — see `packages/css/PLAN.md`.
     */
    if (value === undefined || value === null) {
      enhancedNode.style.removeProperty(names[index]);
      continue;
    }
    enhancedNode.style.setProperty(names[index], typeof value === "string" ? value : String(value));
  }

  enhancedNode[CSS_SYM] = names;
}

/** Shared, so an element that drops its block allocates nothing to say so. */
const EMPTY: readonly string[] = [];

/**
 * Whether a `css` value is the shape a compiler produced.
 *
 * The types refuse everything else, so what reaches here came from JavaScript that was not checked —
 * a hand-written object, another library's own shape. **Measured before this existed: it did not do
 * nothing, it THREW** — `Cannot read properties of undefined (reading 'length')`, which takes the
 * render down and names nothing about `css`.
 *
 * Reported and skipped instead. An unstyled element beats a blank page, and the report is what says
 * which of the two happened.
 */
export function isCompiledBlock(value: CssBlockValue): boolean {
  return typeof value.className === "string" && Array.isArray(value.properties) && Array.isArray(value.values);
}

/**
 * The report for one that is not, raised where the value is APPLIED and nowhere else.
 *
 * `formatAttributes` asks the same question to decide whether to merge the class, and two reports for
 * one element would read as two faults.
 */
function reportNotABlock(value: CssBlockValue): void {
  diagnose(
    "RMD064",
    String((value as { className?: unknown }).className ?? typeof value),
    `\`css\` was given a value that is not a compiled style block, so it was ignored: a block has a ` +
      `\`className\` and a \`properties\` and \`values\` array beside it, and this has ${describe(value)}.`,
    { value },
  );
}

/** What the value actually is, for a message that has to be read once and acted on. */
function describe(value: CssBlockValue): string {
  const parts: string[] = [];
  if (value === null || typeof value !== "object") return `${typeof value} instead of an object`;
  if (typeof value.className !== "string") parts.push(`\`className\` as ${typeof value.className}`);
  if (!Array.isArray(value.properties)) parts.push(`\`properties\` as ${typeof value.properties}`);
  if (!Array.isArray(value.values)) parts.push(`\`values\` as ${typeof value.values}`);
  return parts.join(", ");
}

/**
 * Whether a hole's value is one custom property value and cannot become a second declaration.
 *
 * A semicolon is what separates declarations in a style attribute, and CSS says a custom property's
 * value may not contain one at the top level. Refusing every semicolon rather than only the top-level
 * ones costs a value like `content: "a;b"`, which no compiled hole has yet had, and buys a rule that
 * needs no CSS parser to apply — on the server, where there is no engine to refuse it for us.
 */
function holdsOneDeclaration(value: string): boolean {
  return !value.includes(";");
}

/**
 * The element's class with the block's own in front of it.
 *
 * Order is presentation only — a class attribute's order decides nothing in CSS, the stylesheet's
 * does — so the generated name leads and whatever the author wrote follows, which is how the pair
 * reads in the markup.
 *
 * Merged into `className` rather than written separately because two writers of one attribute is a
 * race decided by object key order. One writer, and the block's class is an ordinary class from
 * there on.
 */
export function classNameWithBlock(className: unknown, block: CssBlockValue): string {
  return className === undefined || className === null || className === ""
    ? block.className
    : `${block.className} ${className}`;
}
