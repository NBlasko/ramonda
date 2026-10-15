import { beforeEach, describe, expect, test } from "vitest";
import { Component, created } from "@ramonda/core";
import type { RamondaNode } from "@ramonda/core";
import { render, act } from "@ramonda/testing-library";
import { HashLevel, Navigator, Router } from "../Router";

/**
 * The hash in levels: a change to a key clears what was written below that key.
 *
 * The case it exists for: a video page keeps its tab in the hash, `#tab=comments`, and is written as
 * a whole page on its own. An app then puts it under a navbar of its own, `#nav=video` or
 * `#nav=analytics`. Moving to analytics must take the video page's tab with it — and the video page's
 * code may not change for that, so it cannot know who its parent is. The PARENT knows its child: it
 * wraps the page in `<HashLevel of="nav">`, and what the page writes belongs to `nav`.
 *
 * Owned by a KEY, not by a depth. With a depth alone, two pages side by side shared one level, and a
 * change in one cleared the other's children. Measured on the first version, and the reason this one
 * exists.
 *
 * Nothing here depends on what is mounted. Who owns what lives in the state and in the URL — a `#`
 * segment per owner, named before a `:` — so a reload and back/forward keep it.
 */
const navs: Record<string, Navigator> = {};

class Video extends Component {
  nav = this.use(Navigator);
  @created keep() {
    navs.video = this.nav;
  }
  render() {
    return <p>{this.nav.hashParams.tab ?? "none"}</p>;
  }
}

class Comments extends Component {
  nav = this.use(Navigator);
  @created keep() {
    navs.comments = this.nav;
  }
  render() {
    return <p>{this.nav.hashParams.page ?? "1"}</p>;
  }
}

class Filters extends Component {
  nav = this.use(Navigator);
  @created keep() {
    navs.filters = this.nav;
  }
  render() {
    return <p>{this.nav.hashParams.filter ?? "all"}</p>;
  }
}

/** The video page, with its own child under its own key — two levels down from the shell. */
class VideoWithComments extends Component {
  nav = this.use(Navigator);
  @created keep() {
    navs.video = this.nav;
  }
  render() {
    return (
      <HashLevel of="tab">
        <Comments />
      </HashLevel>
    );
  }
}

class Shell extends Component {
  nav = this.use(Navigator);
  @created keep() {
    navs.shell = this.nav;
  }
  render() {
    return (
      <div>
        <HashLevel of="nav">
          <Video />
        </HashLevel>
        <HashLevel of="panel">
          <Filters />
        </HashLevel>
      </div>
    );
  }
}

class DeepShell extends Component {
  nav = this.use(Navigator);
  @created keep() {
    navs.shell = this.nav;
  }
  render() {
    return (
      <HashLevel of="nav">
        <VideoWithComments />
      </HashLevel>
    );
  }
}

function app(Page: typeof Video | typeof Shell | typeof DeepShell) {
  class App extends Component {
    router = this.use(Router);
    render(): RamondaNode {
      return <Page />;
    }
  }
  return App;
}

const hash = () => window.location.hash;
const write = (who: string, patch: Record<string, string>) =>
  act(async () => navs[who]!.updateHashParams((prev) => ({ ...prev, ...patch })));

beforeEach(() => {
  window.history.pushState(null, "", "/");
  for (const key of Object.keys(navs)) delete navs[key];
});

describe("a page on its own", () => {
  test("owns nothing above it, and writes the hash as it always did", async () => {
    const App = app(Video);
    render(<App />);
    await write("video", { tab: "comments", sort: "new" });
    expect(hash()).toBe("#tab=comments&sort=new");
  });
});

