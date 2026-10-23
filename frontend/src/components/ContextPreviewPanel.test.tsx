import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivatedLoreList } from "./ContextPreviewPanel";
import type { ContextPreview, WorldBook } from "../lib/api";

describe("activated worldbook explanation", () => {
  it("shows recursion rounds and the exact source across books", () => {
    const entries: ContextPreview["activated_lore"] = [
      { id: "a", worldbook_id: "world", order: 1, position: "after_char", keys: ["种子"], content: "触发内嵌书", recursion_step: 0, activation_reason: "message" },
      { id: "b", worldbook_id: "character:card", order: 2, position: "after_char", keys: ["后续"], content: "后续正文", recursion_step: 1, activation_reason: "recursion", triggered_by: [{ id: "a", worldbook_id: "world" }] },
    ];
    const html = renderToStaticMarkup(<ActivatedLoreList entries={entries} worldbooks={[{ id: "world", name: "场景设定" } as WorldBook]} />);
    expect(html).toContain("首次扫描");
    expect(html).toContain("递归第 1 轮");
    expect(html).toContain("角色内嵌世界书");
    expect(html).toContain("触发条目：场景设定 / 种子");
    expect(html).toContain("后续正文");
  });

  it("explains delayed constants without inventing a triggering entry", () => {
    const html = renderToStaticMarkup(<ActivatedLoreList entries={[{ id: "a", worldbook_id: "world", order: 1, position: "after_char", keys: [], content: "延迟常驻内容", recursion_step: 2, activation_reason: "recursion_delay", triggered_by: [] }]} />);
    expect(html).toContain("延迟到递归后启用");
    expect(html).not.toContain("触发条目：");
  });
});
