// The pages a route table points at, and the table itself.
export {};

declare global {
  // The reader's route table and server plumbing. `any` on purpose: their shape belongs to the app,
  // and a type here would be a second copy of one nobody is checking.

  class NavBar extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class SettingsNav extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Billing extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Team extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Player extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class Profile extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class SessionConsumer extends Hook<any> {
    [key: string]: any;
  }

  const routes: any;
  const paths: any;
  const createRoutes: (...args: any[]) => any;
  /**
   * The kit factory. An example destructures it the way an app does — once, into a module of its
   * own — rather than importing `Link` / `Navigator` from the package, which is no longer possible:
   * each exists in a version bound to YOUR table, and a second unchecked import beside it was one
   * door too many.
   *
   * The kit cannot be declared here as globals, either: `lib.dom` already owns the name `Navigator`
   * (`window.navigator`), so a global of that name is the DOM's and not the router's. Destructured
   * inside a block it is an ordinary local, which shadows that cleanly.
   */
  class RouterLink extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class RouterNavigator extends Hook<any> {
    [key: string]: any;
    /** Declared rather than left to the index signature: an untyped call takes no type arguments. */
    params<T = Record<string, string>>(): T;
  }
  const createRouter: (routes: any) => {
    Router: any;
    RouteOutlet: any;
    Navigator: typeof RouterNavigator;
    Link: typeof RouterLink;
    route: (...args: any[]) => any;
  };

  /** A node server's request and response, for the server-routing page. */
  const req: any;
  const res: any;
  const write: any;
}
