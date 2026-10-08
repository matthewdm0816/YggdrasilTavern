import { describe, expect, it } from "vitest";
import { responseError } from "./http";

describe("HTTP error details", () => {
  it("includes prompt diagnostics rather than only the summary", async () => {
    const response = new Response(JSON.stringify({ detail: { message: "Prompt compilation failed", diagnostics: [{ message: "Regex [ is invalid" }] } }), { status: 400 });
    expect(await responseError(response)).toContain("Regex [ is invalid");
  });
  it("explains HTML gateway responses without dumping a page", async () => {
    const result = await responseError(new Response("<html>gateway secret internal</html>", { status: 502 }));
    expect(result).toContain("HTTP 502");
    expect(result).toContain("服务器返回了网页");
    expect(result).not.toContain("secret internal");
  });
});
