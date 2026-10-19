import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";

describe("MarkdownMessage", () => {
  it("keeps a single line break inside one paragraph", () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={"第一行\n第二行"} />);
    expect(html).toContain("<br/>");
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it("keeps blank lines as separate paragraphs", () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={"第一段\n\n第二段"} />);
    expect(html.match(/<p>/g)).toHaveLength(2);
  });
});
