import { describe, expect, it } from "vitest";
import { regexPreviews } from "./textPreview";
import { validateRegex } from "./regex";
import type { RegexRule } from "./api";
export const hoverRule = (patch: Partial<RegexRule> = {}): RegexRule => ({
  id: "hover", name: "Preview", mode: "hover", scope: "global", enabled: true,
  targets: ["display"], pattern: "secret", flags: "g", replacement: "public", ...patch,
});
describe("rendered text previews", () => {
  it("keeps exact ranges and native capture/lookaround replacement semantics", () => {
    const result = regexPreviews("a secret b secret", [hoverRule({ pattern: "(?<=a )(secret)", replacement: "$1 / $& / $$" })]);
    expect(result).toEqual([{ id: "hover:2:8", start: 2, end: 8, original: "secret", replacement: "secret / secret / $" }]);
  });
  it("honors first/global and first-rule overlap priority", () => {
    expect(regexPreviews("secret secret", [hoverRule({ flags: "" })])).toHaveLength(1);
    const result = regexPreviews("secret secret", [hoverRule(), hoverRule({ id: "later", pattern: "secret secret" })]);
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.replacement === "public")).toBe(true);
  });
  it("handles empty replacements and zero-width matches without inventing visible characters", () => {
    expect(regexPreviews("secret", [hoverRule({ replacement: "" })])[0].replacement).toBe("");
    expect(regexPreviews("abc", [hoverRule({ pattern: "^|$", flags: "g" })])).toEqual([]);
  });
  it("rejects targets other than display", () => {
    expect(validateRegex(hoverRule({ targets: ["user_input"] }))).toContain("仅支持聊天显示");
    expect(validateRegex(hoverRule({ targets: ["outgoing_prompt"] }))).toContain("仅支持显式替换");
  });
});
