import { describe, test, expect } from "vitest";
import { created, mounted } from "../../base/decorators";
import { Component } from "../../base/Component";
import { Head } from "../../base/Head";
import { renderToString, renderPage } from "../../hydration/ssr";
import { ServerRedirect, captureServerRedirect } from "../../hydration/serverRedirect";
import { PORTAL_ATTR } from "../../helpers/constants";

/**
 * The redirect primitive the router builds on, tested here at the core level
 * because it is a core export in its own right: capturing a redirect sink during a
 * server render, and `renderToString` turning a recorded redirect into a throw.
 */

describe("ServerRedirect (the error)", () => {
  test("carries the url and defaults to a 302", () => {
    const r = new ServerRedirect("/login");
    expect(r).toBeInstanceOf(Error);
    expect(r.name).toBe("ServerRedirect");
    expect(r.url).toBe("/login");
    expect(r.status).toBe(302);
    expect(r.message).toContain("/login");
  });

  test("accepts a custom status", () => {
    expect(new ServerRedirect("/gone", 308).status).toBe(308);
  });
});

describe("captureServerRedirect", () => {
  test("returns undefined outside a server render (e.g. on the client)", () => {
    expect(captureServerRedirect()).toBeUndefined();
  });

  test("a captured guard that fires makes renderToString throw ServerRedirect", async () => {
    class Guard extends Component {
      private redirect = captureServerRedirect();
      @created go() {
        this.redirect?.("/login");
      }
      render() {
        return (
          <main>
            <span>secret</span>
          </main>
        );
      }
    }

    const err = await renderToString(<Guard />).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerRedirect);
    expect((err as ServerRedirect).url).toBe("/login");
  });

  test("works from a @mounted, which fires after the synchronous mount window", async () => {
    class Guard extends Component {
      private redirect = captureServerRedirect();
      @mounted go() {
        this.redirect?.("/from-mount");
      }
      render() {
        return (
          <main>
            <span>x</span>
          </main>
        );
      }
    }

    const err = await renderToString(<Guard />).catch((e: unknown) => e);
    expect((err as ServerRedirect).url).toBe("/from-mount");
  });

  test("first writer wins — a second redirect in the same render is ignored", async () => {
    class Guard extends Component {
      private redirect = captureServerRedirect();
      @created go() {
        this.redirect?.("/first");
        this.redirect?.("/second");
      }
      render() {
        return (
          <main>
            <span>x</span>
          </main>
        );
      }
    }

    const err = await renderToString(<Guard />).catch((e: unknown) => e);
    expect((err as ServerRedirect).url).toBe("/first");
  });

  test("capturing without firing renders the page normally", async () => {
    class NoGuard extends Component {
      private redirect = captureServerRedirect();
      render() {
        // Held but never called — this is a normal page.
        void this.redirect;
        return (
          <main>
            <span>page</span>
          </main>
        );
      }
    }

    const html = await renderToString(<NoGuard />);
    expect(html).toContain("page");
  });
});

describe("renderPage on a redirect", () => {
  test("throws too, and does not leak the render's head tags", async () => {
    class Guard extends Component {
      private redirect = captureServerRedirect();
      head = this.use(Head, () => ({ title: "Secret", description: "should not leak" }));
      @created go() {
        this.redirect?.("/login");
      }
      render() {
        return (
          <main>
            <span>secret</span>
          </main>
        );
      }
    }

    const err = await renderPage(<Guard />).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerRedirect);

    // The finally in renderPage clears the head even on the redirect path, so the
    // next request cannot inherit this one's title/description.
    expect(document.head.querySelectorAll(`[${PORTAL_ATTR}]`).length).toBe(0);
    expect(document.title).toBe("");
  });
});
