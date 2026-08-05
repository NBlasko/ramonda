export {};

declare global {
  class Post extends Component<any> {
    [key: string]: any;
    render(): any;
  }
  class App extends Component<any> {
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
}
