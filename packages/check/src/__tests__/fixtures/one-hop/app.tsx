import { Component, Select, bootstrap, persist, state } from "@ramonda/core";

import { makeCache, makeHandler } from "./make";

const ROLE = "buton";
const PRIORITY = 5;
const EMPTY = "";
const KEYS: string[] = [];
const GOOD_ROLE = "button";
const REGION = "region";
const BUTTON = "button";
const OFF = "false";

/** Reassigned after it is declared, so the initializer is not what the attribute says. */
let settled = "buton";
settled = "button";

declare const unknownFlag: boolean;

function roleOf(): string {
  return "buton";
}

class Probe extends Component {
  // The DIRECT shape each rule is written against.
  @state directCache = new Map<string, number>();
  @persist directPersist = new Map<string, number>();
  directArrow = () => {};

  // Not reported: a module const holding a plain value is not lossy at all.
  @persist fine = { n: 1 };

  // The same value ONE HOP away.
  @state hopCache = makeCache();
  @persist hopPersist = makeCache();
  hopArrow = makeHandler();

  save() {}

  render() {
    const hopHandler = () => this.save();

    return (
      <div>
        <div>
          {/* `function-built-in-the-markup`: the direct shape, one hop, and the call it may not
              follow — `makeHandler()` is the shape `@memoized` and `debounce` both take. */}
          <button onclick={() => this.save()}>direct handler</button>
          <button onclick={hopHandler}>a handler one hop away</button>
          <button onclick={makeHandler()}>a handler behind a call</button>

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

          {/* Silent on purpose: a `let` can be written again, so its initializer is not what the
              attribute says. Reported as `role="buton"` until it was planted — on an element that
              says `"button"`, which is a false report on correct markup. */}
          <span role={settled} />
          {/* Silent on purpose: a BRANCH has no single answer, and taking the first arm would
              report an element that is right half the time. */}
          <span role={unknownFlag ? "buton" : GOOD_ROLE} />
          {/* Silent on purpose: a CALL is the same problem behind a function — more than one
              `return` and there is no one answer to read. */}
          <span role={roleOf()} />

          {/* The three rules added since this fixture was written, each direct and then one hop. */}
          <section role="region" />
          <section role={REGION} />
          <input aria-label="direct" disabled="false" />
          <input aria-label="one hop" disabled={OFF} />
          <div role="button" onclick={this.save} tabIndex={0} />
          <div role={BUTTON} onclick={this.save} tabIndex={0} />

          {/* Immune BY CONSTRUCTION, and the inventory should say so rather than stay silent.
              There is no one-hop form of any of these to plant: a property NAME, a TAG and the
              presence of an attribute are written in the source and cannot be moved behind a
              `const`. Kept as direct plants so the claim is standing rather than remembered. */}
          <video muted src="/a.mp4" playbackrate={2} />
          <acronym>WWW</acronym>
          <Select value="a">
            <option value="a" selected>
              A
            </option>
          </Select>
        </div>
      </div>
    );
  }
}

bootstrap(<Probe />, null);
