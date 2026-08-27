import { Component } from "./Component";
import { createRef } from "./Ref";
import { mounted, updated } from "./decorators";
import { COMPONENT_RUNTIME } from "../core/runtime";
import { __h } from "../vdom/h";
import type { ComponentChild, RamondaNode, RenderEnv } from "../types/vdom";
import type { RefTarget } from "./Ref";

/**
 * A `<select>` is the one element whose own state is not a property of itself: it is which CHILD is
 * chosen. Nothing written on the element before its options exist can say that, and nothing written
 * on an option can say it either — `selected` is a CLAIM, and HTML settles competing claims by
 * document order, so what it means depends on the order the options reached the select. That order
 * is the diff's business. No author writes it and none can see it.
 *
 * So the choice is said once, on `<Select value={x}>`, and settled once the options are in the
 * element. `<option>` stays an ordinary tag with nothing to decide.
 *
 * The two sides settle it differently because they keep the answer in different places:
 *
 * - **The client** tells the select. `select.value = x` is a command — it competes with nothing, and
 *   no arrival order changes what it means.
 * - **The server** serializes markup, and neither the property nor the selection is serialized. So
 *   the chosen option is given the `selected` ATTRIBUTE, which is where HTML keeps it and the only
 *   half a served page can carry: the right option is showing before any script runs.
 */

/**
 * `children` as the factory's rest parameter wants it: no children at all rather than one child that
 * is `undefined`. JSX makes that distinction by writing nothing; a call has to make it by hand.
 */
function given(children: RamondaNode | undefined): ComponentChild[] {
  return children === undefined ? [] : [children as ComponentChild];
}

/**
 * Every prop except the ones this component consumes, read so its signal exists.
 *
 * The props proxy has no `ownKeys` trap — deliberately, because a signal is made per KEY as that key
 * is read, and that is what lets a component depend on exactly the props it looked at. The
 * consequence is that `{...this.props}` spreads nothing at all, so a wrapper written the obvious way
 * silently drops every attribute its caller wrote.
 *
 * The names are on `rawProps`, which is replaced just before the render that will use it, so at this
 * moment they are this render's. Reading each one back THROUGH the proxy is what makes the wrapper
 * reactive to it — so this component does depend on all of them, which is right for something whose
 * whole job is to pass them on.
 */
// biome-ignore lint/suspicious/noExplicitAny: any component, whatever its props
function forwarded(component: Component<any>, consumed: readonly string[]): Record<string, unknown> {
  const { rawProps } = component[COMPONENT_RUNTIME];
  const props = component.props as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(rawProps)) {
    if (name === "key" || consumed.includes(name)) continue;
    out[name] = props[name];
  }
  return out;
}

export interface SelectProps {
  /**
   * Anything a `<select>` takes, passed straight through.
   *
   * Spelled out rather than reached for through `RamondaArgs`, because that type is a Partial over a
   * UNION and `Omit` across a union keeps only the keys every member shares — which throws away the
   * index signature that carries `id`, `disabled`, `data-*` and `aria-*`. Same latitude as the tag
   * itself: `RamondaArgs` puts the same signature in the same place.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the same latitude the tag's own type gives
  [attribute: Lowercase<string>]: any;
  /** Which option is showing. An array for a `multiple` select, which holds more than one. */
  value: string | number | readonly (string | number)[];
  children?: RamondaNode;
  className?: string;
  key?: string | number;
  ref?: RefTarget<HTMLSelectElement>;
}

export class Select extends Component<SelectProps> {
  private el = createRef<HTMLSelectElement>();

  /**
   * After the options, which is the only moment the answer exists — and on BOTH sides.
   *
   * `env: "shared"` because a mount is not a client-only thing here: measured on a served page, the
   * ref is set and `select.options` already holds every option by the time this runs. That is what
   * lets one method answer for both, rather than the render queueing work for the server behind a
   * branch — a render that reaches outside itself is a side effect, whatever it queues.
   *
   * `@updated` as well, and it matters that it fires for a render that changed only the CHILDREN:
   * putting an option into a live select makes HTML settle the choice again from what it can see, so
   * a render that merely adds one can move the selection while the value stood still. It is
   * client-only, which is right: the server renders once and has no update to follow.
   */
  @mounted({ env: "shared" })
  @updated
  settle(env: RenderEnv = "client"): void {
    const select = this.el.current;
    if (!select) return;

    const onServer = env === "server";
    const chosen = this.props.value;

    // One write, and the browser works out which option it means. A `multiple` select has no single
    // value to write, and the server cannot write a property at all, so both answer per option.
    if (!onServer && !Array.isArray(chosen)) {
      select.value = String(chosen);
      return;
    }

    const wanted = Array.isArray(chosen) ? new Set(chosen.map(String)) : undefined;
    const only = wanted === undefined ? String(chosen) : "";
    const options = select.options;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const on = wanted === undefined ? option.value === only : wanted.has(option.value);
      option.selected = on;
      if (!onServer) continue;
      if (on) option.setAttribute("selected", "");
      else option.removeAttribute("selected");
    }
  }

  render() {
    /**
     * Built through the factory rather than written as JSX, because `<select>` is refused and JSX
     * would need a `@ts-expect-error` to get past its own types. `__h` takes the name as a value, so
     * there is nothing to suppress: the refusal keeps meaning exactly what it says at every call
     * site that writes the tag, and this one does not write it.
     */
    return __h("select", { ref: this.el, ...forwarded(this, ["value", "children"]) }, ...given(this.props.children));
  }
}
