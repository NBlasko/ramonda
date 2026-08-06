import { Component, bootstrap, catchError, h, Host, ShouldUpdateOnPropsChange } from "../framework";

// Two answers to "who handles an error from below?" — the first never runs.
@Host("div")
class Twice extends Component {
  @catchError logIt() {}
  @catchError showFallback() {}
  render() {
    return h("i", null);
  }
}

// Two class decorators of the same single-use kind.
@ShouldUpdateOnPropsChange(() => true)
@ShouldUpdateOnPropsChange(() => false)
@Host("div")
class GatedTwice extends Component {
  render() {
    return h("i", null);
  }
}

// The BASE declares one; the subclass overrides it. Not a duplicate.
@Host("div")
class Base extends Component {
  @catchError handle() {}
  render() {
    return h("i", null);
  }
}

@Host("div")
class Sub extends Base {
  @catchError ownHandle() {}
}

// One of each: silent.
@ShouldUpdateOnPropsChange(() => true)
@Host("div")
class Fine extends Component {
  @catchError handle() {}
  render() {
    return h("i", null);
  }
}

class App extends Component {
  render() {
    return h("div", null, h(Twice, null), h(GatedTwice, null), h(Sub, null), h(Fine, null));
  }
}

bootstrap(h(App, null), null);
