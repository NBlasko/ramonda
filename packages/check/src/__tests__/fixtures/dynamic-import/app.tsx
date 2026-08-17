import { Component, bootstrap } from "../framework";
import { known } from "./loaders";

class App extends Component {
  render() {
    void known;
    return <span>app</span>;
  }
}

bootstrap(<App />, null);
