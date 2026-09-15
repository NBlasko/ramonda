import { Component, RamondaNode } from "@ramonda/core";
import { $, Var } from "../../css-system";
export class EtEtStrict extends Component {
  toggle = false;
  public override render(): RamondaNode {
    const colorVal: Var<"color"> = this.toggle ? $.color.accent.quiet : $.color.accent.main;
    return (
      <div
        css={@@(
          background-color: activeborder;
          color: white;
          padding: $.space.gutter.normal;
          &:hover {
            color: {colorVal};
          }
        )}
      >
        Hello
      </div>
    );
  }
}
