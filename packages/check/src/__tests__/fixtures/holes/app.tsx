import { Component, Hook, bootstrap } from "../framework";

class Counter extends Hook {
  n = 0;
}

class Reader extends Component {
  render() {
    return <span>x</span>;
  }
}

// A component held in a variable. The tag names the VARIABLE, and following it means reading a
// value rather than a declaration — so the edge is recorded as a hole with its reason rather than
// being left out, which is the difference between a map with a blank marked and one without.
const Alias = Reader;

class App extends Component {
  counter = this.use(Counter);
  render() {
    return <Alias />;
  }
}

bootstrap(<App />, null);
