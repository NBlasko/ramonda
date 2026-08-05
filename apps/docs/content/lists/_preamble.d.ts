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
  class PersonRow extends Component<{ item: { id: string; name: string } }> {
    [key: string]: any;
    render(): any;
  }
  class CellView extends Component<{ item: any }> {
    [key: string]: any;
    render(): any;
  }
  const cellView: (cell: string) => RamondaNode;
}
