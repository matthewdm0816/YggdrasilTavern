import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage";
import { RegexMessage } from "./RegexMessage";
import { regexPreviews } from "../lib/textPreview";
import type { RegexRule } from "../lib/api";
const hoverRule = (patch: Partial<RegexRule> = {}): RegexRule => ({
  id: "hover", name: "Preview", mode: "hover", scope: "global", enabled: true,
  targets: ["display"], pattern: "secret", flags: "g", replacement: "public", ...patch,
});

describe("Markdown preview annotations", () => {
  it("annotates a match across bold and link elements without changing their structure or URL", () => {
    const rules = [hoverRule({ pattern: "alpha beta & gamma", replacement: "replacement" })];
    const content = "alpha **beta** &amp; [gamma](https://example.com/secret)";
    const previews = (text: string) => regexPreviews(text, rules);
    const html = renderToStaticMarkup(<MarkdownMessage content={content} previews={previews} />);
    expect(html).toContain("<strong><span");
    expect(html).toContain('href="https://example.com/secret"');
    expect(html).toContain('role="button"');
    expect(html).toContain("text-preview");
    const replaced = renderToStaticMarkup(<MarkdownMessage content={content} previews={previews} showAllReplacements />);
    expect(replaced.match(/>replacement<\/span>/g)).toHaveLength(1);
    expect(replaced).toContain("<strong>");
    expect(replaced).toContain('href="https://example.com/secret"');
    expect(content).toBe("alpha **beta** &amp; [gamma](https://example.com/secret)");
  });
  it("matches visible text inside code, but never link URLs or Markdown delimiters", () => {
    const previews = (text: string) => regexPreviews(text, [hoverRule()]);
    expect(renderToStaticMarkup(<MarkdownMessage content="`secret`" previews={previews} />)).toContain('class="inline-code"><span');
    expect(renderToStaticMarkup(<MarkdownMessage content="[label](https://secret.test)" previews={previews} />)).not.toContain('class="text-preview"');
  });
  it("applies replacements before veil and hover and keeps a hidden veil unrevealed", () => {
    const rules = [hoverRule({ pattern: "public", replacement: "preview" }),
      hoverRule({ id: "replace", mode: "replace", pattern: "secret", replacement: "public" }),
      hoverRule({ id: "veil", mode: "veil", pattern: "hidden", replacement: "concealed" })];
    const html = renderToStaticMarkup(<RegexMessage content={"secret\n\nhidden"} role="assistant" rules={rules} showAllReplacements />);
    expect(html).toContain(">preview</span>");
    expect(html).toContain('class="veil-block"');
    expect(html).not.toContain('class="veil-block revealed"');
    expect(html).toContain("concealed");
  });
});
