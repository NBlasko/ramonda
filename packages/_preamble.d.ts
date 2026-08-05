// What every package README may assume: the reader's own components and services, and the globals a
// test file has around it. The same idea as `apps/docs/content/_preamble.d.ts`, for the other half
// of the documentation.
export {};

declare global {
  class ReportView extends Component<any> {
    [key: string]: any;
    render(): any;
  }

  const api: Record<string, (...args: any[]) => Promise<any>>;
  const items: any[];
  const id: string;
  const container: HTMLElement;
  const test: (name: string, body: () => unknown) => void;
  const it: typeof test;
  const describe: (name: string, body: () => void) => void;
  const expect: (value: unknown) => any;
  const vi: Record<string, (...args: any[]) => any>;
}
