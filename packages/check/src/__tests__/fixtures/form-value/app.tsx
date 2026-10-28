import { Component, Select, TextArea } from "@ramonda/core";
import type { FormDay, FormNumber } from "@ramonda/form";

declare const age: { inputValue: FormNumber | "" };
declare const born: { inputValue: FormDay };
declare const name: { inputValue: string };
declare const either: { inputValue: string | FormNumber };
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
      </div>
    );
  }
}

export { Page };
