import { Component } from "@ramonda/core";
import { Navigator } from "../../router";

export class TournamentList extends Component {
  render() {
    return <p>list</p>;
  }
}

/** REPORTED: the route it is on is `/tournaments/:id`, which supplies no `:wrong`. */
export class TournamentPage extends Component {
  nav = this.use(Navigator);
  render() {
    return <h1>{this.nav.params("/tournaments/:wrong").wrong}</h1>;
  }
}
