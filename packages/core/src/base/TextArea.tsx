import { Component } from "./Component";
import { createRef } from "./Ref";
import { mounted, updated } from "./decorators";
import { __h } from "../vdom/h";
import { forwarded, given } from "./forwarded";
import type { RefTarget } from "./Ref";

/**
 * A `<textarea>` keeps its value INSIDE the element.
 *
 * HTML gives a textarea no `value` attribute — the value is the element's text — so
 * `<textarea value="hello">` is markup a browser ignores. Measured on the parsed output: an EMPTY
 * field, which filled itself in when the bundle arrived and the property was set.
 *
 * **Why this is a component and not a line in the attribute writer.** The value has to become the
 * element's child, and the attribute pass runs BEFORE the children — so a text node written there is
 * one the children pass has never heard of, and it unmounts it as a leftover. Measured, `"hello"` at
 * the moment of writing and `<textarea></textarea>` in the finished markup. Written from a `render`
 * it is an ordinary child: the pass that would have dropped it claims it instead, and it diffs and
 * hydrates like any other text.
 *
 * The PROPERTY is set afterwards, and that is what makes the field controlled. A textarea's text is
 * its DEFAULT value: it stops driving the element the moment somebody types in it, and from then on
 * the property is the only thing that speaks.
 */
export interface TextAreaProps {
  /**
   * Anything a `<textarea>` takes, passed straight through.
   *
   * Spelled out rather than reached for through `RamondaArgs`, because that type is a Partial over a
   * UNION and `Omit` across a union keeps only the keys every member shares — which throws away the
   * index signature that carries `id`, `disabled`, `data-*` and `aria-*`.
   */
  // biome-ignore lint/suspicious/noExplicitAny: the same latitude the tag's own type gives
  [attribute: Lowercase<string>]: any;
  /** What the field holds. */
  value: string | number;
  className?: string;
  key?: string | number;
  ref?: RefTarget<HTMLTextAreaElement>;
}

export class TextArea extends Component<TextAreaProps> {
  /**
   * `e` — the `<textarea>` this component owns. Its ref is this component's, always, and the caller's
   * is handed the same node.
   *
   * One element takes one `ref`, so a caller who writes `<TextArea ref={mine}>` cannot have it
   * forwarded onto the tag: whichever is written last wins, and if the caller's wins this component
   * never sees its own element. That bug was found on `Select`, where it silently stopped the choice
   * from ever being applied.
   */
  private e = createRef<HTMLTextAreaElement>((node) => this.g(node));

  /** `h` — the caller's ref as of the last HAND-OVER, so a swapped one can be let go of. */
  private h: RefTarget<HTMLTextAreaElement> | undefined;

  private g(node: HTMLTextAreaElement | null): void {
    const theirs = this.props.ref;
    if (this.h !== undefined && this.h !== theirs) this.h.setCurrent(null);
    this.h = theirs;
    theirs?.setCurrent(node);
  }

  /**
   * The property, which is what a controlled field is driven by.
   *
   * Client only, and that is the difference from `Select`: the text child already says everything a
   * served page can say, so the server has nothing left to do here. On the client it matters from
   * the first keystroke — once the field is dirty its text means nothing to the DOM any more, and a
   * model that says otherwise has only the property left to say it with.
   */
  @mounted
  @updated
  settle(): void {
    const field = this.e.current;
    if (!field) return;

    // A caller may hand over a DIFFERENT ref between renders, and the element's own ref did not
    // change, so nothing else would notice. This is the one moment that can.
    if (this.h !== this.props.ref) this.g(field);

    field.value = String(this.props.value);
  }

  render() {
    /**
     * Built through the factory rather than written as JSX, because `<textarea>` is refused and JSX
     * would need a `@ts-expect-error` to get past its own types. `__h` takes the name as a value, so
     * there is nothing to suppress: the refusal keeps meaning exactly what it says at every call
     * site that writes the tag, and this one does not write it.
     */
    const text = String(this.props.value);

    /**
     * An EMPTY value is no child at all, not a child that is the empty string.
     *
     * The two look identical in the DOM and are not the same tree: a server render has nothing to
     * serialize for `""`, so it sends `<textarea></textarea>`, and a client that built an empty text
     * node disagrees with it. Measured: RMD007, *rendered the text "" but the server sent nothing* —
     * a report about correct markup, which is the worst kind.
     */
    return __h(
      "textarea",
      { ...forwarded(this, ["value", "children", "ref"]), ref: this.e },
      ...given(text || undefined),
    );
  }
}
