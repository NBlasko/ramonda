import { Component, mounted, onWindow, state, __h } from "@ramonda/core";
import type { ComponentChild, RamondaNode } from "@ramonda/core";
import { CodeBlock } from "./CodeBlock";
import type { ContentNode } from "./content-types";

interface CodeTabsProps {
  /**
   * The `tabs` node the build made: one `tab` per view, each holding its code. `a.remember`, when
   * present, names a choice the reader makes once for every set of tabs that carries it.
   */
  node: Exclude<ContentNode, string>;
}

/** Said to every other set of tabs on the page when the reader picks one. */
const CHANGED = "ramonda-docs-tab";

function stored(key: string): string | undefined {
  try {
    return localStorage.getItem(`ramonda-docs-${key}`) ?? undefined;
  } catch {
    // Storage can be refused — a private window, blocked site data. The tabs still work.
    return undefined;
  }
}

/**
 * One piece of code seen several ways, in tabs.
 *
 * Two fences make one: an `install`, written for each package manager — a choice remembered across
 * pages, so a reader picks theirs once — and a `compiled` block, shown as written, as the classes
 * an element gets and as the CSS the build emits, which stands alone and remembers nothing.
 *
 * The server renders the first tab; a remembered choice is read once the page is in a browser, so
 * the markup the client adopts is the markup the server wrote.
 */
export class CodeTabs extends Component<CodeTabsProps> {
  @state chosen = "";

  private tabs(): { name: string; command: ContentNode }[] {
    return (this.props.node.c ?? []).flatMap((tab) =>
      typeof tab === "string" ? [] : [{ name: tab.a?.name ?? "", command: tab.c?.[0] ?? "" }],
    );
  }

  /** The tab on show: the reader's pick, when this set has it, and the first otherwise. */
  private shown(): string {
    const names = this.tabs().map((tab) => tab.name);
    return names.includes(this.chosen) ? this.chosen : (names[0] ?? "");
  }

  /** Another set of tabs sharing this one's choice was picked — this one follows. */
  @onWindow(CHANGED)
  follow(event: Event): void {
    const { key, name } = (event as CustomEvent<{ key: string; name: string }>).detail;
    if (key === this.remembers()) this.chosen = name;
  }

  /** The choice this set shares with others, or nothing for a set that stands alone. */
  private remembers(): string | undefined {
    return this.props.node.a?.remember;
  }

  @mounted({ env: "client" })
  private remember(): void {
    const key = this.remembers();
    if (key !== undefined) this.chosen = stored(key) ?? "";
  }

  /** One handler for every tab; the tab says which it is. */
  choose(event: MouseEvent): void {
    const name = (event.currentTarget as HTMLElement).dataset.tab;
    if (name !== undefined) this.pick(name);
  }

  pick(name: string): void {
    const key = this.remembers();
    if (key === undefined) {
      this.chosen = name;
      return;
    }
    try {
      localStorage.setItem(`ramonda-docs-${key}`, name);
    } catch {
      // Not remembered, then — the tabs on this page still follow.
    }
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: { key, name } }));
  }

  render(): RamondaNode {
    const shown = this.shown();
    const tab = this.tabs().find((one) => one.name === shown);
    return (
      <div className="code-tabs">
        <div className="code-tabs-bar" role="tablist" aria-label={this.props.node.a?.label ?? "Views"}>
          {this.tabs().map((one) => (
            <button
              key={one.name}
              type="button"
              role="tab"
              aria-selected={one.name === shown ? "true" : "false"}
              className={one.name === shown ? "code-tab active" : "code-tab"}
              data-tab={one.name}
              onclick={this.choose}
            >
              {one.name}
            </button>
          ))}
        </div>
        {tab === undefined ? null : (__h(CodeBlock, { node: tab.command }) as ComponentChild)}
      </div>
    );
  }
}
