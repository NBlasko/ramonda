import { Component, RamondaNode } from "@ramonda/core";
import { $, Var } from "../../css-system";
export class EtEtStrict extends Component {
  toggle = true;
  public override render(): RamondaNode {
    const colorVal: Var<"color"> = this.toggle ? $.color.accent.quiet : $.color.text.primary;
    return (
      <div
        css={@@(
          background-color: yellowgreen;
          color: white;
          padding: $.color.accent.main;
          &:hover {
            color: {colorVal};
            cursor: pointer;
          }
        )}
      >
        Hello
      </div>
    );
  }
}
