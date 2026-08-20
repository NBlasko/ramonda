import { Component, Host, bootstrap, persist, state } from "../framework";

import { makeCache, makeHandler } from "./make";

const ROLE = "buton";
const PRIORITY = 5;
const EMPTY = "";
const KEYS: string[] = [];

@Host("div")
class Probe extends Component {
  // The DIRECT shape each rule is written against.
  @state directCache = new Map<string, number>();
  @persist directPersist = new Map<string, number>();
  directArrow = () => {};

  // The same value ONE HOP away.
  @state hopCache = makeCache();
  @persist hopPersist = makeCache();
  hopArrow = makeHandler();

  render() {
    return (
      <div>
        {/* direct */}
        <span role="buton" />
        <button tabIndex={5}>a</button>
        <a href="">b</a>
        {KEYS.map((k, i) => (
          <span key={i}>{k}</span>
        ))}

        {/* one hop */}
        <span role={ROLE} />
        <button tabIndex={PRIORITY}>c</button>
        <a href={EMPTY}>d</a>
      </div>
    );
  }
}

bootstrap(<Probe />, null);
