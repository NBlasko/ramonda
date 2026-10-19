import { Component } from "./Component";
import { createRef } from "./Ref";
import { mounted, updated } from "./decorators";
import { __h } from "../vdom/h";
import { answer, controlled, forwarded, given, heard, settlesLater } from "./forwarded";
import type { RamondaNode, RenderEnv } from "../types/vdom";
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
 *
 * A `defaultValue` is the attribute on both sides, because the attribute is what HTML calls the
 * default: a form's reset returns to it.
 */

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
  /**
   * Which option is showing, held by the model: after every pick the select shows this again, so a
   * handler that does not move it undoes the pick. An array for a `multiple` select.
   */
  value?: string | number | readonly (string | number)[];
  /**
   * Which option shows FIRST, after which the select is the user's: it is never put back. For a
   * select whose choice is read when the form is sent rather than held in state. Not with `value`.
   */
  defaultValue?: string | number | readonly (string | number)[];
  children?: RamondaNode;
  className?: string;
  key?: string | number;
  ref?: RefTarget<HTMLSelectElement>;
}

export class Select extends Component<SelectProps> {
  /**
   * `e` — the `<select>` this component owns. Its ref is this component's, always, and the caller's
   * is handed the same node.
   *
   * One element takes one `ref`, so a caller who writes `<Select ref={mine}>` cannot simply have it
   * forwarded onto the tag: whichever of the two is written last wins, and if the caller's wins this
   * component never sees its own element. `settle` then returns on its first line and the choice is
   * never applied — silently, because a select with no answer still shows an option. Measured with
   * `b` asked for out of `a b c`: the page showed `c`, and the served markup carried no `selected`
   * at all.
   */
  private e = createRef<HTMLSelectElement>((node) => this.g(node));

  /**
   * `d` — whether the start is settled for good: the user has picked, or a `value` has held the select.
   * Until then a `defaultValue` is where it starts, applied whenever an option it names is there.
   */
  private d = false;

  /** `h` — the caller's ref as of the last HAND-OVER, so a swapped one can be let go of. */
  private h: RefTarget<HTMLSelectElement> | undefined;

  /**
   * `g` — GIVES the caller's ref the node, and takes it back from one the caller has dropped.
   *
   * The release half is the rule `releaseDroppedRef` enforces for an element: a ref must not outlive
   * the node it points at, or `current` reads as present while `focus()` does nothing. The framework
   * cannot do it here, because as far as it can see the ref on this element never changes.
   */
  private g(node: HTMLSelectElement | null): void {
    const theirs = this.props.ref;
    if (this.h !== undefined && this.h !== theirs) this.h.setCurrent(null);
    this.h = theirs;
    theirs?.setCurrent(node);
  }

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
    const select = this.e.current;
    if (!select) return;

    // A caller may hand over a DIFFERENT ref between renders, and the element's own ref did not
    // change, so nothing else would notice. This is the one moment that can.
    if (this.h !== this.props.ref) this.g(select);

    const onServer = env === "server";
    const chosen = this.props.value;
    if (chosen == null) {
      if (!this.d && this.props.defaultValue != null) this.start(select, this.props.defaultValue);
      return;
    }
    this.d = true;
    // Not in the middle of a pick's event, while the model stands where it found it — see `settlesLater`.
    if (!onServer && settlesLater(this)) return;

    // One write, and the browser works out which option it means. A `multiple` select has no single
    // value to write, and the server cannot write a property at all, so both answer per option.
    if (!onServer && !Array.isArray(chosen)) {
      select.value = String(chosen);
      return;
    }

    const wanted = wantedOf(chosen);
    const options = select.options;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const on = wanted.has(option.value);
      option.selected = on;
      if (onServer) markDefault(option, on);
    }
  }

  /**
   * A `defaultValue` is where the select starts until the user picks — so options that arrive later,
   * after a "Choose…" that was there first, still start on the saved choice, and one that arrives
   * after a pick changes nothing. It is written only once an option it names is there; before, the
   * browser would show no choice at all.
   *
   * It is written where HTML keeps a default, the `selected` ATTRIBUTE, on both sides: so a form's
   * reset returns to it, as a `TextArea`'s does to its text. `select.value` would show it and leave
   * the form believing the first option is the default. Only an option whose attribute says
   * otherwise is written.
   */
  private start(select: HTMLSelectElement, chosen: string | number | readonly (string | number)[]): void {
    const wanted = wantedOf(chosen);
    const options = select.options;
    let named = false;
    for (let i = 0; i < options.length && !named; i++) named = wanted.has(options[i].value);
    if (!named) return;
    for (let i = 0; i < options.length; i++) markDefault(options[i], wanted.has(options[i].value));
  }

  /** The listener a controlled select answers its events with — see `answer` in `forwarded.ts`. */
  a(event: Event): void {
    answer(this, event);
  }

  /** The listener a `defaultValue` select notes the user's pick with: from then on it is theirs. */
  p(event: Event): void {
    this.d = true;
    heard(this, event);
  }

  render() {
    /**
     * Built through the factory rather than written as JSX, because `<select>` is refused and JSX
     * would need a `@ts-expect-error` to get past its own types. `__h` takes the name as a value, so
     * there is nothing to suppress: the refusal keeps meaning exactly what it says at every call
     * site that writes the tag, and this one does not write it.
     */
    // A pick is `input` then `change`, both at once: either is the moment to answer.
    // Without a `value` the select is the user's, and a pick is noted — a `defaultValue` may yet
    // arrive, and must not move a select somebody has already picked in.
    const field = controlled(this, this.a, ["oninput", "onchange"], this.p);
    return __h(
      "select",
      {
        ...forwarded(this, ["value", "defaultValue", "children", "ref", ...field.replaced]),
        ...field.listeners,
        ref: this.e,
      },
      ...given(this.props.children),
    );
  }
}

/** The option values a choice names, written as an option's `value` is: strings. */
function wantedOf(chosen: string | number | readonly (string | number)[]): Set<string> {
  return new Set(Array.isArray(chosen) ? chosen.map(String) : [String(chosen)]);
}

/** Gives an option the `selected` attribute or takes it away, and touches it only when it says otherwise. */
function markDefault(option: HTMLOptionElement, on: boolean): void {
  if (option.hasAttribute("selected") === on) return;
  if (on) option.setAttribute("selected", "");
  else option.removeAttribute("selected");
}
