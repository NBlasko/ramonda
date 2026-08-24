import { Component, bootstrap, list } from "@ramonda/core";

declare const rows: { id: string; name: string }[];

/**
 * Every shape `index-as-key` has an opinion about, beside every shape it must not.
 *
 * The pairing is the test: a rule that reports `key={i}` and also reports
 * `` key={`${row.id}-${i}`} `` has not found a fault, it has found lists.
 */
class Table extends Component {
  render() {
    return (
      <div>
        <div>
          {/* REPORTED — the index, and nothing else. */}
          <ul>
            {rows.map((row, i) => (
              <li key={i}>{row.name}</li>
            ))}
          </ul>
          {/* REPORTED — the same fact through a call. */}
          <ul>
            {rows.map((row, i) => (
              <li key={String(i)}>{row.name}</li>
            ))}
          </ul>
          {/* REPORTED — the same fact in a template. */}
          <ul>
            {rows.map((row, i) => (
              <li key={`row-${i}`}>{row.name}</li>
            ))}
          </ul>
          {/* REPORTED — arithmetic on the index is still the index. */}
          <ul>
            {rows.map((row, i) => (
              <li key={i + 1}>{row.name}</li>
            ))}
          </ul>
          {/* REPORTED — `flatMap` hands out an index too. */}
          <ul>
            {rows.flatMap((row, i) => (
              <li key={i}>{row.name}</li>
            ))}
          </ul>

          {/* Not reported: an identity from the data. */}
          <ul>
            {rows.map((row) => (
              <li key={row.id}>{row.name}</li>
            ))}
          </ul>
          {/* Not reported: the index is there, but so is something that tells rows apart. */}
          <ul>
            {rows.map((row, i) => (
              <li key={`${row.id}-${i}`}>{row.name}</li>
            ))}
          </ul>
          {/* Not reported: no key at all — that is `row-without-a-key`, and a different report. */}
          <ul>
            {rows.map((row) => (
              <li>{row.name}</li>
            ))}
          </ul>
          {/* Not reported: `list()` hands its callback one argument, so there is no index to misuse. */}
          <ul>
            {list(rows, (row) => (
              <li key={row.id}>{row.name}</li>
            ))}
          </ul>
          {/* Not reported: not built from data at all. */}
          <li key="header">Name</li>
        </div>
      </div>
    );
  }
}

bootstrap(<Table />, null);
