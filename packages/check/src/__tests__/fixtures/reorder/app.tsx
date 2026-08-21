import { Component, createContext, bootstrap } from "@ramonda/core";
const [ThemeProvider, ThemeConsumer] = createContext({ theme: "light" }, { label: "Theme" });

class Reader extends Component {
  ctx = this.use(ThemeConsumer);
  render() {
    return <span>x</span>;
  }
}
class Sidebar extends Component {
  p = this.use(ThemeProvider);
  render() {
    return <span>side</span>;
  }
}
class App extends Component {
  render() {
    return (
      <div>
        <Reader />
        <Sidebar />
      </div>
    );
  }
}
bootstrap(<App />, null);
