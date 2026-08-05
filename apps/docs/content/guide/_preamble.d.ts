// The first page builds one component from nothing, so it names the parts of a tag before the
// reader has met them.
export {};

declare global {
  class Counter extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  class Hello extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  const tag: string;
  const attributes: Record<string, unknown>;
  const children: ComponentChild[];
}
