import { Component, RamondaNode } from "@ramonda/core";
export class EtEtStrict extends Component {
  /**
   * A choice between two declared variables, written in the BLOCK.
   *
   * It used to be a hole holding a ternary, and a hole in a declaration is refused: it put a custom
   * property on every element for a value that is one of two. Each `match` arm is its own rule and
   * its own class, so the subject picks between classes that are already in the stylesheet.
   *
   * The arms are `$` paths and need no import, because an arm is CSS — this file imports nothing
   * from `css-system` at all now, which is the rule working. `Var<"color">` is still what an
   * annotation says when the choice is made in TypeScript and handed to `toStyle`.
   */
  tone: "quiet" | "loud" = "quiet";
  public override render(): RamondaNode {
    return (
      <div
        className={@@(
          background-color: yellowgreen;
          color: white;
          padding: $.space.gutter.normal;
          &:hover {
            color: match({this.tone}) {
              quiet => $.color.accent.quiet;
              loud  => $.color.text.primary;
            };
            cursor: pointer;
          }
        )}
      >
        Hello
      </div>
    );
  }
}
