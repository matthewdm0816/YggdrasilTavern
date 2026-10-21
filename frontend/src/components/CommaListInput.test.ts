import { describe, expect, it } from "vitest";
import { commaListText, parseCommaList } from "./CommaListInput";

describe("comma list input", () => {
  it("parses trimmed, non-empty items", () => {
    expect(parseCommaList(" Loli, Test ,, ")).toEqual(["Loli", "Test"]);
  });

  it("keeps a trailing comma and space while the next item is being typed", () => {
    expect(commaListText("Loli,", ["Loli"])).toBe("Loli,");
    expect(commaListText("Loli, ", ["Loli"])).toBe("Loli, ");
    expect(commaListText("Loli, T", ["Loli", "T"])).toBe("Loli, T");
  });

  it("replaces the text when the value changes from outside", () => {
    expect(commaListText("Loli,", ["Other"])).toBe("Other");
    expect(commaListText("", [])).toBe("");
  });
});
