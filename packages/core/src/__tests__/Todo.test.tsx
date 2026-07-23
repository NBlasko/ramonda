import { test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { Component } from "..";

import {
  fireEvent,
  getByPlaceholderText,
  getByTestId,
  getByText,
  queryByTestId,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/dom";
import { mount, state } from "../base/decorators";

interface Props {
  todo: string;
  handleRemove: (val: string) => void;
}

class TodoElement extends Component<Props> {
  render() {
    const { todo, handleRemove } = this.props;
    return (
      <div data-testid="todo-item">
        <span>{todo}</span>
        <button onClick={() => handleRemove(todo)} data-testid={todo} style="cursor:pointer">
          [X]
        </button>
      </div>
    );
  }
}

class TodoApp extends Component {
  @state todoList = ["Foo", "Bar", "Baz"];
  @state todo = "";

  @mount afterCreate() {
    this.todoList = [...this.todoList, "Nik"];
    this.todoList = [...this.todoList, "Todi"];
    this.todoList = [...this.todoList, "Nena"];
  }

  handleInput(e: Event) {
    this.todo = (e.target as HTMLInputElement).value;
  }

  handleAddNewTodo() {
    this.todoList = [...this.todoList, this.todo];
    this.todo = "";
  }

  handleRemove(todo: string) {
    this.todoList = this.todoList.filter((el) => el !== todo);
  }

  render() {
    return (
      <div>
        <h1>Todo List</h1>
        <button onClick={this.handleAddNewTodo} key="klik-div" style="cursor:pointer; color: blue;">
          Klikni
        </button>
        <input onInput={this.handleInput} value={this.todo} placeholder="kucaj ovde" />
        <div className="list">
          {this.todoList.map((item) => (
            <div key={item}>
              <TodoElement todo={item} handleRemove={this.handleRemove} />
            </div>
          ))}
        </div>
      </div>
    );
  }
}

test("TodoApp", async () => {
  const { container, user } = await getDOM(<TodoApp />);
  expect(container).toMatchSnapshot("After Create");
  const fooSpan = getByTestId(container, "Foo");
  fooSpan.click();
  await waitForElementToBeRemoved(() => getByTestId(container, "Foo"));

  expect(container).toMatchSnapshot("After Update");
  const inputTag = getByPlaceholderText(container, "kucaj ovde");
  expect(inputTag).toHaveAttribute("value", "");

  fireEvent.input(inputTag, { target: { value: "Novi todo" } });
  await waitFor(() => expect(inputTag).toHaveAttribute("value", "Novi todo"));
  expect(container).toMatchSnapshot("After Input");

  await user.click(getByText(container, "Klikni"));

  await waitFor(() => expect(queryByTestId(container, "Novi todo")).toBeTruthy());
  expect(container).toMatchSnapshot("After Submit");
});
