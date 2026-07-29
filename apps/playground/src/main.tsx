import { Component, Hook, bootstrap, state } from "@ramonda/core";

class AppHook extends Hook {
  @state hello = "world";
}

class Foo extends Component {
  @state value = 0;
  increment() {
    this.value = this.value + 1;
  }

  render() {
    return (
      <div>
        <button onClick={this.increment}>{this.value}</button>
      </div>
    );
  }
}

class App extends Component {
  appHook = this.use(AppHook);

  @state isOn = false;

  handleClick() {
    this.isOn = !this.isOn;
  }

  render() {
    return (
      <div>
        <h1>Ramonda Playground 🌸</h1>
        <p>The framework is running.</p>
        <button onClick={this.handleClick}>{this.isOn ? "on" : "off"}</button>
        <Foo />
      </div>
    );
  }
}

// biome-ignore lint/style/noNonNullAssertion: HTMLDivElement exists
bootstrap(<App />, document.querySelector<HTMLDivElement>("#app")!);

/**
 * The devtools panel — the flower badge, or Alt+D.
 *
 * The app has to ask for it. Core loads the panel itself in a development build, but through a
 * dynamic import whose specifier is a VARIABLE marked `@vite-ignore` — deliberately, so
 * `@ramonda/core` does not make `@ramonda/devtools` a resolution requirement for every project
 * that type-checks it. Vite therefore leaves the string alone, the browser tries to fetch
 * `@ramonda/devtools` as a URL, and core's `.catch()` swallows the failure because the panel is
 * genuinely optional. The result is silence: the development logs appear, and no badge does.
 *
 * `import.meta.env.DEV` so a production build drops it.
 */
if (import.meta.env.DEV) void import("@ramonda/devtools");
