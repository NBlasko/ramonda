import { Component, Host, bootstrap } from "@ramonda/core";

const TABLE = "table";
const TYPO = "dvi";

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

// ── the host tag itself ───────────────────────────────────────────────────────────────────────

/** ✗ No HTML element, no SVG element, no dash. `createElement` takes it and renders nothing right. */
@Host("dvi")
class Typo extends Component {
  render() {
    return <span>typo</span>;
  }
}

/** ✗ The same, one name away. */
@Host(TYPO)
class NamedTypo extends Component {
  render() {
    return <span>named typo</span>;
  }
}

/** ✗ Not a name the DOM will take at all — core refuses it at runtime, in development only. */
@Host("2col")
class NotAName extends Component {
  render() {
    return <span>not a name</span>;
  }
}

/** ✓ A DASH is the standard's marker for a custom element, and inventing one is the point. */
@Host("my-widget")
class CustomElement extends Component {
  render() {
    return <span>custom</span>;
  }
}

/** ✓ An SVG element, by name AND case. */
@Host("clipPath")
class Clip extends Component {
  render() {
    return <span>svg</span>;
  }
}

/** ✗ The same name lowercased is not the SVG element, and is no HTML one either. */
@Host("clippath")
class Clipped extends Component {
  render() {
    return <span>shouted svg</span>;
  }
}

/** The tag comes from a PROP at the call site — can the walk follow it into the callback? */
@Host((self: FromProps) => self.props.as ?? "div")
class FromProps extends Component<{ as?: string }> {
  render() {
    return this.props.children;
  }
}

@Host("div")
class CallsWithAProp extends Component {
  render() {
    return (
      <div>
        {/* The prop says `dvi`, which is no element — is it read? */}
        <FromProps as="dvi">
          <span>x</span>
        </FromProps>
        {/* And the prop says `table`, so this row would be in the right place. */}
        <FromProps as="table">
          <tr />
        </FromProps>
      </div>
    );
  }
}

bootstrap(<Page />, null);
bootstrap(<CallsWithAProp />, null);
bootstrap(<Typo />, null);
bootstrap(<NamedTypo />, null);
bootstrap(<NotAName />, null);
bootstrap(<CustomElement />, null);
bootstrap(<Clip />, null);
bootstrap(<Clipped />, null);
