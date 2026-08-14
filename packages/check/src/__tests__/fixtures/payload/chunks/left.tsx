import { Component } from "../../framework";
import { Shared } from "../shared";

class OnlyLeft extends Component {
  render() {
    return <span>left</span>;
  }
}

export class Page extends Component {
  render() {
    return (
      <div>
        <Shared />
        <OnlyLeft />
      </div>
    );
  }
}
