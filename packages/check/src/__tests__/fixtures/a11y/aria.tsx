import { Component, Host, bootstrap } from "../framework";

declare const kind: string;

/**
 * The ARIA vocabulary rules: a name that is not in it, a role that is not one, and both on an
 * element that cannot carry either.
 */
@Host("div")
class Vocabulary extends Component {
  render() {
    return (
      <div>
        {/* REPORTED — the case is wrong, so this is a different attribute that nothing reads. */}
        <span aria-labelledBy="title" />
        {/* REPORTED — one character out. */}
        <span aria-requred="true" />
        {/* REPORTED — not in the vocabulary at all, and near nothing. */}
        <span aria-sparkle="yes" />
        {/* Not reported. The role is written because a `<span>` is `generic`, which takes no
            name — that is a different rule, and this file is about the names of attributes. */}
        <span role="note" aria-labelledby="title" aria-hidden="true" />

        {/* REPORTED — not a role. */}
        <div role="tabpane" />
        {/* REPORTED — abstract, and the spec forbids it in markup. */}
        <div role="widget" />
        {/* Not reported: a real role, and a fallback chain of real ones. */}
        <div role="button" />
        <div role="none presentation" />
        {/* Not reported: nothing here can read it. */}
        <div role={kind} />

        {/* REPORTED — twice, once for each attribute. */}
        <title role="none" aria-hidden="true" />
        {/* Not reported: an ordinary element may carry both. */}
        <span role="note" aria-hidden="true" />
      </div>
    );
  }
}

bootstrap(<Vocabulary />, null);
