import { Component, Hook, createContext } from "@ramonda/core";
import { Fetching } from "./installed";
import { pollingBag } from "./helpers";

class Poll extends Hook<{ every: number; onTick?: () => void }> {}
/** A hook whose props take any name — an index — and one whose props say nothing. */
class Loose extends Hook<Record<string, unknown>> {}
class Untyped extends Hook<any> {}
/** Props that are one of two shapes: a name either shape has is known. */
class Either extends Hook<{ mode: "a"; a: number } | { mode: "b"; b: number }> {}

const [ThemeProvider] = createContext({ colour: "slate" });

const NOINDEX = { every: 1, robots: "noindex" };

class Reported extends Component {
  // 1. a typo of a name it takes: the report suggests it.
  typo = this.use(Poll, () => ({ evry: 5 }));
  // 2. a name nothing like any it takes: the report lists them.
  foreign = this.use(Poll, () => ({ every: 5, robots: "noindex" }));
  // 3. through a declaration file, the way an installed package's hook is reached.
  installed = this.use(Fetching, () => ({ key: ["x"], fetch: async () => 1, staleTimee: 5 }));
  // 4. a block body with a return.
  block = this.use(Poll, () => {
    const every = 5;
    return { every, everyMs: 1 };
  });
  // 5. a local one line up.
  local = this.use(Poll, () => {
    const bag = { every: 5, tick: 1 };
    return bag;
  });
  // 6. a module const.
  moduleConst = this.use(Poll, () => NOINDEX);
  // 7. a helper in another file.
  helper = this.use(Poll, () => pollingBag());
  // 8. one arm of a branch.
  branch = this.use(Poll, (self: Reported) => (self.flag ? { every: 1 } : { every: 2, paused: true }));
  // 9. after a spread: the written name is still not one it takes.
  afterSpread = this.use(Poll, () => ({ ...NOINDEX, every: 2, interval: 3 }));
  // 10. a context Provider's value.
  provider = this.use(ThemeProvider, () => ({ colour: "amber", color: "amber" }));
  // 11. a method written in the bag is a name too.
  method = this.use(Poll, () => ({ every: 1, onTic() {} }));
  flag = false;
  render() {
    return null;
  }
}

class Silent extends Component {
  ok = this.use(Poll, () => ({ every: 5, onTick: this.tick }));
  loose = this.use(Loose, () => ({ anything: 1 }));
  untyped = this.use(Untyped, () => ({ anything: 1 }));
  either = this.use(Either, () => ({ mode: "b" as const, b: 1 }));
  computed = this.use(Poll, () => ({ every: 1, ["on" + "Tick"]: this.tick }));
  passed = this.use(Poll, (self: Silent) => self.bag);
  installedOk = this.use(Fetching, () => ({ key: ["x"], fetch: async () => 1, staleTime: 5 }));
  bag = { every: 1 };
  tick() {}
  render() {
    return null;
  }
}

export { Reported, Silent };
