import { describe, test, expect, beforeEach } from "vitest";
import { getDOM } from "../../test/setup";
import { mounted, state, created, destroyed } from "../../base/decorators";
import { Component } from "../../base/Component";
import { createContext } from "../../base/Context";
import { effectLike } from "../../test/effectLike";

describe("Context API: Lazy Selectors & Lifecycle", () => {
  let log: string[] = [];

  interface AppState {
    counter: number;
    theme: string;
  }

  const [AppProvider, AppConsumer] = createContext<AppState>({
    counter: 0,
    theme: "light",
  });

  beforeEach(() => {
    log = [];
  });

  /**
   * Komponenta koja prati temu.
   */
  class ThemeWatcher extends Component {
    data = this.use(AppConsumer);
    render() {
      log.push(`Render:ThemeWatcher:${this.data.theme}`);
      return <div>{this.data.theme}</div>;
    }
  }

  /**
   * Komponenta sa kompleksnim lifecycle-om koja prati counter.
   */
  class ComplexCounterWatcher extends Component {
    data = this.use(AppConsumer);

    @created init() {
      log.push(`Unit:Complex:${this.data.counter}`);
    }

    @destroyed dispose() {
      log.push("Unit:Cleanup");
    }

    @mounted mounted() {
      log.push(`Mount:Complex:${this.data.counter}`);
    }

    @effectLike() onCounterChange() {
      log.push(`Effect:Complex:${this.data.counter}`);
    }

    render() {
      log.push(`Render:Complex:${this.data.counter}`);
      return <div>{this.data.counter}</div>;
    }
  }

  class RootApp extends Component {
    @state count = 0;
    @state theme = "light";
    @state showComplex = true;

    // Provider is now a hook: it publishes the value onto this component's
    // context, which the children below inherit (through the wrapping <div>).
    ctx = this.use(AppProvider, () => ({ counter: this.count, theme: this.theme }));

    render() {
      return (
        <div>
          <ThemeWatcher />
          {this.showComplex && <ComplexCounterWatcher />}
        </div>
      );
    }
  }

  test("Should demonstrate isolated rendering and correct lifecycle access", async () => {
    const { instance, settle } = await getDOM<RootApp>(<RootApp />);
    await settle();

    // 1. Inicijalno stanje
    expect(log).toContain("Unit:Complex:0");
    expect(log).toContain("Render:ThemeWatcher:light");
    expect(log).toContain("Render:Complex:0");
    expect(log).toContain("Mount:Complex:0");
    expect(log).toContain("Effect:Complex:0");

    log = [];

    // 2. Change 'counter'. ComplexCounterWatcher reads it, so it must render;
    //    ThemeWatcher does not, so it must NOT move.
    instance.count = 55;
    await settle();

    // ComplexWatcher reacts.
    expect(log).toContain("Effect:Complex:55");
    expect(log).toContain("Render:Complex:55");

    // The point of the whole test: ThemeWatcher stayed isolated.
    const themeRenders = log.filter((l) => l.startsWith("Render:ThemeWatcher"));
    expect(themeRenders.length).toBe(0); // Lazy selective context, confirmed.

    log = [];

    // 3. Change 'theme'. Now the mirror image: ThemeWatcher renders and
    //    ComplexCounterWatcher does not.
    instance.theme = "dark";
    await settle();

    expect(log).toContain("Render:ThemeWatcher:dark");

    // ComplexWatcher nije dotakao 'theme' u renderu ili efektu, pa ostaje miran
    const complexRenders = log.filter((l) => l.startsWith("Render:Complex"));
    expect(complexRenders.length).toBe(0);

    log = [];

    // 4. SCENARIO: Unmount
    instance.showComplex = false;
    await settle();
    expect(log).toContain("Unit:Cleanup");
  });
});
