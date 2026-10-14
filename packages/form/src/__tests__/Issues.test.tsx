import { Component, type RamondaNode } from "@ramonda/core";
import { render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import type { StandardSchemaV1 } from "../types";

/**
 * A field's issues as the schema sent them, not only their messages.
 *
 * Found by an agent building a bilingual app from the docs alone: a field gave only the message
 * text, so a form in Serbian showed the validator's English with nothing to translate it by. A
 * validator puts a key on an issue — bguard's `code`, `s:minLength` — and Standard Schema lets it,
 * so the field hands the issue on whole and the app translates by the key.
 */
interface Values {
  name: string;
}

const coded: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) =>
      (value as Values).name.length >= 3
        ? { value: value as Values }
        : {
            issues: [
              {
                message: "The received value length is less than expected",
                path: ["name"],
                code: "s:minLength",
                expected: 3,
              } as never,
            ],
          },
  },
};

function mount() {
  let form!: Form<typeof coded>;
  class Page extends Component {
    private f = this.use(Form<typeof coded>, () => ({
      schema: coded,
      defaultValues: { name: "" },
      onSubmit: () => {},
    }));
    render(): RamondaNode {
      form = this.f;
      return <form id="f" />;
    }
  }
  const mounted = render((<Page />) as never);
  return { form, ...mounted };
}

describe("a field's issues", () => {
  test("carry what the schema put on them — the key to translate by, beside the message", () => {
    const { form, unmount } = mount();
    try {
      form.fields.name.$.set("ab");
      const [issue] = form.fields.name.$.issues;
      expect(issue?.message).toBe("The received value length is less than expected");
      expect(issue?.code).toBe("s:minLength");
      expect(issue?.expected).toBe(3);
      // The messages are what they were.
      expect(form.fields.name.$.errors).toEqual(["The received value length is less than expected"]);
    } finally {
      unmount();
    }
  });

  test("are held back with the messages, until the field is touched", () => {
    const { form, unmount } = mount();
    try {
      form.fields.name.$.set("ab");
      form.fields.name.$.set("abc");
      expect(form.fields.name.$.issues).toEqual([]);
      expect(form.fields.name.$.errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  test("an error the app sets is an issue with a message and nothing else", () => {
    const { form, unmount } = mount();
    try {
      form.setError("name", "taken");
      expect(form.fields.name.$.issues.map((issue) => issue.message)).toContain("taken");
      expect(form.fields.name.$.issues.find((issue) => issue.message === "taken")?.code).toBeUndefined();
    } finally {
      unmount();
    }
  });
});
