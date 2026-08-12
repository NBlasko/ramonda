import { Component, bootstrap } from "../framework";
import { Page as Themed } from "./themed";
import { Page as Plain } from "./plain";

export class App extends Component {
  render() {
    return (
      <div>
        <Themed />
        <Plain />
      </div>
    );
  }
}

bootstrap(<App />, null);
