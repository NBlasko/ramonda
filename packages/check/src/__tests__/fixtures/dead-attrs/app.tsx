import { Component, bootstrap } from "@ramonda/core";

/**
 * Attributes that reach the DOM verbatim and do nothing.
 *
 * The types refuse every one of these at the call site, so this fixture is what somebody sees after
 * a `@ts-ignore` — which is the only way to get here, and the reason the rule exists at all.
 *
 * Measured rather than listed from memory: one render of every camelCase name a JSX author might
 * reach for, reading back what landed in the document.
 */
class Page extends Component {
  render() {
    return (
      <div>
        <div>
          {/* REPORTED — the real attribute has a hyphen. */}
          <meta httpEquiv="refresh" content="5" />
          <form acceptCharset="utf-8" />
          {/* REPORTED — lowercase is exactly as dead, and passes the types through the index signature. */}
          <form acceptcharset="utf-8" />
          {/* REPORTED — a controlled/uncontrolled pair this framework does not have, so no attributes at all. */}
          <input defaultValue="v" />
          <input defaultChecked="true" />
          {/* REPORTED — properties, not attributes. */}
          <div innerHTML="<p>x</p>" />
          <span textContent="hi" />

          {/* Not reported: the correct spellings. */}
          <meta http-equiv="refresh" content="5" />
          <form accept-charset="utf-8" />
          <input value="v" checked="true" readOnly="true" maxLength="5" />
          {/* Not reported: the two names that ARE aliased, because they are reserved words. */}
          <div className="x" />
          <label htmlFor="a" />
          {/* Not reported: a component's props are its own business, not the DOM's. */}
          <Page defaultValue="v" />
        </div>
      </div>
    );
  }
}

bootstrap(<Page />, null);
