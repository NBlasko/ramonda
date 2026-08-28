import { Component, list, state, compute } from "@ramonda/core";

// @compute caches a derived value and recomputes it only when something it read
// actually changed. It works on a method or on a getter — both are cached the
// same way, so pick whichever reads better at the call site.
//
// The cache tracks READS, not declarations. `total` reads `items`, so adding an
// item invalidates it; typing in the filter box does not, because `total` never
// reads `filter`. Nothing declares that — it follows from the body.
export class ComputeDemo extends Component {
  @state items = [
    { name: "apples", price: 3 },
    { name: "bread", price: 2 },
    { name: "coffee", price: 9 },
  ];
  @state filter = "";

  // Plain fields, deliberately NOT @state. A @compute must be a pure function of
  // what it reads — writing reactive state while deriving is a mistake the
  // framework reports (RMD018). These counters just tick when the body actually
  // runs; render re-runs on the same changes and reads their latest value. They
  // are a teaching instrument, nothing a real derived value needs.
  totalRuns = 0;
  visibleRuns = 0;

  @compute get total() {
    this.totalRuns++;
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }

  @compute get visible() {
    this.visibleRuns++;
    const filter = this.filter.toLowerCase();
    return this.items.filter((item) => item.name.includes(filter));
  }

  addItem() {
    this.items = [...this.items, { name: "tea", price: 4 }];
  }

  onFilter(event: Event) {
    this.filter = (event.target as HTMLInputElement).value;
  }

  renderItem(item: { name: string; price: number }) {
    return (
      <li>
        {item.name} — {item.price}
      </li>
    );
  }

  render() {
    return (
      <div>
        <div>
          <p className="demo-row">
            <input
              type="text"
              aria-label="Filter the items"
              placeholder="filter"
              value={this.filter}
              oninput={this.onFilter}
            />
            <button type="button" onclick={this.addItem}>
              add an item
            </button>
          </p>
          <ul className="demo-log">{list(this.visible, this.renderItem)}</ul>
          <p className="demo-row">
            <span>
              total: <strong>{this.total}</strong>
            </span>
            <span className="demo-note">
              total computed {this.totalRuns}× · visible computed {this.visibleRuns}× — typing in the filter recomputes
              only one of them
            </span>
          </p>
        </div>
      </div>
    );
  }
}
