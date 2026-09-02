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

/** PLANT: an alias for a FUNCTION. One hop, and the same fault. */
const AliasedFn = SideBar;

/**
 * Silent, and it must TERMINATE: two aliases that genuinely point at each other.
 *
 * The first version of this plant was `const Loop = undefined as unknown` beside `const Ring = Loop
 * as never`, which is not a cycle at all — both initializers are casts, so the walk stopped before
 * taking a single hop and the test passed for the wrong reason. These two are identifiers, so the
 * walk really does go round: Ring to Loop to Ring, and the `seen` set is what ends it.
 *
 * TypeScript would call this a use-before-declaration; the fixtures are excluded from the
 * type-check (`tsconfig.json`), and the analyzer does not typecheck by design.
 */
// @ts-expect-error a deliberate cycle, so the walk has something to terminate on
const Ring = Loop;
// @ts-expect-error the other half of it
const Loop = Ring;

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
        <AliasedFn />
        <Ring />
        <kit.Link />
        {/* Silent: called in an expression slot, which is the recommended shape. */}
        {SideBar()}
        <p>text</p>
      </div>
    );
  }
}

bootstrap(<Page />, null);
