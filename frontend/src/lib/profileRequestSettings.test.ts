import { describe, expect, it } from "vitest";
import {
  customHeaderDrafts, customHeaderPatch, customHeadersForCreate, hasCustomHeaderAuthentication,
  overriddenProtocolHeaders, parseDefaultParamsJson, updateDefaultParam, type CustomHeaderDraft
} from "./profileRequestSettings";

function header(name: string, value = ""): CustomHeaderDraft {
  return { id: name, name, value };
}

describe("custom request headers", () => {
  it("opens saved header names with blank values and leaves them out of the update", () => {
    const drafts = customHeaderDrafts(["Authorization", "X-Client"]);
    expect(drafts.map((item) => item.value)).toEqual(["", ""]);
    expect(customHeaderPatch(drafts, ["Authorization", "X-Client"])).toEqual({});
  });

  it("replaces entered values, deletes removed names and matches saved names without case sensitivity", () => {
    expect(customHeaderPatch([
      header("authorization", "  Bearer replacement  "), header("x-client")
    ], ["Authorization", "X-Client", "X-Removed"])).toEqual({
      authorization: "Bearer replacement", "X-Removed": null
    });
  });

  it("renames a saved header by deleting its old name and adding the new value", () => {
    expect(customHeaderPatch([header("X-New", "new-value")], ["X-Old"])).toEqual({ "X-New": "new-value", "X-Old": null });
    expect(() => customHeaderPatch([header("X-New")], ["X-Old"])).toThrow("请填写新请求头");
  });

  it("ignores untouched empty rows but rejects incomplete new headers and duplicate names", () => {
    expect(customHeadersForCreate([header(""), header(" X-Client ", " app ")])).toEqual({ "X-Client": "app" });
    expect(() => customHeaderPatch([header("", "secret")])).toThrow("填写名称");
    expect(() => customHeaderPatch([header("X-New")])).toThrow("填写新请求头");
    expect(() => customHeaderPatch([header("X-New", "one"), header("x-new", "two")])).toThrow("不区分大小写");
  });

  it.each(["line\nbreak", "\r\n", "tab\tvalue", "non-ascii-秘密", "control\u0000value"])("rejects invalid header values without exposing them: %j", (value) => {
    try {
      customHeaderPatch([header("X-Secret", value)], ["X-Secret"]);
      throw new Error("Expected header validation to fail");
    } catch (cause) {
      expect((cause as Error).message).toContain("ASCII");
      expect((cause as Error).message).not.toContain(value);
    }
  });

  it("rejects invalid names and treats special object keys as ordinary header names", () => {
    expect(() => customHeaderPatch([header("Bad Name", "value")])).toThrow("名称");
    const patch = customHeadersForCreate([header("__proto__", "value")]);
    expect(Object.prototype.hasOwnProperty.call(patch, "__proto__")).toBe(true);
    expect(patch.__proto__).toBe("value");
    expect(Object.getPrototypeOf(patch)).toBe(Object.prototype);
  });

  it("accepts only populated or retained authentication headers in place of an API key", () => {
    for (const name of ["Authorization", "X-API-Key", "api-key"]) {
      expect(hasCustomHeaderAuthentication([header(name, "secret")])).toBe(true);
      expect(hasCustomHeaderAuthentication([header(name)], [name.toLowerCase()])).toBe(true);
      expect(hasCustomHeaderAuthentication([header(name)])).toBe(false);
    }
    expect(hasCustomHeaderAuthentication([header("X-Client", "app")])).toBe(false);
    expect(hasCustomHeaderAuthentication([], ["Authorization"])).toBe(false);
  });

  it("identifies protocol headers that override generated values", () => {
    expect(overriddenProtocolHeaders([
      header("authorization"), header("X-API-Key"), header("api-key"), header("Content-Type"), header("X-Client")
    ])).toEqual(["authorization", "X-API-Key", "api-key", "Content-Type"]);
  });
});

describe("additional JSON request parameters", () => {
  it("parses arbitrary nested parameters and exposes the same temperature and thinking values", () => {
    const params = parseDefaultParamsJson('{"temperature":0.6,"_thinking_level":"high","provider_option":{"enabled":true}}');
    expect(params).toEqual({ temperature: 0.6, _thinking_level: "high", provider_option: { enabled: true } });
    const changed = updateDefaultParam(params, "temperature", 0.8);
    expect(changed).toEqual({ temperature: 0.8, _thinking_level: "high", provider_option: { enabled: true } });
    expect(params.temperature).toBe(0.6);
    expect(parseDefaultParamsJson(JSON.stringify(updateDefaultParam(changed, "_thinking_level", "off")))).toEqual({
      temperature: 0.8, _thinking_level: "off", provider_option: { enabled: true }
    });
  });

  it("removes a cleared temperature without discarding other parameters", () => {
    expect(updateDefaultParam({ temperature: 0.7, custom: { enabled: true } }, "temperature", undefined)).toEqual({ custom: { enabled: true } });
    expect(parseDefaultParamsJson("   ")).toEqual({});
  });

  it.each(["null", "[]", "true", "42", '"text"'])("requires a JSON object: %s", (text) => {
    expect(() => parseDefaultParamsJson(text)).toThrow("JSON 对象");
  });

  it("rejects malformed JSON without including its contents in the error", () => {
    expect(() => parseDefaultParamsJson('{"private":"secret-value",}')).toThrow("不是有效的 JSON");
    try { parseDefaultParamsJson('{"private":"secret-value",}'); } catch (cause) {
      expect((cause as Error).message).not.toContain("secret-value");
    }
  });

  it("rejects values that cannot be represented by the paired controls", () => {
    expect(() => parseDefaultParamsJson('{"temperature":"warm"}')).toThrow("temperature");
    expect(() => parseDefaultParamsJson('{"temperature":1e999}')).toThrow("有限数字");
    expect(() => parseDefaultParamsJson('{"_thinking_level":"unknown"}')).toThrow("_thinking_level");
  });

  it.each(['{"top_k":1e309}', '{"nested":{"limit":-1e309}}', '{"values":[1,2,1e309]}'])("rejects overflowing numbers anywhere in the object: %s", (text) => {
    expect(() => parseDefaultParamsJson(text)).toThrow("有限数字");
  });
});
