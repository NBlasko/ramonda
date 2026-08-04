import { Component, configureDev, type RamondaNode, state } from "@ramonda/core";
import { act, render } from "@ramonda/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Form } from "../Form";
import type { StandardResult, StandardSchemaV1, ValidateOn } from "../types";

/**
 * What a form's props callback looks like to the strict render.
 *
 * A props callback is called TWICE in the same tick in a development build and the two bags
 * compared — RMD022, the same check `render()` gets. That is on by default, which makes it part of
 * what shipping a form actually feels like, and this package's own setup does not turn it off.
 *
 * The reason it earns a file: `defaultValues` is a payload, not a cache key, and the framework's
 * answer to a rebuilt prop — hold it somewhere with an identity, or declare it — is not free advice
 * here. A declaration is bounded (five levels deep, and anything wider than fifty items is called
 * different), so on a real record it would stop helping; the docs therefore say to hold the object.
 * Both halves are asserted here: the shape the docs recommend is silent, and the shape they warn
 * about is what produces the report.
 */
interface Values {
  name: string;
  tags: string[];
}

/** Held once, which is the whole point of the recommendation. */
const BLANK: Values = { name: "", tags: [] };

const schema: StandardSchemaV1<Values, Values> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => ({ value: value as Values }) as StandardResult<Values>,
  },
};

let logs: string[] = [];

beforeEach(() => {
  configureDev({ strictRender: true });
  logs = [];
  // The diagnostics write through `console.log`, banner and all.
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Which props RMD022 named, in order. */
function named(): string[] {
  return logs.filter((line) => line.includes("RMD022")).map((line) => /`(\w+)` prop/.exec(line)?.[1] ?? "?");
}

describe("a form under the strict render", () => {
  test("the recommended shape reports nothing", () => {
    class EditProfile extends Component {
      @state data: Values | undefined = undefined;
      @state unrelated = 0;

      private f = this.use(Form<typeof schema>, (self: EditProfile) => ({
        schema,
        // An object it already has, either way — never one built here.
        defaultValues: self.data ?? BLANK,
        // A bound method, so the identity never changes. A closure would be reported, and rightly.
        onSubmit: self.save,
      }));

      save(_values: Values): void {}

      render(): RamondaNode {
        void this.unrelated;
        void this.f.values;
        return <form />;
      }
    }

    const { unmount } = render((<EditProfile />) as never);
    try {
      expect(named()).toEqual([]);
    } finally {
      unmount();
    }
  });

  test("a literal built in the callback is what gets reported", () => {
    // The shape the docs warn about, kept here so the warning is about something real. If this ever
    // stops reporting, the paragraph in the docs is describing a diagnostic that no longer fires.
    let page!: Rebuilds;

    class Rebuilds extends Component {
      @state mode: ValidateOn = "submit";

      private f = this.use(Form<typeof schema>, (self: Rebuilds) => ({
        schema,
        // Built here, with the same contents every time — the fault.
        defaultValues: { name: "", tags: [] },
        onSubmit: self.save,
        /**
         * Moves, so the callback is genuinely invalidated and genuinely runs again.
         *
         * Without it there would be nothing to report and nothing wrong: a props callback is
         * cached on the signals it reads, so one that reads none runs ONCE, and a value built
         * once is not churn. RMD022 counts consecutive runs before it speaks, which is why this
         * file needs a form whose props actually move.
         */
        validateOn: self.mode,
      }));

      save(_values: Values): void {}

      render(): RamondaNode {
        page = this;
        void this.f.values;
        return <form />;
      }
    }

    const { unmount } = render((<Rebuilds />) as never);
    try {
      // Four runs of the callback in total, which is the threshold.
      for (const mode of ["change", "blur", "submit"] as ValidateOn[]) {
        act(() => {
          page.mode = mode;
        });
      }

      expect(named()).toEqual(["defaultValues"]);
      // And what it recommends is holding the value, which is what the docs say to do.
      expect(logs.join("\n")).toContain("@compute");
    } finally {
      unmount();
    }
  });

  test("the doubled call does not double what the form does with it", () => {
    // The callback runs twice per render here, so anything the form did per CALL rather than per
    // render would show up as two of it. `prime()` is a `@create`, and the values are latched on
    // their first read.
    let validations = 0;
    const counting: StandardSchemaV1<Values, Values> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) => {
          validations++;
          return { value: value as Values } as StandardResult<Values>;
        },
      },
    };

    class Page extends Component {
      @state unrelated = 0;
      private f = this.use(Form<typeof counting>, () => ({
        schema: counting,
        defaultValues: BLANK,
        onSubmit: (_values: Values) => {},
      }));

      render(): RamondaNode {
        void this.unrelated;
        void this.f.values;
        return <form />;
      }
    }

    const { unmount } = render((<Page />) as never);
    try {
      // Once, for the priming run — not once per call of the callback.
      expect(validations).toBe(1);
    } finally {
      unmount();
    }
  });
});
