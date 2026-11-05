import { Component, type RamondaNode } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { describe, expect, test } from "vitest";
import { Form } from "../Form";
import { Field } from "../field";
import type { FieldNode } from "../types";
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

/**
 * An issue that changes while its message does not — the case a translation by `code` lives in.
 *
 * Found by a review of this branch: a field woke only when its MESSAGES changed, so `{ message:
 * "Invalid", code: "s:minLength" }` becoming `{ message: "Invalid", code: "s:pattern" }` never
 * re-rendered a field reading `issues`, and the app kept showing the first translation. Driven from
 * ANOTHER field, so the field's own value does not move and cannot wake it on its own: a test that
 * changed the field itself passed with the fault in place.
 */
describe("a field reading its issues", () => {
  interface Pair {
    name: string;
    strict: string;
  }
  const crossField: StandardSchemaV1<Pair, Pair> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => {
        const { strict } = value as Pair;
        return {
          issues: [
            { message: "Invalid", path: ["name"], code: strict === "yes" ? "s:pattern" : "s:minLength" } as never,
          ],
        };
      },
    },
  };

  test("re-renders when only an issue's code changes", async () => {
    let renders = 0;
    class Code extends Component<{ of: FieldNode<string> }> {
      f = this.use(Field<string>, () => ({ of: this.props.of }));
      render(): RamondaNode {
        renders++;
        return <p id="code">{String(this.f.issues[0]?.code ?? "none")}</p>;
      }
    }
    let form!: Form<typeof crossField>;
    class Page extends Component {
      private f = this.use(Form<typeof crossField>, () => ({
        schema: crossField,
        defaultValues: { name: "x", strict: "no" },
        onSubmit: () => {},
      }));
      render(): RamondaNode {
        form = this.f;
        return <Code of={this.f.fields.name} />;
      }
    }
    const { container, unmount } = render((<Page />) as never);
    try {
      await act(async () => form.submit());
      expect(container.querySelector("#code")!.textContent).toBe("s:minLength");
      await act(async () => form.fields.strict.$.set("yes"));
      // The name field's value and message are both unchanged; only its issue's code moved.
      expect(form.fields.name.$.errors).toEqual(["Invalid"]);
      expect(form.fields.name.$.issues[0]?.code).toBe("s:pattern");
      expect(container.querySelector("#code")!.textContent).toBe("s:pattern");
      expect(renders).toBeGreaterThan(1);
    } finally {
      unmount();
    }
  });
});

/**
 * What `sameIssues` compares, from a second review: every key of EITHER issue, not only the first's —
 * `{ code: undefined }` against `{ params: … }` has two keys each and read as the same — and an object
 * JSON cannot write, a `RegExp` or a `Set`, as changed, since both write as `{}`.
 */
describe("an issue that changes in what JSON or one side's keys cannot see", () => {
  interface Mode {
    name: string;
    mode: string;
  }
  const EXTRAS: Record<string, Record<string, unknown>> = {
    a: { code: undefined },
    b: { params: { min: 3 } },
    c: { expected: /^[a-z]+$/ },
    d: { expected: /^\d+$/ },
    e: { expected: new Set([1]) },
    f: { expected: new Set([2]) },
    // One level down — a third review found JSON still compared these, and wrote both as `{}`.
    g: { params: { pattern: /^[a-z]+$/ } },
    h: { params: { pattern: /^\d+$/ } },
    i: { params: { min: undefined } },
    j: { params: {} },
  };
  const bySide: StandardSchemaV1<Mode, Mode> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({
        issues: [{ message: "Invalid", path: ["name"], ...EXTRAS[(value as Mode).mode] } as never],
      }),
    },
  };

  test.each([
    ["a key only the new issue has", "a", "b", "params"],
    ["a different RegExp", "c", "d", "expected"],
    ["a Set with other contents", "e", "f", "expected"],
    ["a different RegExp one level down", "g", "h", "params"],
    ["a key present but undefined one level down, then gone", "i", "j", "params"],
  ])("re-renders on %s", async (_what, from, to, key) => {
    class Shows extends Component<{ of: FieldNode<string> }> {
      f = this.use(Field<string>, () => ({ of: this.props.of }));
      render(): RamondaNode {
        const issue = this.f.issues[0] as Record<string, unknown> | undefined;
        const value = issue?.[key];
        return (
          <p id="shows">
            {value instanceof Set
              ? [...value].join(",")
              : value instanceof RegExp
                ? value.source
                : JSON.stringify(value, (_k, v) =>
                    v instanceof RegExp ? v.source : v === undefined ? "<undefined>" : v,
                  )}
          </p>
        );
      }
    }
    let form!: Form<typeof bySide>;
    class Page extends Component {
      private f = this.use(Form<typeof bySide>, () => ({
        schema: bySide,
        defaultValues: { name: "x", mode: from },
        onSubmit: () => {},
      }));
      render(): RamondaNode {
        form = this.f;
        return <Shows of={this.f.fields.name} />;
      }
    }
    const { container, unmount } = render((<Page />) as never);
    try {
      await act(async () => form.submit());
      const before = container.querySelector("#shows")!.textContent;
      await act(async () => form.fields.mode.$.set(to));
      expect(form.fields.name.$.errors).toEqual(["Invalid"]);
      expect(container.querySelector("#shows")!.textContent).not.toBe(before);
    } finally {
      unmount();
    }
  });
});

