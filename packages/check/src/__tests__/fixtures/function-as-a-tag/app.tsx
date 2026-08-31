import { Component, bootstrap } from "@ramonda/core";
import { Imported } from "./make";

/** REPORTED — a function declaration in tag position. */
function SideBar() {
  return <p>side</p>;
}

/** REPORTED — the arrow form, which is how it is written more often. */
const Footer = () => <p>foot</p>;

/**
 * REPORTED — several nodes back, and `TS2786` as well.
 *
 * NOT because an array is disallowed: a COMPONENT returning `[<td/>, <td/>]` is the framework's
 * headline case and compiles, and so does `{rows()}` in an expression slot. It is refused only in
 * TAG position, where TypeScript's default rule asks for one `JSX.Element` — measured on all three.
 */
function Many() {
  return [<p>a</p>, <p>b</p>];
}

/** Silent: a class is a component, which is the whole point. */
class Card extends Component {
  render() {
    return <p>card</p>;
  }
}

/** Silent: an alias for a class is still a class. */
const Aliased = Card;

/** Silent: a value read off something is not knowable from here. */
declare const kit: { Link: typeof Card };

class Page extends Component {
  render() {
    return (
      <div>
        <SideBar />
        <Footer />
        <Many />
        <Imported />

        <Card />
        <Aliased />
        <kit.Link />
        {/* Silent: called in an expression slot, which is the recommended shape. */}
        {SideBar()}
        <p>text</p>
      </div>
    );
  }
}

bootstrap(<Page />, null);
