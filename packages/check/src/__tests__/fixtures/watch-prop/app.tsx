import { Component, Host, bootstrap, watchProp } from "../framework";
import type { BadgeProps, MergedProps, OpenProps, ProfileProps } from "./props";

declare const key: string;

/* REPORTED — `usrId` is a typo for `userId`, and the method would never have run. */
@Host("div")
class Profile extends Component<ProfileProps> {
  @watchProp((p) => p.usrId)
  onUser() {}

  /* Not reported: a prop that is really there. */
  @watchProp((p) => p.theme)
  onTheme() {}

  /* Not reported: `key` is on every component's props whatever the type says. */
  @watchProp((p) => p.key)
  onKey() {}

  render() {
    return <div />;
  }
}

/* An inline props type, read the same way. */
@Host("div")
class Panel extends Component<{ title: string; open: boolean }> {
  /* REPORTED — element access is the same read, spelled differently. */
  @watchProp((p) => p["titel"])
  onTitle() {}

  /* REPORTED — destructuring names the prop just as plainly. */
  @watchProp(({ opened }) => opened)
  onOpen() {}

  /* Not reported: only the FIRST level is a prop; what is inside `title` is not this rule's business. */
  @watchProp((p) => p.title.length)
  onLength() {}

  /* Not reported: two selectors, both real. */
  @watchProp(
    (p) => p.title,
    (p) => p.open,
  )
  onBoth() {}

  render() {
    return <div />;
  }
}

/* An alias for a literal. */
@Host("div")
class Badge extends Component<BadgeProps> {
  /* REPORTED. */
  @watchProp((p) => p.total)
  onTotal() {}

  render() {
    return <div />;
  }
}

/* Not reported at all: an intersection hides members, so the whole class is left alone. */
@Host("div")
class Merged extends Component<MergedProps> {
  @watchProp((p) => p.nothingLikeThis)
  onIt() {}

  render() {
    return <div />;
  }
}

/* Not reported at all: an index signature makes every name a real prop. */
@Host("div")
class Open extends Component<OpenProps> {
  @watchProp((p) => p.whateverYouLike)
  onIt() {}

  render() {
    return <div />;
  }
}

/* Not reported at all: no type argument, so nothing here is certain. */
@Host("div")
class Bare extends Component {
  @watchProp((p) => p.mystery)
  onIt() {}

  render() {
    return <div />;
  }
}

/* Not reported: a selector this cannot read names nothing statically. */
@Host("div")
class Dynamic extends Component<{ a: string }> {
  @watchProp((p) => p[key])
  onIt() {}

  render() {
    return <div />;
  }
}

bootstrap(<Profile />, null);
bootstrap(<Panel />, null);
bootstrap(<Badge />, null);
bootstrap(<Merged />, null);
bootstrap(<Open />, null);
bootstrap(<Bare />, null);
bootstrap(<Dynamic />, null);
