import { Component, state, destroyed, __h } from "@ramonda/core";
import type { ComponentChild, RamondaNode } from "@ramonda/core";
import type { ContentNode } from "./content-types";
import { toVNode } from "./Markdown";

interface CodeBlockProps {
  /** The highlighted `<pre>` node, straight from the Shiki build output. */
  node: ContentNode;
  /** Extra class on the wrapper — the demo panel uses it to keep its framing. */
  className?: string;
  /** Keep the source out of the search index (the demo panel repeats prose). */
  pagefindIgnore?: boolean;
}

/** The verbatim text of a node's subtree — what the clipboard receives. */
function textOf(node: ContentNode): string {
  if (typeof node === "string") return node;
  return (node.c ?? []).map(textOf).join("");
}

/**
 * A highlighted code block with a copy button.
 *
 * The highlighting itself is done at build time by Shiki (see build-content.mjs);
 * this wraps the resulting `<pre>` so a reader can lift the code without a manual
 * select. It renders the `<pre>` directly rather than through `toVNode`, because
 * `toVNode` routes a Shiki `<pre>` back here — going through it would recurse.
 */
export class CodeBlock extends Component<CodeBlockProps> {
  @state private copied = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  copy(): void {
    void navigator.clipboard?.writeText(textOf(this.props.node));
    this.copied = true;
    // Reset the label, but cancel a pending reset first so a quick second copy
    // does not get cleared early by the first one's timer.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.copied = false;
    }, 1400);
  }

  @destroyed
  private stopTimer(): void {
    clearTimeout(this.timer);
  }

  render(): RamondaNode {
    const pre = this.props.node;
    // The build always hands this component a `<pre>` element; a bare string
    // would mean the highlighter produced nothing, which is a build-time fault.
    const children = typeof pre === "string" ? [pre] : (pre.c?.map(toVNode) ?? []);
    const tag = typeof pre === "string" ? "pre" : pre.t;
    const attrs = typeof pre === "string" ? null : (pre.a ?? null);

    return (
      <div
        className={this.props.className ? `code-block ${this.props.className}` : "code-block"}
        data-pagefind-ignore={this.props.pagefindIgnore ? "" : undefined}
      >
        <button type="button" className="copy-btn" onclick={this.copy} aria-label="Copy code to clipboard">
          {this.copied ? "Copied" : "Copy"}
        </button>
        {/* ramonda-check-ignore the tag comes from the parsed content tree and is always an element name */}
        {__h(tag, attrs, ...children) as ComponentChild}
      </div>
    );
  }
}