describe("a page under a key", () => {
  test("writes a segment named for its owner, and reads every key", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { tab: "comments", sort: "new" });
    expect(hash()).toBe("#nav=video#nav:tab=comments&sort=new");
    expect(navs.video!.hashParams).toEqual({ nav: "video", tab: "comments", sort: "new" });
  });

  test("an updater is handed only its own keys, so the parent's are not copied down", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video" });
    await act(async () =>
      navs.video!.updateHashParams((prev) => {
        expect(prev).toEqual({});
        return { tab: "comments" };
      }),
    );
    expect(hash()).toBe("#nav=video#nav:tab=comments");
  });

  test("the owner is written first, whichever was written first", async () => {
    const App = app(Shell);
    render(<App />);
    await write("video", { tab: "comments" });
    // With nothing above it, the first segment stays empty: the first segment is always the top.
    expect(hash()).toBe("##nav:tab=comments");
    // `nav` changed from nothing to `video`, which is a change: what it owns goes with it.
    await write("shell", { nav: "video" });
    expect(hash()).toBe("#nav=video");
    await write("video", { tab: "comments" });
    expect(hash()).toBe("#nav=video#nav:tab=comments");
  });
});

describe("a change to a key", () => {
  test("clears what that key owns", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { tab: "comments", sort: "new" });
    await write("shell", { nav: "analytics" });
    expect(hash()).toBe("#nav=analytics");
    expect(navs.shell!.hashParams).toEqual({ nav: "analytics" });
  });

  test("and nothing a sibling key owns", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video", panel: "open" });
    await write("video", { tab: "comments" });
    await write("filters", { filter: "new" });
    expect(hash()).toBe("#nav=video&panel=open#nav:tab=comments#panel:filter=new");

    await write("shell", { nav: "analytics" });
    expect(hash()).toBe("#nav=analytics&panel=open#panel:filter=new");

    await write("shell", { panel: "closed" });
    expect(hash()).toBe("#nav=analytics&panel=closed");
  });

  test("writing the value it already has clears nothing", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { tab: "comments" });
    await write("shell", { nav: "video" });
    expect(hash()).toBe("#nav=video#nav:tab=comments");
  });

  test("a change below leaves its owner alone", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { tab: "comments" });
    await write("video", { tab: "suggestions" });
    expect(hash()).toBe("#nav=video#nav:tab=suggestions");
  });

  test("clears every level under it, not only the next", async () => {
    const App = app(DeepShell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { tab: "comments" });
    await write("comments", { page: "2" });
    expect(hash()).toBe("#nav=video#nav:tab=comments#nav.tab:page=2");

    await write("video", { tab: "suggestions" });
    expect(hash()).toBe("#nav=video#nav:tab=suggestions");

    await write("comments", { page: "3" });
    await write("shell", { nav: "analytics" });
    expect(hash()).toBe("#nav=analytics");
  });
});

describe("the owners are in the URL", () => {
  test("a page loaded on a deep URL knows which key owns which", async () => {
    window.history.pushState(null, "", "/#nav=video&panel=open#nav:tab=comments#panel:filter=new");
    const App = app(Shell);
    render(<App />);
    expect(navs.video!.hashParams).toEqual({ nav: "video", panel: "open", tab: "comments", filter: "new" });
    await write("shell", { nav: "analytics" });
    expect(hash()).toBe("#nav=analytics&panel=open#panel:filter=new");
  });

  test("and so does back/forward", async () => {
    const App = app(Shell);
    render(<App />);
    await act(async () => {
      window.history.pushState(null, "", "/#nav=video#nav:tab=comments");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(navs.video!.hashParams).toEqual({ nav: "video", tab: "comments" });
    await write("shell", { nav: "analytics" });
    expect(hash()).toBe("#nav=analytics");
  });

  test("a push names its owners the same way", async () => {
    const App = app(Shell);
    render(<App />);
    await act(async () => navs.shell!.push("/#nav=video#nav:tab=comments"));
    expect(navs.video!.hashParams).toEqual({ nav: "video", tab: "comments" });
    await write("shell", { nav: "analytics" });
    expect(hash()).toBe("#nav=analytics");
  });

  test("a colon in the first segment is a key, not an owner", async () => {
    window.history.pushState(null, "", "/#section:intro");
    const App = app(Video);
    render(<App />);
    expect(navs.video!.hashParams).toEqual({ "section:intro": "" });
  });
});
