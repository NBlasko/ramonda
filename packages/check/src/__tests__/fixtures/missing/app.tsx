import { Component, createContext, bootstrap, h } from "../framework";
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}
class App extends Component {
  render() {
    return <Reader />;
  }
}
bootstrap(<App />, null);
