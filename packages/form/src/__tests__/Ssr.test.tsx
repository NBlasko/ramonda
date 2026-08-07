import { Component, hydrateRoot, list, type RamondaNode, renderPage, renderToString } from "@ramonda/core";
import { act } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Field } from "../field";
import { Form } from "../Form";
import { FormState } from "../formState";
import type { FieldNode, Row, StandardResult, StandardSchemaV1 } from "../types";

/**
 * A form whose fields are watched, on the server and through hydration.
 *
 * The watching machinery is client-side by nature — a subscription exists to schedule a render, and a
 * server render happens once — so the questions are whether it stays out of the way there, and whether
 * the page it produces takes over correctly. The second one is what matters: hydration reuses the markup
 * rather than rebuilding it, so any disagreement between the two sides throws the DOM away silently.
 */

interface Values {
  email: string;
  rows: { v: string }[];
}

const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const values = value as Values;
      return (
        values.email === "" ? { issues: [{ message: "required", path: ["email"] }] } : { value: values }
      ) as StandardResult<Values>;
    },
  },
};

const ROWS = 5;
const defaults = (): Values => ({ email: "", rows: Array.from({ length: ROWS }, (_, i) => ({ v: `r${i}` })) });

class Line extends Component<{ item: Row<{ v: string }> }> {
  f = this.use(Field<string>, () => ({ of: (this.props.item.field as FieldNode<{ v: string }>).v }));

  render(): RamondaNode {
    return <input className="row" {...this.f.bind} />;
  }
}

class EmailField extends Component<{ of: FieldNode<string> }> {
  f = this.use(Field<string>, () => ({ of: this.props.of }));

  render(): RamondaNode {
    return [<input id="email" {...this.f.bind} />, <span id="email-error">{this.f.error ?? ""}</span>];
  }
}

class SaveButton extends Component {
  s = this.use(FormState);

  render(): RamondaNode {
    return (
      <button id="save" disabled={!this.s.isValid}>
        Save
      </button>
    );
  }
}

class Page extends Component {
  f = this.use(Form<typeof schema>, { schema, defaultValues: defaults(), onSubmit: () => {} });

  render(): RamondaNode {
    return (
      <form>
        <EmailField of={this.f.fields.email} />
        {list({ each: this.f.fields.rows.$.rows, key: (row) => row.id, as: Line })}
        <SaveButton />
      </form>
    );
  }
}

describe("on the server", () => {
  test("the markup carries what the watchers would have shown", async () => {
    const html = await renderToString(<Page />);

    // Values through a watched field, and through a watched field inside a list row.
    expect(html).toContain('value="r0"');
    expect(html).toContain(`value="r${ROWS - 1}"`);
    // A form-level fact read by a component that found the form through the context.
    expect(/<button[^>]*disabled/.test(html)).toBe(true);
    // And the message is HELD BACK, because nothing has been touched and nothing submitted — the same
    // rule as on the client, which is what stops a server-rendered page arriving pre-scolded.
    expect(html).not.toContain("required");
  });

  test("every watched component ships a counter it does not need", async () => {
    /**
     * The cost of the design, written down rather than discovered later.
     *
     * The subscription is a `@state` counter, because that is the only thing that attaches the owning
     * component's rebuild — and `@state` MEANS "serialize me into the hydration blob". So every watched
     * field puts `{"version":0}` in the markup: always zero on the server, and restoring zero is a
     * no-op, so the bytes buy nothing.
     *
     * Measured here rather than asserted as a limit: what a threshold would pin is the serializer's
     * format, which is not this package's to promise. The number is the point — at 300 rows it is
     * around 17 KB of markup saying nothing, and the fix belongs in core, where a `@state` still holding
     * its initial value could be left out of the blob entirely.
     */
    const html = await renderToString(<Page />);
    const blobs = html.match(/data-ramonda-state="[^"]*"/g) ?? [];
    const bytes = blobs.reduce((total, blob) => total + blob.length, 0);

    // One per watched component, plus the page: the form, the email field, five rows, the button.
    expect(blobs.length).toBe(ROWS + 3);
    expect(blobs.filter((blob) => blob.includes("version"))).toHaveLength(ROWS + 3);
    console.log(`[form] SSR: ${blobs.length} blobs, ${bytes} of ${html.length} bytes are hydration state`);
  });
});

