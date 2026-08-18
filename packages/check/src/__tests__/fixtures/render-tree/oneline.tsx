import { bootstrap, Component } from "@ramonda/core";

/**
 * Both faults written on ONE line, which is where the reports' wording had to change: written only
 * as "line N", each of them sent a reader to the line they were already looking at.
 */
export class OneLine extends Component {
  render() {
    // biome-ignore format: one line is the point — reformatting this fixture removes the case.
    return <form><input id="a" /><input id="a" /><h1>T</h1><h3>S</h3></form>;
  }
}

bootstrap(<OneLine />, null);
