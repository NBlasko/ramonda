import { bootstrap, Component } from "../framework";

/** ✗ Vite's prefix, which Ramonda's build no longer exposes — the migration hazard. */
export class FromVite extends Component {
  render() {
    return <p>{import.meta.env.VITE_API_URL}</p>;
  }
}

/** ✗ No prefix at all: a name nothing ever exposed. */
export class NoPrefix extends Component {
  render() {
    return <p>{import.meta.env.API_BASE}</p>;
  }
}

/** ✗ Ramonda's prefix WITHOUT `PUBLIC` — the one that reads like it should work. */
export class RamondaButNotPublic extends Component {
  render() {
    return <p>{import.meta.env.RAMONDA_API_BASE}</p>;
  }
}

// ── everything below is CORRECT and must stay silent ─────────────────────────────────────────

/** The exposed prefix. */
export class Exposed extends Component {
  render() {
    return <p>{import.meta.env.RAMONDA_PUBLIC_API_BASE}</p>;
  }
}

/** The bundler's own names, which are always available whatever the prefix is. */
export class BuiltIns extends Component {
  render() {
    return (
      <p>
        {String(import.meta.env.DEV)}
        {String(import.meta.env.PROD)}
        {import.meta.env.MODE}
        {import.meta.env.BASE_URL}
        {String(import.meta.env.SSR)}
      </p>
    );
  }
}

/** A computed key cannot be read, so it is not judged. */
declare const which: string;
export class Computed extends Component {
  render() {
    return <p>{import.meta.env[which]}</p>;
  }
}

/** An author who said why. The annotation is this package's own, and it is honoured. */
export class Annotated extends Component {
  render() {
    // ramonda-check-ignore this app is mid-migration and still reads the old name on purpose
    return <p>{import.meta.env.VITE_LEGACY}</p>;
  }
}

export class App extends Component {
  render() {
    return (
      <main>
        <FromVite />
        <NoPrefix />
        <RamondaButNotPublic />
        <Exposed />
        <BuiltIns />
        <Computed />
        <Annotated />
      </main>
    );
  }
}

bootstrap(<App />, null);
