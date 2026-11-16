import { Component, createRoutes } from "@ramonda/core";

class Lost extends Component {
  render() {
    return <p>lost</p>;
  }
}

/** REPORTED: a part no table takes and no outlet is handed. */
export const orphanRoutes = createRoutes({ "/lost": <Lost /> });
