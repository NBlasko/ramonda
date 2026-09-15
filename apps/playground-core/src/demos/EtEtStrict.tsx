import { Component, RamondaNode } from "@ramonda/core";

export class EtEtStrict extends Component {
  public override render(): RamondaNode {
    return (
      <div
        css={@@(
          background-color: activeborder;
          color: white;
          padding: $.space.gutter.normal;
        )}
      >
        Hello
      </div>
    );
  }
}
