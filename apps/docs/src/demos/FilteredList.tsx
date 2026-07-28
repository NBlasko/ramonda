import { Component, Host, state, compute, list } from "@ramonda/core";

interface Person {
  name: string;
  role: string;
}

// One row, with state of its own — a star. That is what makes the point of this
// demo visible: star a row, then filter OTHER rows away, and the survivor keeps
// its own star exactly where it belongs — it never inherits the star of a row
// the filter removed, which is the thing positional `.map()` gets wrong.
@Host("li")
class PersonRow extends Component<{ item: Person }> {
  @state starred = false;

  toggleStar() {
    this.starred = !this.starred;
  }

  render() {
    return (
      <span>
        <button type="button" className="star" aria-pressed={this.starred ? "true" : "false"} onClick={this.toggleStar}>
          {this.starred ? "★" : "☆"}
        </button>{" "}
        {this.props.item.name} <span className="demo-note">{this.props.item.role}</span>
      </span>
    );
  }
}

@Host("div")
export class FilteredList extends Component {
  // The objects are created once and never replaced, so their identity is stable
  // — which is why a filtered view of them needs no key.
  @state people: Person[] = [
    { name: "Ada", role: "compilers" },
    { name: "Grace", role: "runtimes" },
    { name: "Edsger", role: "semantics" },
    { name: "Barbara", role: "genomics" },
    { name: "Katherine", role: "trajectories" },
  ];
  @state query = "";

  // The visible rows are DERIVED, not stored. @compute recomputes this only when
  // `people` or `query` changes, and it returns a subset of the SAME objects —
  // so every surviving row is, by identity, the same row it was before.
  @compute get visible() {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.people;
    return this.people.filter(
      (person) => person.name.toLowerCase().includes(q) || person.role.toLowerCase().includes(q),
    );
  }

  onInput(event: Event) {
    this.query = (event.target as HTMLInputElement).value;
  }

  render() {
    return (
      <div>
        <p className="demo-row">
          <input type="text" placeholder="filter by name or role" value={this.query} onInput={this.onInput} />
          <span className="demo-note">
            star a row, then filter — a row that stays keeps its own star, and no row inherits one from a person the
            filter removed
          </span>
        </p>
        {/*
          `each` is bound to the DERIVED array, read the moment the list is built,
          so it is always the current filter. No key: the objects are the same
          references a filter selected, so identity already holds.
        */}
        <ul className="demo-list">{list({ each: this.visible, as: PersonRow })}</ul>
        {this.visible.length === 0 ? <p className="demo-note">No one matches “{this.query}”.</p> : null}
      </div>
    );
  }
}