describe("through hydration", () => {
  test("the page takes over the markup and stays live", async () => {
    const page = await renderPage(<Page />);
    const element = document.createElement("div");
    document.body.appendChild(element);
    element.innerHTML = page.body;

    const serverRows = [...element.querySelectorAll("input.row")].map((input) => (input as HTMLInputElement).value);
    expect(serverRows).toEqual(["r0", "r1", "r2", "r3", "r4"]);

    try {
      hydrateRoot(<Page />, element);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Same values, and the same ELEMENTS: hydration reused them rather than rebuilding, which is what
      // a row id generated from a per-array counter is for — both sides mint `r0`, `r1`, … in the same
      // order, so the reconciler sees no change.
      const after = [...element.querySelectorAll("input.row")].map((input) => (input as HTMLInputElement).value);
      expect(after).toEqual(serverRows);
      expect((element.querySelector("#save") as HTMLButtonElement).disabled).toBe(true);

      // The watchers are live, and this is asserted PROGRAMMATICALLY on purpose: typing into an input
      // and then reading its value proves nothing, because the browser holds what was typed whether or
      // not anything re-rendered. A write from outside the DOM can only reach the screen through a
      // subscription.
      const instance = (element.firstChild as unknown as { _componentInstance: Page })._componentInstance;
      const form = (instance as unknown as { f: Form<typeof schema> }).f;

      await act(async () => (form.fields.rows.$.rows[1].field as FieldNode<{ v: string }>).v.$.set("from code"));
      expect((element.querySelectorAll("input.row")[1] as HTMLInputElement).value).toBe("from code");

      await act(async () => form.fields.email.$.set("ada@example.com"));
      expect((element.querySelector("#save") as HTMLButtonElement).disabled).toBe(false);
    } finally {
      element.remove();
    }
  });

  /**
   * A form whose defaults already PASS, hydrated — which is where the whole `@created` question bites.
   *
   * `@created` defaults to `env: "shared"`, and core skips a shared create during hydration because it
   * ran on the server. The model is that whatever it did is in the hydration blob; a form's values,
   * messages and `validated` are plain fields rather than `@state`, deliberately, so nothing of it
   * survives. Nothing had ever validated on this side, `isValid` was false however good the defaults
   * were, and hydration turned OFF a button the server had sent enabled — with nothing able to turn it
   * back on until the reader edited something.
   */
  test("a form whose defaults pass is still valid after hydration", async () => {
    class Fine extends Component {
      f = this.use(Form<typeof schema>, {
        schema,
        defaultValues: { email: "ada@example.com", rows: [] },
        onSubmit: () => {},
      });

      render(): RamondaNode {
        return (
          <form>
            <input id="email" {...this.f.fields.email.$.bind} />
            <SaveButton />
          </form>
        );
      }
    }

    const page = await renderPage(<Fine />);
    // The server got it right, which is what makes the client's answer a regression rather than a gap.
    expect(/<button[^>]*disabled/.test(page.body)).toBe(false);

    const element = document.createElement("div");
    document.body.appendChild(element);
    element.innerHTML = page.body;

    try {
      hydrateRoot(<Fine />, element);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));

      const instance = (element.firstChild as unknown as { _componentInstance: Fine })._componentInstance;
      const form = (instance as unknown as { f: Form<typeof schema> }).f;

      expect(form.isValid).toBe(true);
      expect((element.querySelector("#save") as HTMLButtonElement).disabled).toBe(false);
    } finally {
      element.remove();
    }
  });
});
