import { describe, expect, it } from "vitest";
import fixture from "../../../shared/macro-cases.json";
import { expandMacros, macroPreviews, displayMessageText, protectLegacyMacros } from "./macros";

describe("shared backend/frontend macro contract", () => {
  for (const item of fixture.cases) it(item.id, () => {
    expect(expandMacros(item.text, { character: item.character, user_name: item.user_name, original: item.original })).toBe(item.expected);
  });
  it("returns precise original spans, preserves raw text while context loads, and protects legacy tags", () => {
    const context = { character: fixture.cases[0].character, user_name: "Owner" };
    const text = "{{char}} meets <USER>";
    expect(macroPreviews(text, context).map((item) => [item.start, item.end, item.replacement])).toEqual([[0, 8, "Apeiria"], [15, 21, "Owner"]]);
    expect(displayMessageText(text, { ...context, ready: false })).toBe(text);
    const encoded = protectLegacyMacros("<BOT> says <USER>");
    expect(encoded.text).not.toContain("<BOT>");
    expect(encoded.restore(encoded.text)).toBe("<BOT> says <USER>");
  });
});
