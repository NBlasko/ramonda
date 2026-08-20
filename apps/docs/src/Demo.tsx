import { Component, Host, state, __h } from "@ramonda/core";
import type { ComponentChild, RamondaNode } from "@ramonda/core";
import { demos, demoTitles } from "./demos";
import { demoSources } from "./generated/demo-sources";
import { CodeBlock } from "./CodeBlock";

interface DemoProps {
  name: string;
  /** Show the heading. Off inside prose, on for the examples index. */
  titled?: boolean;
}

/**
 * One example: the component running, and the code that produced it.
 *
 * The two come from the same file. `src/demos/<Name>.tsx` is imported for the
 * live render and read verbatim at build time for the source — so an example
 * cannot describe code that no longer exists, which is the failure every
 * hand-copied snippet eventually has and nothing catches.
 *
 * The source starts collapsed. Someone reading a concept wants to see the thing
 * work; someone who wants the code will open it.
 */
@Host("section")
export class Demo extends Component<DemoProps> {
  @state open = false;

  toggle() {
    this.open = !this.open;
  }

  render(): RamondaNode {
    const name = this.props.name;
    const component = demos[name];
    const source = demoSources[name];

    if (!component) {
      throw new Error(`[docs] No demo named "${name}". Add it to src/demos/index.ts, or fix the \`\`\`demo: fence.`);
    }

    return (
      <div className="demo">
        {this.props.titled ? (
          <h3 className="demo-title" id={`demo-${name}`}>
            {demoTitles[name] ?? name}
          </h3>
        ) : null}
        <div className="demo-stage">{__h(component as never, null) as ComponentChild}</div>
        <button type="button" className="demo-toggle" onclick={this.toggle}>
          {this.open ? "▾ hide source" : "▸ show source"} <span className="demo-file">{name}.tsx</span>
        </button>
        {this.open ? <CodeBlock node={source} className="code-block-demo" pagefindIgnore={true} /> : null}
      </div>
    );
  }
}
