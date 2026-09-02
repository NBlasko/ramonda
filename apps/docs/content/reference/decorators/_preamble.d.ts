// The reader's own data source, for the pages that show a lifecycle fetching something.
export {};

declare global {
  // Deliberately `any`: what a reader's loader returns is not what these pages teach, and a shape
  // written here would only be a second, wrong copy of one that lives in their app. The same stand-in
  // the SSR pages use, for the same reason.
  const getUser: (...args: any[]) => any;
}
