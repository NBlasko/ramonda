import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getDOM } from "../test/setup";
import { Component, Hook, createRef } from "../index";
import { compute, memoized, state } from "../base/decorators";
import { resetDiagnostics } from "../debug/diagnostics";

/**
 * RMD061 — a ref built where its identity cannot survive.
 *
 * A ref is an IDENTITY: the caller keeps it and reads `current` later. `createRef()` hands back a
 * new object every call, so one built inside a render, a `@compute`, a `@memoized` member or a
 * hook's props callback is a different ref on every pass. Two costs, and the second is the one that
 * surprises: the child is handed a changed `ref` every parent render — which IS a props change now,
 * see `helpers/arePropsBagsEqual.ts` — so it re-renders for nothing; and the ref the author meant to
 * read is replaced before they can, because nothing kept a reference to it.
 *
 * The phase is named because that is where the reader has to look. It is ONE message rather than
 * `RMD021`'s four, because unlike a random number the fault does not differ by phase: a ref belongs
 * on a field in every one of them.
 */
let messages: string[];
let stop: () => void;

beforeEach(() => {
  resetDiagnostics();
  messages = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { message: string };
    if (detail.message.startsWith("[RMD061]")) messages.push(detail.message);
  };
  window.addEventListener("ramonda:dev-log", handler);
  stop = () => window.removeEventListener("ramonda:dev-log", handler);
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe("RMD061", () => {
  test("a ref built in a render names the component", async () => {
    class Editor extends Component {
      render() {
        const held = createRef<HTMLParagraphElement>();
        return <p ref={held}>x</p>;
      }
    }

    await getDOM(<Editor />);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("<Editor /> was rendering");
    expect(messages[0]).toContain("a new object every time");
  });

  test("a ref built in a @compute names the member", async () => {
    class Editor extends Component {
      @state n = 1;
      @compute get held() {
        void this.n;
        return createRef<HTMLParagraphElement>();
      }
      render() {
        return <p ref={this.held}>x</p>;
      }
    }

    await getDOM(<Editor />);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("while computing");
    expect(messages[0]).toContain("held");
  });

  test("a ref built in a @memoized member names the member", async () => {
    class Editor extends Component {
      @memoized pick(which: string) {
        return { which, ref: createRef<HTMLParagraphElement>() };
      }
      render() {
        return <p ref={this.pick("a").ref}>x</p>;
      }
    }

    await getDOM(<Editor />);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("memoised");
    expect(messages[0]).toContain("pick");
  });

  test("a ref built in a hook's props callback names the bag", async () => {
    class Store extends Hook<{ held: unknown }> {
      read() {
        return this.props.held;
      }
    }
    class Editor extends Component {
      store = this.use(Store, () => ({ held: createRef<HTMLParagraphElement>() }));
      render() {
        return <p>{String(this.store.read() !== undefined)}</p>;
      }
    }

    await getDOM(<Editor />);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain("building a hook's props");
    expect(messages[0]).toContain("Store");
  });

  /** The place a ref belongs, and the shape `Select` and `TextArea` use. */
  test("a ref on a field says nothing, callback or not", async () => {
    class Editor extends Component {
      private plain = createRef<HTMLParagraphElement>();
      private told = createRef<HTMLSpanElement>((node) => {
        this.arrived = node !== null;
      });
      arrived = false;
      render() {
        return (
          <p ref={this.plain}>
            <span ref={this.told}>x</span>
          </p>
        );
      }
    }

    const app = await getDOM<Editor>(<Editor />);
    await app.settle();

    expect(messages).toEqual([]);
    // And the callback form did its job: the field learnt the node arrived.
    expect(app.instance.arrived).toBe(true);
  });

  /** Outside every phase — a click handler, an interval, a promise — is nobody's business. */
  test("a ref built outside a pure phase says nothing", () => {
    const held = createRef<HTMLParagraphElement>();
    expect(held.current).toBeNull();
    expect(messages).toEqual([]);
  });
});
