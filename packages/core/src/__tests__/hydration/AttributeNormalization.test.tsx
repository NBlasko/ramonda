import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../base/decorators";
import { Component } from "../../base/Component";
import { hydrateRoot } from "../../hydration/hydrate";
import { renderToString } from "../../hydration/ssr";
import { resetDiagnostics } from "../../debug/diagnostics";

/**
 * RMD007 left one question open: `style` was not special. The server's copy of
 * every attribute goes out through `setAttribute`, is serialized to HTML, and is
 * parsed back — and wherever the DOM REWRITES a value on that trip, the client's
 * raw string cannot match it, and the comparator reports divergence on markup
 * that is perfectly correct. `style` was simply the one the framework itself
 * wrote on every component, so it was the one that got noticed.
 *
 * So rather than reason about which attributes normalize, this renders a wide
 * spread of them through the real round-trip and demands total silence. Anything
 * that normalizes shows up here as a diagnostic, named.
 *
 * **Result (2026-07-19): nothing else normalizes.** className with doubled
 * spaces, entities in a title, numbers, booleans, `data-*` and `aria-*`, a query
 * string in an href, form attributes with a live value, and SVG's case-sensitive
 * `viewBox` all come back byte-identical. `setAttribute` stores what it is given
 * and `getAttribute` returns it; `style` was the exception because it is the one
 * value the DOM re-serializes from a parsed model rather than storing verbatim.
 *
 * The object-style test was written expecting a second instance of the bug and
 * found none — see the comment on it. That is the useful half of this file: the
 * suspicion was wrong, and it is now written down instead of re-suspected.
 */
function captureDiagnostics() {
  const all: string[] = [];
  const handler = (event: Event) => {
    all.push((event as CustomEvent).detail.message as string);
  };
  window.addEventListener("ramonda:dev-log", handler);
  return {
    all,
    coded: () => all.filter((message) => /^\[RMD\d+\]/.test(message)),
    stop: () => window.removeEventListener("ramonda:dev-log", handler),
  };
}

async function roundTrip(vnode: Parameters<typeof renderToString>[0]) {
  const html = await renderToString(vnode);
  const container = document.createElement("div");
  document.body.appendChild(container);
  // Through markup and back: the parse is what applies the DOM's own rules.
  container.innerHTML = html;
  return container;
}

describe("attribute normalization across the hydration boundary", () => {
  let captured: ReturnType<typeof captureDiagnostics>;

  beforeEach(() => {
    resetDiagnostics();
    vi.spyOn(console, "log").mockImplementation(() => {});
    captured = captureDiagnostics();
  });

  afterEach(() => {
    captured.stop();
    vi.restoreAllMocks();
  });

  /**
   * The control. Every other test here asserts SILENCE, and silence is what a
   * broken harness produces too — a comparator that stopped being called looks
   * exactly like markup that agrees. This one diverges on purpose, so a green
   * file means "nothing normalizes" rather than "nothing is being checked".
   */
  test("the harness reports a genuine difference (control)", async () => {
    let side = "server";

    class Drifting extends Component {
      render() {
        return (
          <div>
            <span title={side}>hi</span>
          </div>
        );
      }
    }

    const container = await roundTrip(<Drifting />);
    side = "client";
    hydrateRoot(<Drifting />, container);

    expect(captured.coded()).toHaveLength(1);
    expect(captured.coded()[0]).toContain('title="client"');
  });

  test("a broad spread of HTML attributes survives the round-trip silently", async () => {
    class Wide extends Component {
      render() {
        return (
          <div>
            <section
              className="card  is-open"
              id="wide"
              title="Tom & Jerry <hi>"
              lang="en-GB"
              tabIndex={-1}
              data-count={42}
              data-empty=""
              aria-label="a label"
              aria-hidden={true}
              role="region"
            >
              <a href="/about?a=1&b=2" rel="noopener noreferrer">
                link
              </a>
            </section>
          </div>
        );
      }
    }

    const container = await roundTrip(<Wide />);
    hydrateRoot(<Wide />, container);

    expect(captured.coded()).toEqual([]);
  });

  test("an object style compares equal — it always did", async () => {
    class Boxed extends Component {
      render() {
        // Written expecting a mismatch, and there is none: `objectStyleToString`
        // builds `"prop: value; "` per declaration and then `.trim()`s, which
        // removes the trailing SPACE but keeps the semicolon — the same shape
        // the DOM produces. So the object form never had RMD007's bug; only a
        // raw style STRING out of JSX did, which is why the framework's own
        // `display: contents` was the one that got noticed.
        return (
          <div>
            <span style={{ backgroundColor: "red", fontWeight: "bold", marginTop: "4px" }}>hi</span>
          </div>
        );
      }
    }

    const container = await roundTrip(<Boxed />);
    hydrateRoot(<Boxed />, container);

    expect(captured.coded()).toEqual([]);
  });

  test("form attributes and a live value survive the round-trip", async () => {
    class Fields extends Component {
      @state text = "typed";
      render() {
        return (
          <form>
            <div>
              <input type="text" value={this.text} placeholder="name" maxLength={10} />
              <input type="checkbox" checked={true} disabled={true} />
              <button type="submit" name="go" value="1">
                go
              </button>
            </div>
          </form>
        );
      }
    }

    const container = await roundTrip(<Fields />);
    hydrateRoot(<Fields />, container);

    expect(captured.coded()).toEqual([]);
  });

  test("SVG attributes keep their case across the boundary", async () => {
    class Icon extends Component {
      render() {
        // The one place attribute NAMES are case-sensitive. `setAttribute` on an
        // HTML element lowercases the name, and HTML serialization has no case
        // to preserve; SVG goes through setAttributeNS and keeps `viewBox`.
        //
        // Thinner than it should be, and not by choice: `SVGArguments` types
        // only width/height/fill/viewBox, so `strokeWidth`, `cx`, `cy` and `r`
        // do not compile. That is a hole in the public types, not in hydration —
        // see TODO.md.
        return (
          <div>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
              <circle />
            </svg>
          </div>
        );
      }
    }

    const container = await roundTrip(<Icon />);
    hydrateRoot(<Icon />, container);

    expect(captured.coded()).toEqual([]);
  });
});
