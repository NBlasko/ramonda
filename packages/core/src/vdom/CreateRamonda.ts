import { COMPONENT_TYPE, TEXT_TYPE, ORIGIN_SYM } from "../helpers/constants";
import { currentOrigin } from "../core/origin";
import { diagnose } from "../debug/diagnostics";
import { renderingOwner } from "../debug/renderPhase";
import type { ComponentKind, VNode, VNodeComponent, VNodeString } from "../types/vdom";

/**
 * Ramonda uses `className` everywhere. Normalizing here means once per vnode
 * rather than on every attribute diff of every element — `formatAttributes` runs
 * in the hot path and had to check for `class` on every element, every render,
 * and allocate a fresh attributes object whenever it found one.
 */
/**
 * `class` → `className`, on a COPY.
 *
 * The same rule as the children copy below, and for the same measured reason:
 * writing on the caller's object meant one attributes bag used for two elements
 * came back rewritten. JSX builds a fresh object per element so the compiler never
 * shows it, but `__h` is public and callable. Deleting `class` also swallowed the
 * warning for every later use of that object — the warning is about the SOURCE,
 * and the source still says `class`.
 *
 * The copy costs an allocation only on the path that is already the wrong
 * spelling; correct attributes are handed straight back.
 */
function normalizeClassName(name: ComponentKind, attributes: Record<string, any>): Record<string, any> {
  if (!("class" in attributes)) return attributes;

  if (__DEV__) {
    /**
     * Three outcomes, and the report says which — because the rename below means the common one is
     * not a broken page, and a diagnostic that claims otherwise is a report on working code.
     * Measured, all three: `<p class="lead">` renders `class="lead"` and is styled; the same
     * element with `className` beside it keeps the `className` and loses this; and a COMPONENT
     * receives `className` too, so a `class` prop it declared reads `undefined` for ever.
     */
    // Keyed by the component and the tag, not by the word `class`: one report per SITE. A key of
    // `"class"` would report the first of these in an application and none of the rest, for a
    // mistake people make in every file they convert.
    const isHost = typeof name === "string";
    const tag = isHost ? name : (name.name ?? "a component");
    const owner = renderingOwner();
    const dropped = attributes.className !== undefined;
    const what = dropped
      ? `\`className\` is there as well, so it wins and this \`class\` is dropped.`
      : isHost
        ? `It is renamed to \`className\`, so the element is styled — write \`className\` and the source says what the element gets.`
        : `It is renamed to \`className\` before <${tag}> is constructed, so a \`class\` prop it declared reads \`undefined\`; the value arrives as \`className\`.`;
    diagnose(
      "RMD039",
      `${owner}:${tag}${dropped ? ":dropped" : ""}`,
      `\`class\` was given on <${tag}>, from ${owner}. ${what}`,
      {
        tag,
        owner,
        dropped,
      },
    );
  }

  const { class: fromClass, ...rest } = attributes;
  if (rest.className === undefined) rest.className = fromClass;
  return rest;
}

/**
 * A `<textarea>`'s value is its CHILD, so it is written as one before the diff ever sees it.
 *
 * There is no `value` content attribute on a textarea. A served `<textarea value="hello">` reaches
 * the reader as an empty field and fills itself in when the bundle arrives — measured, `.value` of
 * `""` on the parsed markup.
 *
 * Written HERE rather than in the attribute pass, and that is the whole point. The attribute pass
 * runs before the children, so a text node it adds is one the children pass does not know about, and
 * unmounts as a leftover: measured, `"hello"` at the moment of writing and `<textarea></textarea>`
 * in the finished markup. A vnode child is CLAIMED instead, by the pass that would otherwise have
 * dropped it — which is also what makes it diff and hydrate like any other text.
 *
 * On both sides, because the two must produce the same tree or hydration reports a mismatch. On the
 * client this is the DEFAULT value, which the property write in `Attribute.ts` immediately overrides
 * and which stops driving the field the moment somebody types in it — so it costs a text node and
 * changes nothing about what the reader sees.
 *
 * Written children win. `<textarea value={x}>text</textarea>` says two things, and the one the
 * author put inside the element is the one HTML would have kept.
 *
 * `TEXTAREA`, upper case, because that is the name a tag arrives with: `__h` upper-cases every HTML
 * tag before it gets here, and SVG — which is case-sensitive and passes its names through verbatim —
 * has no textarea.
 */
function textareaChildren(attributes: Record<string, any>, children: unknown[]): unknown[] {
  if (children.length > 0) return children;
  const value = attributes.value;
  return value === undefined || value === null ? children : [String(value)];
}

export function createRamonda(
  name: ComponentKind,
  rawAttributes: Record<string, any>,
  children: unknown[] = [],
): VNode {
  const attributes = normalizeClassName(name, rawAttributes);

  if (typeof name === "string") {
    const stringNode: VNodeString = {
      type: TEXT_TYPE,
      name,
      attributes,
      children: name === "TEXTAREA" ? textareaChildren(attributes, children) : children,
      [ORIGIN_SYM]: currentOrigin.id,
    };

    return stringNode;
  }

  // A COPY, not a mutation. Writing `children` onto the caller's object meant a
  // props object used for two elements ended up with only the last one's
  // children — both then rendered the same content. JSX builds a fresh object
  // per element so it never showed there, but `h()` is public and callable
  // directly, and a reused props object is a reasonable thing to write.
  // Measured "twotwo" where "onetwo" was meant.
  const componentNode: VNodeComponent = {
    type: COMPONENT_TYPE,
    name,
    attributes: children.length ? { ...attributes, children } : attributes,
    [ORIGIN_SYM]: currentOrigin.id,
  };

  return componentNode;
}
