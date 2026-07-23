import { Component, Host } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { demos } from "./demos";
import { Demo } from "./Demo";

/**
 * Every demo in the registry, rendered on one page.
 *
 * It exists so the registry cannot rot quietly: a demo that throws, leaks or
 * fails to hydrate shows up here rather than waiting for whichever prose page
 * happens to reference it. It is also the page to open after changing anything
 * in the framework — thirteen components exercising most of the API, all on one
 * screen.
 */
@Host("div")
export class ExamplesIndex extends Component {
  render(): RamondaNode {
    return (
      <div className="examples">
        {Object.keys(demos).map((name) => (
          <Demo name={name} titled={true} />
        ))}
      </div>
    );
  }
}
