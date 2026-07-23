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
