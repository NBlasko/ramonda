import { describe, test, expect } from "vitest";
import { Component } from "../../base/Component";
import { state } from "../../base/decorators";
import { renderPage } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";
import { instanceOf } from "../../test/setup";

/**
 * The slot a hydrated node carries.
 *
 * A node's SLOT is the JSX child position it was built for, and it is what keeps a child's identity
 * when a conditional sibling above it appears: matching by DOM position hands that child the node
 * its neighbour was using. Text and attributes are patched either way, so the page reads correctly
 * while focus, scroll, an uncontrolled input's value and element identity have all moved one row.
 *
 * Adoption used to leave every node on a hydrated page unstamped, because it does not go through the
 * claim in the diff that stamps one. The first update that added a leading child then had nothing to
 * match on but position. Measured on the pair below: the text came out right and the two `<span>`s
 * had swapped places.
 */

class Page extends Component {
  @state lead = false;
  render() {
    return (
      <div id="shell">
        {this.lead ? <b id="lead">lead</b> : null}
        <span id="one">one</span>
        <span id="two">two</span>
      </div>
    );
  }
}

async function hydrated<T>(vnode: Parameters<typeof renderPage>[0]) {
  const page = await renderPage(vnode);
  const element = document.createElement("div");
  document.body.appendChild(element);
  element.innerHTML = page.body;
  hydrateRoot(vnode, element);
  await Promise.resolve();
  return {
    element,
    instance: instanceOf<T>(element.querySelector("#shell")!),
    settle: async () => {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("the first update after hydration", () => {
  test("keeps each adopted node in its own slot when a child appears above them", async () => {
    const { element, instance, settle } = await hydrated<Page>(<Page />);

    const one = element.querySelector("#one")!;
    const two = element.querySelector("#two")!;

    instance.lead = true;
    await settle();

    expect(element.querySelector("#shell")!.innerHTML).toBe(
      '<b id="lead">lead</b><span id="one">one</span><span id="two">two</span>',
    );

    // The nodes themselves, not just the text they show. Before the fix `#one` was the node the
    // server sent as `#two`, patched over.
    expect(element.querySelector("#one")).toBe(one);
    expect(element.querySelector("#two")).toBe(two);

    element.remove();
  });
});
