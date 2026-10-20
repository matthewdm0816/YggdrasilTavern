import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpandableTextarea } from "./ExpandableTextarea";

describe("ExpandableTextarea", () => {
  it("renders a labelled field with a comfortable height and an expand control", () => {
    const html = renderToStaticMarkup(
      <ExpandableTextarea label="性格" value="内容" minHeight={220} onChange={() => {}} />
    );

    expect(html).toContain(">性格<");
    expect(html).toContain('style="min-height:220px"');
    expect(html).toContain('aria-label="放大编辑性格"');
    expect(html).toContain("放大编辑");
  });
});
