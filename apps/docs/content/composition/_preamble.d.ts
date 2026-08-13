// What the composition examples may assume: a caller's own components, and a context pair the
// reader created with `createContext`.
export {};

declare global {
  class Item extends Component<{ item: any }> {
    [key: string]: any;
    render(): any;
  }

  /** Where the portal examples send their children — the reader's own element, outside the app. */
  const modals: HTMLElement;

  class Dialog extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class ThemeProvider extends Hook<any> {
    [key: string]: any;
  }
  class ThemeConsumer extends Hook<any> {
    theme: string;
    accent: string;
  }
}
