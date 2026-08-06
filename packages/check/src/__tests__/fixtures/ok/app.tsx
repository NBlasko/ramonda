import { Component, createContext, bootstrap } from "../framework";
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}
class Shell extends Component {
  render() {
    return <Reader />;
  }
}
class App extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <Shell />;
  }
}
bootstrap(<App />, null);
