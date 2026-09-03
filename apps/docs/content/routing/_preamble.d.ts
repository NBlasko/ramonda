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
  /** The reader's own session check, for the async-guard example. */
  const loadSession: () => Promise<{ user: string } | undefined>;
  /** A node server's request and response, for the server-routing page. */
  const req: any;
  const res: any;
  const write: any;
}
