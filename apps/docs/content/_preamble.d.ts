// The context every example on the site may assume.
//
// These are the READER's things, not Ramonda's: the component they are writing, the API they are
// calling, the type their data has. An example is entitled to name them without declaring them,
// because declaring them would bury the one line it is actually showing.
//
// Ramonda's own exports are NOT here. They are derived from the packages' declarations at check
// time (see `scripts/check-examples.mjs`), so that renaming one breaks every example still using
// the old name — which is the reason this check exists.
//
// Adding a name here is a decision: it says "an example may assume this". A name that is missing
// is an example being wrong, which is exactly how `draft(title)` was found.
export {};

declare global {
  /** The child of the error-boundary example. NOT called `Report`: that is a DOM global (the
   *  Reporting API), and a component of that name is shadowed wherever `lib.dom` is loaded. */
  class ReportView extends Component<{ data: unknown }> {
    render(): any;
  }

  /** Vite puts this on `import.meta`; the devtools pages read `DEV` off it. */
  interface ImportMeta {
    env: Record<string, any>;
  }

  /* ── the reader's components ─────────────────────────────────────────────────────────────── */
  class App extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Panel extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Card extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Row extends Component<{ item?: any; [prop: string]: any }> {
    [key: string]: any;
    render(): any;
  }
  class Home extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class NotFound extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Item extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Cell extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  /* ── the reader's data and services ──────────────────────────────────────────────────────── */
  const api: Record<string, (...args: any[]) => Promise<any>>;
  const items: any[];
  const id: string;
  const container: HTMLElement;
  /** Whatever the reader collects diagnostics with — a devtools panel, a test, a log shipper. */
  const myCollector: { alert(record: unknown): void };

  /* ── a test file's globals, for the testing pages ────────────────────────────────────────── */
  const test: (name: string, body: () => unknown) => void;
  const it: typeof test;
  const describe: (name: string, body: () => void) => void;
  const expect: (value: unknown) => any;
  const vi: Record<string, (...args: any[]) => any>;
}
