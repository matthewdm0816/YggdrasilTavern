import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegexMessage } from "./RegexMessage";

describe("RegexMessage", () => {
  it("keeps blank-line separated paragraphs inside one markdown root", () => {
    const html = renderToStaticMarkup(<RegexMessage content={"1. 甲\n\n2. 乙\n\n3. 丙"} role="assistant" rules={[]} />);
    expect(html.match(/message-content markdown-body/g)).toHaveLength(1);
    expect(html).toContain("<ol>");
  });

  it("still isolates veiled blocks into their own containers", () => {
    const html = renderToStaticMarkup(
      <RegexMessage
        content={"前文\n\n隐藏内容\n\n后文"}
        role="assistant"
        rules={[{ id: "r1", name: "遮罩", enabled: true, scope: "session", targets: ["display"], mode: "veil", pattern: "隐藏内容", flags: "", replacement: "" }]}
      />
    );
    expect(html).toContain("veil-block");
    // Two plain groups around the veil plus the veiled content itself.
    expect(html.match(/message-content markdown-body/g)).toHaveLength(3);
  });
});
