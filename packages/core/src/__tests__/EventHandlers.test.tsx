import { describe, test, expect } from "vitest";
import { getDOM } from "../test/setup";
import { state } from "../base/decorators";
import { Component } from "../base/Component";

describe("Event Handlers", () => {
  test("fires on initial render", async () => {
    const log: string[] = [];

    class Comp extends Component {
      handleClick() {
        log.push("click");
      }
      render() {
        return <button onClick={this.handleClick}>x</button>;
      }
    }

    const { container } = await getDOM(<Comp />);
    container.querySelector("button")!.click();

    expect(log).toEqual(["click"]);
  });

  test("updates when handler reference changes between renders", async () => {
    const log: string[] = [];

    class Comp extends Component {
      @state mode: "a" | "b" = "a";
      handleA() {
        log.push("A");
      }
      handleB() {
        log.push("B");
      }

      render() {
        return <button onClick={this.mode === "a" ? this.handleA : this.handleB}>x</button>;
      }
    }

    const { container, instance, settle } = await getDOM<Comp>(<Comp />);
    const btn = container.querySelector("button")!;

    btn.click();
    expect(log).toEqual(["A"]);

    log.length = 0;
    instance.mode = "b";
    await settle();

    btn.click();
    expect(log).toEqual(["B"]);
  });

  test("removed when handler becomes null", async () => {
    const log: string[] = [];

    class Comp extends Component {
      @state active = true;
      handleClick() {
        log.push("click");
      }

      render() {
        return <button onClick={this.active ? this.handleClick : null}>x</button>;
      }
    }

    const { container, instance, settle } = await getDOM<Comp>(<Comp />);
    const btn = container.querySelector("button")!;

    btn.click();
    expect(log).toEqual(["click"]);

    log.length = 0;
    instance.active = false;
    await settle();

    btn.click();
    expect(log).toHaveLength(0);
  });

  test("removed when handler becomes false", async () => {
    const log: string[] = [];

    class Comp extends Component {
      @state active = true;
      handleClick() {
        log.push("click");
      }

      render() {
        return <button onClick={this.active ? this.handleClick : undefined}>x</button>;
      }
    }

    const { container, instance, settle } = await getDOM<Comp>(<Comp />);
    const btn = container.querySelector("button")!;

    btn.click();
    expect(log).toEqual(["click"]);

    log.length = 0;
    instance.active = false;
    await settle();

    btn.click();
    expect(log).toHaveLength(0);
  });

  test("handler passed via props updates when parent re-renders with new reference", async () => {
    const log: string[] = [];

    class Inner extends Component<{ onClick: () => void }> {
      render() {
        return <button onClick={this.props.onClick}>x</button>;
      }
    }

    class Outer extends Component {
      @state version = 1;
      handleV1() {
        log.push("v1");
      }
      handleV2() {
        log.push("v2");
      }

      render() {
        return <Inner onClick={this.version === 1 ? this.handleV1 : this.handleV2} />;
      }
    }

    const { container, instance, settle } = await getDOM<Outer>(<Outer />);
    const btn = container.querySelector("button")!;

    btn.click();
    expect(log).toEqual(["v1"]);

    log.length = 0;
    instance.version = 2;
    await settle();

    btn.click();
    expect(log).toEqual(["v2"]);
  });
});
