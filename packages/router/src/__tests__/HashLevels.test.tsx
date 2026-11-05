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

/**
 * What a component READS is its own line — the top, every owner down to its own, and its own — the
 * same line it writes. One record of every owner's keys let a child's key shadow its parent's (a page
 * writing its own `nav` made the parent read it, and unmount the page) and let two siblings using one
 * name read whichever wrote last. Found by a review of this branch.
 */
describe("what a component reads", () => {
  test("a page's own key does not change what its parent reads", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { nav: "menu" });
    expect(hash()).toBe("#nav=video#nav:nav=menu");
    expect(navs.shell!.hashParams).toEqual({ nav: "video" });
    // The page sees its own, which is nearer than its parent's.
    expect(navs.video!.hashParams).toEqual({ nav: "menu" });
  });

  test("two siblings using one name each read their own", async () => {
    const App = app(Shell);
    render(<App />);
    await write("shell", { nav: "video", panel: "open" });
    await write("video", { tab: "comments" });
    await write("filters", { tab: "recent" });
    expect(navs.video!.hashParams.tab).toBe("comments");
    expect(navs.filters!.hashParams.tab).toBe("recent");
    expect(navs.shell!.hashParams).toEqual({ nav: "video", panel: "open" });
  });

  test("two levels down reads the whole line above it", async () => {
    const App = app(DeepShell);
    render(<App />);
    await write("shell", { nav: "video" });
    await write("video", { tab: "comments" });
    await write("comments", { page: "2" });
    expect(navs.comments!.hashParams).toEqual({ nav: "video", tab: "comments", page: "2" });
    expect(navs.video!.hashParams).toEqual({ nav: "video", tab: "comments" });
  });
});

/**
 * Owners come from the URL, so an owner named `__proto__` or `constructor` is text like any other. In
 * a plain object, `scopes["__proto__"] = …` replaced the record's prototype instead of adding an owner.
 */
describe("a name from the URL is only a name", () => {
  test("`__proto__` and `constructor` are owners like any other", async () => {
    window.history.pushState(null, "", "/#x=1#__proto__:a=1#constructor:b=2");
    class Proto extends Component {
      nav = this.use(Navigator);
      @created keep() {
        navs.proto = this.nav;
      }
      render() {
        return <p>proto</p>;
      }
    }
    class Owners extends Component {
      nav = this.use(Navigator);
      @created keep() {
        navs.shell = this.nav;
      }
      render() {
        return (
          <div>
            <HashLevel of="constructor">
              <Proto />
            </HashLevel>
          </div>
        );
      }
    }
    class App extends Component {
      router = this.use(Router);
      render(): RamondaNode {
        return <Owners />;
      }
    }
    render(<App />);
    expect(navs.shell!.hashParams).toEqual({ x: "1" });
    // The page under `constructor` reads that owner's own keys, not the `Object` function.
    expect(navs.proto!.hashParams).toEqual({ x: "1", b: "2" });
    await act(async () =>
      navs.proto!.updateHashParams((prev) => {
        expect(Object.keys(prev)).toEqual(["b"]);
        return { ...prev, c: "3" };
      }),
    );
    expect(hash()).toContain("#constructor:b=2&c=3");
    expect(hash()).toContain("#__proto__:a=1");
  });

  test("`?__proto__=x` is a query key like any other", () => {
    window.history.pushState(null, "", "/?__proto__=x");
    const App = app(Video);
    render(<App />);
    expect(Object.keys(navs.video!.searchParams)).toEqual(["__proto__"]);
  });
});

describe("the owners are in the URL", () => {
  test("a page loaded on a deep URL knows which key owns which", async () => {
    window.history.pushState(null, "", "/#nav=video&panel=open#nav:tab=comments#panel:filter=new");
    const App = app(Shell);
    render(<App />);
    // Its own line, top to itself: the top's keys and its own, never a sibling's.
    expect(navs.video!.hashParams).toEqual({ nav: "video", panel: "open", tab: "comments" });
    expect(navs.filters!.hashParams).toEqual({ nav: "video", panel: "open", filter: "new" });
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
