import { useEffect, useState } from "react";

export function parseCommaList(text: string): string[] {
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

/** Keeps the typed text when it still means `value`, so a trailing comma or space survives. */
export function commaListText(currentText: string, value: string[]): string {
  return JSON.stringify(parseCommaList(currentText)) === JSON.stringify(value) ? currentText : value.join(", ");
}

type Props = { value: string[]; onChange: (value: string[]) => void };

export function CommaListInput({ value, onChange }: Props) {
  const [text, setText] = useState(() => value.join(", "));
  // Follow outside changes, such as another draft being loaded, without rewriting typing.
  useEffect(() => setText((current) => commaListText(current, value)), [value]);
  return <input value={text} onChange={(event) => {
    setText(event.target.value);
    onChange(parseCommaList(event.target.value));
  }} />;
}
