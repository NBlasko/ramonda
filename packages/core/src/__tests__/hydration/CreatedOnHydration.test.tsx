import { describe, expect, test } from "vitest";
import { Component } from "../../base/Component";
import { created, mounted } from "../../base/decorators";
import { renderToString } from "../../hydration/ssr";
import { hydrateRoot } from "../../hydration/hydrate";

/**
 * Which lifecycle callbacks run when the browser takes over server markup.
 *
 * `/concepts/lifecycle` documents this now, and prose is not a guarantee — the rule is two
 * different comparisons in `hydrate.ts` (`create.env === "client"` for creates, `env !== "server"`
 * for mounts) and they have already been wrong once in each direction: `@mounted` was
 * `=== "client"` and silently dropped every default mount on a hydrated page.
 *
 * The asymmetry is deliberate. A shared `@created` ran on the server and its work is expected to
 * have travelled in the hydration blob; a shared `@mounted` exists to touch the real DOM, which the
 * server never had.
 */
describe("lifecycle on a hydrated page", () => {
  /**
   * Takes markup that was ALREADY rendered rather than rendering its own.
   *
   * The first version of this helper called `renderToString` itself, so every test rendered on the
   * server twice and counted the second one's callbacks as the browser's. Both tests "failed", and
   * both times the fault was here.
   */
  async function hydrateInto(html: string, vnode: unknown) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    root.innerHTML = html;
    hydrateRoot(vnode as never, root);
    await Promise.resolve();
    return root;
  }

  test("a shared @created is skipped, a client one runs, and @mounted runs either way", async () => {
    const ran: string[] = [];

    class Page extends Component {
      @created sharedCreate() {
        ran.push("created:shared");
      }
      @created({ env: "client" }) clientCreate() {
        ran.push("created:client");
      }
      @mounted sharedMount() {
        ran.push("mounted:shared");
      }
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }

    const html = await renderToString(<Page />);
    // What the SERVER ran, for contrast. The shared MOUNT runs there too — `shared` means both
    // sides, and a server render is one of them — while the client-only create does not.
    expect(ran).toEqual(["created:shared", "mounted:shared"]);

    ran.length = 0;
    const root = await hydrateInto(html, <Page />);

    // The shared create is absent — it is the whole point of the section this pins.
    expect(ran).not.toContain("created:shared");
    expect(ran).toContain("created:client");
    expect(ran).toContain("mounted:shared");
    root.remove();
  });

  /**
   * The trap, as a page would meet it: a shared `@created` that PRIMES something rather than
   * storing it. Nothing travels in the blob, nothing re-runs, and the page behaves as though the
   * step was never written.
   *
   * Asserted as the CURRENT behaviour rather than as a wish: the framework does not rescue this,
   * and the documented answer is `env: "client"`.
   */
  test("a shared @created that primes rather than stores does not happen at all", async () => {
    let primed = 0;

    class Page extends Component {
      @created prime() {
        primed++;
      }
      render() {
        return (
          <main>
            <p>x</p>
          </main>
        );
      }
    }

    const html = await renderToString(<Page />);
    expect(primed).toBe(1); // the server did it

    const root = await hydrateInto(html, <Page />);
    expect(primed).toBe(1); // and the browser did not
    root.remove();
  });
});
