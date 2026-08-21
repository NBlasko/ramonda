import { Component, createContext, bootstrap } from "@ramonda/core";
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}
class Shell extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <div>{this.props.children}</div>;
  }
}
class App extends Component {
  render() {
    return (
      <Shell>
        <Reader />
      </Shell>
    );
  }
}
bootstrap(<App />, null);
