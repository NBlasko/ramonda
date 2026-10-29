import { Component, Select, TextArea } from "@ramonda/core";
import type { FormDay, FormNumber, FormOptional, FormText, InputValue } from "@ramonda/form";

declare const age: { inputValue: FormNumber | "" };
declare const born: { inputValue: FormDay | "" };
declare const name: { inputValue: FormText };
declare const either: { inputValue: FormText | FormNumber | "" };
declare const own: string;
declare const maybeBorn: { inputValue: FormText & FormOptional };
declare const textual: "text" | "email";
declare const numberish: "text" | "number";
declare const loose: { inputValue: any };
declare const kind: string;
declare const count: number;
const NUMBER = "number";

class Page extends Component {
  render() {
    return (
      <div>
        {/* ✓ each in the control that hands it back */}
        <input type="number" aria-label="age" value={age.inputValue} />
        <input type={"number"} aria-label="age braced" value={age.inputValue} />
        <input type={NUMBER} aria-label="age through a const" value={age.inputValue} />
        <input type="date" aria-label="born" value={born.inputValue} />
        {/* ✓ the attribute in any case, as HTML reads it, and a hidden input nobody edits */}
        <input type="Number" aria-label="age in capitals" value={age.inputValue} />
        <input type="range" aria-label="age on a slider" value={age.inputValue} />
        <input type="hidden" name="age" value={age.inputValue} />
        <input type="HIDDEN" name="born" value={born.inputValue} />
        <input aria-label="name" value={name.inputValue} />
        <input type="email" aria-label="name as email" value={name.inputValue} />
        <TextArea aria-label="name in a text area" value={name.inputValue} />
        <input type="range" aria-label="text of the app's own" value={own} />
        {/* ✓ a type read off its type, one HTML does not know, and inputs nobody edits */}
        <input type={textual} aria-label="name in a typed type" value={name.inputValue} />
        <input type="constructor" aria-label="name in an odd type" value={name.inputValue} />
        <input type="submit" value={name.inputValue} />
        <input type="date" aria-label="name as a date" value={name.inputValue} />
        <input aria-label="a text that may be absent, as text" value={maybeBorn.inputValue} />
        <input type="button" value={age.inputValue} />
        {/* ✓ a field that may hold text, and a number the app holds itself */}
        <input aria-label="either" value={either.inputValue} />
        <input aria-label="count" value={count} />
        {/* ✗ */}
        <input aria-label="age as text" value={age.inputValue} />
        <input type="text" aria-label="age typed text" value={age.inputValue} />
        <input type="number" aria-label="born as a number" value={born.inputValue} />
        <TextArea aria-label="age in a text area" value={age.inputValue} />
        <Select aria-label="age in a select" value={age.inputValue}>
          <option value="1">1</option>
        </Select>
        <input type={kind} aria-label="age in an unread type" value={age.inputValue} />
        <input aria-label="loose" value={loose.inputValue} />
        <input type="range" aria-label="name on a slider" value={name.inputValue} />
        <input type="number" aria-label="name as a number" value={name.inputValue} />
        <input type={kind} aria-label="name in an unread type" value={name.inputValue} />
        <input type={numberish} aria-label="name in a maybe number" value={name.inputValue} />
        <input type="checkbox" aria-label="name in a box" value={name.inputValue} />
        <input type="date" aria-label="a date as text that may be absent" value={maybeBorn.inputValue} />
      </div>
    );
  }
}

/** One input for any field: what it shows is decided by each use, and cannot be read here. */
class AnyField<T> extends Component<{ field: { inputValue: InputValue<T> } }> {
  render() {
    return <input aria-label="any field" value={this.props.field.inputValue} />;
  }
}

export { AnyField, Page };
