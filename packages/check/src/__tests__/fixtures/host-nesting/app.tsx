import { Component, Host, bootstrap } from "@ramonda/core";

const TABLE = "table";

/** Children go straight into the host, so the host IS their parent. */
@Host("table")
class Table extends Component {
  render() {
    return this.props.children;
  }
}

/** The same, with the tag one name away. */
@Host(TABLE)
class NamedTable extends Component {
  render() {
    return this.props.children;
  }
}

/** A host that is NOT a table — a `<tr>` inside this really is misplaced. */
@Host("div")
class Box extends Component {
  render() {
    return this.props.children;
  }
}

/** The host is a div, but the children land inside a table the component renders itself. */
@Host("div")
class WrapsInATable extends Component {
  render() {
    return <table>{this.props.children}</table>;
  }
}

/** The tag is computed, so nothing can say what the parent is. */
@Host((self: Computed) => (self.props.dense ? "table" : "div"))
class Computed extends Component<{ dense?: boolean }> {
  render() {
    return this.props.children;
  }
}

@Host("div")
class Page extends Component {
  render() {
    return (
      <div>
        {/* ✓ The host is a table. */}
        <Table>
          <tr />
        </Table>
        {/* ✓ The same, one name away. */}
        <NamedTable>
          <tr />
        </NamedTable>
        {/* ✗ The host is a div — this row is really misplaced. */}
        <Box>
          <tr />
        </Box>
        {/* ✓ The children land in a table the component renders. */}
        <WrapsInATable>
          <tr />
        </WrapsInATable>
        {/* ✓ Computed — nothing can say. */}
        <Computed>
          <tr />
        </Computed>
        {/* ✗ The control: a plain div in the same render. */}
        <div>
          <tr />
        </div>
      </div>
    );
  }
}

bootstrap(<Page />, null);
