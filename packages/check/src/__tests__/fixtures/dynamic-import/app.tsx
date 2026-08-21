import { Component, bootstrap } from "@ramonda/core";
import { known } from "./loaders";

class App extends Component {
  render() {
    void known;
    return <span>app</span>;
  }
}

bootstrap(<App />, null);