/**
 * An issue carrying a value that refers to itself — a validator that puts the offending input on the
 * issue, and an input with a back-reference. `equal` walks objects, and without a guard it walked this
 * one until the stack ran out, from inside the form's validation. Found by a fourth review.
 */
describe("an issue whose value refers to itself", () => {
  interface Tree {
    name: string;
    mode: string;
  }
  /**
   * The guard is the path from the root, not every object seen: one object held in two places is no
   * loop. A guard that kept every visit called `{ a: X, b: X }` different from an equal copy, and
   * `equal` also decides whether a form's defaults moved.
   */
  test("an object held in two places is still equal to an equal copy", async () => {
    let renders = 0;
    const shared = { min: 3 };
    const twice: StandardSchemaV1<Tree, Tree> = {
      "~standard": {
        version: 1,
        vendor: "test",
        // A FRESH object per run, held twice: one module constant would be the same object every
        // run, and `Object.is` would answer before the guard was ever asked — measured, the test
        // passed with the wrong guard in place.
        validate: () => {
          const fresh = { ...shared };
          return {
            issues: [{ message: "Invalid", path: ["name"], a: fresh, b: fresh, both: [fresh, fresh] } as never],
          };
        },
      },
    };
    let form!: Form<typeof twice>;
    class Count extends Component<{ of: FieldNode<string> }> {
      f = this.use(Field<string>, () => ({ of: this.props.of }));
      render(): RamondaNode {
        renders++;
        return <p>{this.f.issues.length}</p>;
      }
    }
    class Page extends Component {
      private f = this.use(Form<typeof twice>, () => ({
        schema: twice,
        defaultValues: { name: "x", mode: "a" },
        onSubmit: () => {},
      }));
      render(): RamondaNode {
        form = this.f;
        return <Count of={this.f.fields.name} />;
      }
    }
    const { unmount } = render((<Page />) as never);
    try {
      await act(async () => form.submit());
      const after = renders;
      // The same issue again, with `shared` in two places: no change, so no wake.
      await act(async () => form.fields.mode.$.set("b"));
      expect(renders).toBe(after);
    } finally {
      unmount();
    }
  });

  const cyclic: StandardSchemaV1<Tree, Tree> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => {
        const input: Record<string, unknown> = { kind: "node" };
        input.self = input;
        return { issues: [{ message: "Invalid", path: ["name"], input } as never] };
      },
    },
  };

  test("is compared without running out of stack", async () => {
    let form!: Form<typeof cyclic>;
    class Page extends Component {
      private f = this.use(Form<typeof cyclic>, () => ({
        schema: cyclic,
        defaultValues: { name: "x", mode: "a" },
        onSubmit: () => {},
      }));
      render(): RamondaNode {
        form = this.f;
        return <Count of={this.f.fields.name} />;
      }
    }
    // Through `Field`: the comparison runs only for a field something listens to, and a page reading
    // the form directly passed with the fault in place.
    class Count extends Component<{ of: FieldNode<string> }> {
      f = this.use(Field<string>, () => ({ of: this.props.of }));
      render(): RamondaNode {
        return <p id="n">{this.f.issues.length}</p>;
      }
    }
    const { unmount } = render((<Page />) as never);
    try {
      await act(async () => form.submit());
      await act(async () => form.fields.mode.$.set("b"));
      expect(form.fields.name.$.errors).toEqual(["Invalid"]);
    } finally {
      unmount();
    }
  });
});

/**
 * An issue that is a class instance, its `message` a getter on the prototype. Standard Schema promises
 * the shape, not a plain object, and a spread copies only own properties: the field's issue had no
 * `message`. Found by the final review.
 */
describe("an issue that is a class instance", () => {
  class Problem {
    readonly path = ["name"];
    readonly code = "too_short";
    get message(): string {
      return "Too short";
    }
  }
  const classy: StandardSchemaV1<Values, Values> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) =>
        (value as Values).name.length >= 3 ? { value: value as Values } : { issues: [new Problem() as never] },
    },
  };

  test("keeps its message, and what it carries of its own", () => {
    let form!: Form<typeof classy>;
    class Page extends Component {
      private f = this.use(Form<typeof classy>, () => ({
        schema: classy,
        defaultValues: { name: "" },
        onSubmit: () => {},
      }));
      render(): RamondaNode {
        form = this.f;
        return <form />;
      }
    }
    const { unmount } = render((<Page />) as never);
    try {
      form.fields.name.$.set("ab");
      expect(form.fields.name.$.errors).toEqual(["Too short"]);
      expect(form.fields.name.$.issues[0]?.message).toBe("Too short");
      expect(form.fields.name.$.issues[0]?.code).toBe("too_short");
    } finally {
      unmount();
    }
  });
});
