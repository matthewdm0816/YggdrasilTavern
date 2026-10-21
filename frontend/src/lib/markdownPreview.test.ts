import { describe, expect, it } from "vitest";
import { markdownPreviewText } from "./markdownPreview";

describe("markdown preview text", () => {
  it("drops Markdown syntax but keeps the words", () => {
    const source = [
      "# Markdown 测试输出",
      "这是一段 **Markdown** 格式测试。",
      "## 文本样式",
      "- **粗体文本**",
      "- *斜体文本*",
      "- ~~删除线~~",
      "- `行内代码`",
      "1. 第一项",
      "> 引用文本",
      "---",
      "[链接](https://example.test)"
    ].join("\n");
    expect(markdownPreviewText(source)).toBe(
      "Markdown 测试输出 这是一段 Markdown 格式测试。 文本样式 粗体文本 斜体文本 删除线 行内代码 第一项 引用文本 链接"
    );
  });

  it("flattens tables and code fences", () => {
    expect(markdownPreviewText("| 项目 | 状态 |\n|------|------|\n| 格式 | ✅ 正常 |")).toBe("项目 状态 格式 ✅ 正常");
    expect(markdownPreviewText("```python\ndef hello():\n    print(1)\n```")).toBe("def hello(): print(1)");
  });

  it("leaves plain roleplay text readable", () => {
    expect(markdownPreviewText("*smiles* Hello, 2*3 = 6")).toBe("smiles Hello, 2*3 = 6");
  });
});
