import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Component, Host, Hook, state, created, mounted, createRef } from "../../index";
import { renderToString } from "../../hydration/ssr";

/**
 * The lint that catches state produced during create/mount on the SERVER which
 * would be gone after hydration — those phases do not re-run on the client.
 *
 * Its exclusions matter as much as its warnings: a lint that cries about refs,
 * methods and hooks would be turned off, and then it catches nothing.
 */
let warnings: string[] = [];

describe("hydration: unpersisted-state lint, exclusions and mutation", () => {
  beforeEach(() => {
    warnings = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    window.addEventListener("ramonda:dev-log", handler);
  });
  const handler = (e: Event) => {
    const m = (e as CustomEvent).detail?.message as string;
    if (m) warnings.push(m);
  };
  afterEach(() => {
    window.removeEventListener("ramonda:dev-log", handler);
    vi.restoreAllMocks();
  });

  const warnedAbout = (key: string) => warnings.some((w) => w.includes(`"${key}"`));

  test("a ref is not warned about — it is re-established on the client", async () => {
    @Host("div")
    class C extends Component {
      myRef = createRef<HTMLElement>();
      other: unknown;
      @created seed() {
        this.other = createRef<HTMLElement>();
      }
      render() {
        return <span>x</span>;
      }
    }
    await renderToString(<C />);
    expect(warnedAbout("other")).toBe(false);
  });

  test("a hook instance is not warned about — hooks re-run", async () => {
    class Helper extends Hook {
      @state v = 1;
    }
    @Host("div")
    class C extends Component {
      later: unknown;
      @created seed() {
        this.later = this.use(Helper);
      }
      render() {
        return <span>x</span>;
      }
    }
    await renderToString(<C />);
    expect(warnedAbout("later")).toBe(false);
  });

  test("a function is not warned about", async () => {
    @Host("div")
    class C extends Component {
      fn: unknown;
      @created seed() {
        this.fn = () => 1;
      }
      render() {
        return <span>x</span>;
      }
    }
    await renderToString(<C />);
    expect(warnedAbout("fn")).toBe(false);
  });

  test("writing the same value back is not a change", async () => {
    @Host("div")
    class C extends Component {
      keep = "same";
      @created seed() {
        this.keep = "same";
      }
      render() {
        return <span>x</span>;
      }
    }
    await renderToString(<C />);
    expect(warnedAbout("keep")).toBe(false);
  });

  test("MUTATING an object is caught, not just reassigning one", async () => {
    @Host("div")
    class C extends Component {
      cfg: Record<string, unknown> = {};
      @created seed() {
        this.cfg.loaded = true;
      }
      render() {
        return <span>{String(this.cfg.loaded)}</span>;
      }
    }
    const html = await renderToString(<C />);
    // The server renders the mutation…
    expect(html).toContain("true");
    // …and the client will not have it, because @created does not re-run there.
    // The reference never changed, so a reference comparison called this
    // "unchanged" and said nothing — a silent hydration mismatch.
    expect(warnedAbout("cfg")).toBe(true);
  });

  test("a field set in @mounted is caught too, not only @created", async () => {
    @Host("div")
    class C extends Component {
      late: unknown;
      @mounted seed() {
        this.late = "x";
      }
      render() {
        return <span>x</span>;
      }
    }
    await renderToString(<C />);
    expect(warnedAbout("late")).toBe(true);
  });
});
