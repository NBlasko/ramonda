// The rows the list pages render, and the components that draw one.
export {};

declare global {
  interface Task {
    id: string;
    title: string;
    done: boolean;
  }
  interface RowData {
    id: string;
    cells: { id: string; value: string }[];
  }
  class TaskRow extends Component<{ item: Task }> {
    [key: string]: any;
    render(): any;
  }
  /** What the filtering page filters — a row with a name, and nothing else to it. */
  interface Person {
    id: string;
    name: string;
  }
  class PersonRow extends Component<{ item: Person }> {
    [key: string]: any;
    render(): any;
  }
  class CellView extends Component<{ item: any }> {
    [key: string]: any;
    render(): any;
  }
  const cellView: (cell: string) => RamondaNode;

  /** The reader's own row component for a computed list. */
  class ResultRow extends Component<any> {
    [key: string]: any;
    render(): any;
  }
}
