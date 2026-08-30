import { describe, expect, it } from "vitest";
import { RegexRule } from "./api";
import { transformDisplayText } from "./regex";

function rule(overrides: Partial<RegexRule>): RegexRule {
  return {
    id: "rule",
    name: "Rule",
    enabled: true,
    scope: "session",
    targets: ["display"],
    mode: "replace",
    pattern: "secret",
    flags: "",
    replacement: "public",
    ...overrides
  };
}

describe("display regex", () => {
  it("follows JavaScript first/global replacement semantics", () => {
    expect(transformDisplayText("secret secret", [rule({})]).segments[0].text).toBe("public secret");
    expect(transformDisplayText("secret secret", [rule({ flags: "g" })]).segments[0].text).toBe("public public");
  });

  it("returns veil spans without changing the underlying text", () => {
    const result = transformDisplayText("a secret b", [rule({ mode: "veil", replacement: "" })]);
    expect(result.segments.map((segment) => segment.text).join("")).toBe("a secret b");
    expect(result.segments.find((segment) => segment.veiled)?.text).toBe("secret");
  });
});
