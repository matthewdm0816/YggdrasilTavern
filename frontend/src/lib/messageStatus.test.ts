import { describe, expect, it } from "vitest";
import { messageErrorText, messageStatusLabel } from "./messageStatus";

describe("message status labels", () => {
  it("translates every stored status and keeps unknown values visible", () => {
    expect(["complete", "streaming", "cancelled", "failed", "interrupted"].map(messageStatusLabel))
      .toEqual(["已完成", "正在生成", "已停止", "生成失败", "已中断"]);
    expect(messageStatusLabel("queued")).toBe("queued");
    expect(messageStatusLabel("")).toBe("未知状态");
  });

  it("translates backend lifecycle reasons but shows provider errors verbatim", () => {
    expect(messageErrorText("Generation cancelled by client disconnect")).toContain("生成已停止");
    expect(messageErrorText("HTTP 429: rate limited")).toBe("HTTP 429: rate limited");
  });
});
