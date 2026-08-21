import { bootstrap, Component, state } from "@ramonda/core";
import { created } from "@ramonda/core";
import { created as onCreate } from "@ramonda/core";
import { ConfigBase } from "./shared-base";

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

/** ✗ The same read, spelled three other ways. */
export class OtherSpellings extends Component {
  render() {
    const { DATABASE_URL } = process.env;
    const bracketed = process.env["REGION"];
    const viaGlobal = globalThis.process.env.API_KEY;
    return <p>{`${DATABASE_URL}${bracketed}${viaGlobal}`}</p>;
  }
}

/**
 * ✓ Annotated. A CLASS rule could not be answered at all until the annotation reached every family:
 * `server-env-in-shared-code` is an ERROR, and when it was wrong the only way out was restructuring
 * code that was already right.
 */
export class ReadsWithAReason extends Component {
  @state url = "";

  read() {
    // ramonda-check-ignore this bundle is built for the server only, and the plugin defines process
    this.url = process.env.DATABASE_URL ?? "";
  }

  render() {
    return <p>{this.url}</p>;
  }
}

/** ✗ An EMPTY directive buys nothing — reported, and the empty directive is reported too. */
export class ReadsWithNoReason extends Component {
  @state url = "";

  read() {
    // ramonda-check-ignore
    this.url = process.env.DATABASE_URL ?? "";
  }

  render() {
    return <p>{this.url}</p>;
  }
}

// ── everything below is CORRECT and must stay silent ─────────────────────────────────────────

/**
 * ✓ Server-only, said through an ALIASED `@created`.
 *
 * The table of what each lifecycle does is a LOOKUP, so the local name is not merely a weaker key
 * here — it is the wrong one. Read as `onCreate` it found nothing in the table, the member was not
 * excused, and this correct code was reported at error severity.
 */
export class AliasedServerOnly extends Component {
  @state url = "";

  @onCreate({ env: "server" })
  read() {
    this.url = process.env.DATABASE_URL ?? "";
  }

  render() {
    return <p>{this.url}</p>;
  }
}

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

/** ✗ `process.env` in render(), which runs on both sides — `process` does not exist in a browser. */
export class ReadsProcessInRender extends Component {
  render() {
    return <p>{process.env.DATABASE_URL}</p>;
  }
}

/** ✗ A field initialiser also runs on both sides. */
export class ReadsProcessInAField extends Component {
  private url = process.env.DATABASE_URL;
  render() {
    return <p>{this.url}</p>;
  }
}

/** ✗ A bare `@created()` defaults to `shared`, so the browser runs it too. */
export class ReadsProcessInSharedCreate extends Component {
  @state region = "";
  @created()
  read() {
    this.region = process.env.REGION ?? "";
  }
  render() {
    return <p>{this.region}</p>;
  }
}

/** The one excuse: explicitly server-only, with the answer kept in state. */
export class ReadsProcessOnTheServer extends Component {
  @state region = "";
  @created({ env: "server" })
  read() {
    this.region = process.env.REGION ?? "";
  }
  render() {
    return <p>{this.region}</p>;
  }
}

/**
 * The shape this rule's own advice recommends, once the read is factored out. `fromDb` is reached only
 * from a server-only lifecycle, so the browser never runs it either.
 */
export class DelegatesToAHelper extends Component {
  @state data = "";
  @created({ env: "server" })
  load() {
    this.data = this.fromDb();
  }
  private fromDb(): string {
    return process.env.DATABASE_URL ?? "";
  }
  render() {
    return <p>{this.data}</p>;
  }
}

/** Two hops, because a helper may call a helper. */
export class DelegatesTwice extends Component {
  @state data = "";
  @created({ env: "server" })
  load() {
    this.data = this.middle();
  }
  private middle(): string {
    return this.deep();
  }
  private deep(): string {
    return process.env.DATABASE_URL ?? "";
  }
  render() {
    return <p>{this.data}</p>;
  }
}

/**
 * ✗ The same helper, but ALSO called from render — so one of its callers is the browser. An excuse has to
 * hold for every caller or it is not an excuse.
 */
export class HelperAlsoCalledInRender extends Component {
  @state data = "";
  @created({ env: "server" })
  load() {
    this.data = this.both();
  }
  private both(): string {
    return process.env.DATABASE_URL ?? "";
  }
  render() {
    return <p>{this.both()}</p>;
  }
}

/**
 * A file that SHIMS `process` for browser code. The shim is the fix, so reporting it would be reporting
 * the reader's own answer — the rule asks whether the name resolves to a declaration.
 */
declare const shimmed: { env: Record<string, string | undefined> };
export class UsesAShim extends Component {
  render() {
    return <p>{shimmed.env.ANYTHING}</p>;
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
        <ReadsProcessInRender />
        <ReadsProcessInAField />
        <ReadsProcessInSharedCreate />
        <ReadsProcessOnTheServer />
        <DelegatesToAHelper />
        <DelegatesTwice />
        <HelperAlsoCalledInRender />
        <UsesAShim />
      </main>
    );
  }
}

bootstrap(<App />, null);

/**
 * The excuse across a class boundary: the helper is on a BASE and its only caller is a server-only
 * lifecycle down here. Planted to find out whether the excuse walk sees it.
 */
export class DelegatesToABase extends ConfigBase {
  @state data = "";
  @created({ env: "server" })
  load() {
    this.data = this.fromDb();
  }
  render() {
    return <p>{this.data}</p>;
  }
}
