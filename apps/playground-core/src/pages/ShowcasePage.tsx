import { Component, state } from "@ramonda/core";
import { Counter, Clock, Inputs, HoverCard, DerivedSync, Toast, LifecycleDemo } from "../demos/panels";

export class ShowcasePage extends Component {
  @state source = 1;
  bumpSource() {
    this.source++;
  }
  render() {
    return (
      <div className="page">
        <div className="row">
          <h2>Decorator showcase</h2>
          <button onclick={this.bumpSource}>bump source ({this.source})</button>
        </div>
        <section className="grid">
          <div className="panel">
            <Counter />
          </div>
          <div className="panel">
            <Clock />
          </div>
          <div className="panel">
            <Inputs />
          </div>
          <div className="panel">
            <HoverCard />
          </div>
          <div className="panel">
            <DerivedSync source={this.source} />
          </div>
          <div className="panel">
            <Toast message="Hello from Ramonda" />
          </div>
          <div className="panel">
            <LifecycleDemo />
          </div>
        </section>
      </div>
    );
  }
}
