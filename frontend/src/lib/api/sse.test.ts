import { describe, expect, it } from "vitest";
import { SseParser, type SseEvent } from "./sse";

describe("SseParser", () => {
  it("parses CRLF split across chunks, comments, and UTF-8 content", () => {
    const received: SseEvent[] = [];
    const parser = new SseParser((event) => received.push(event));
    parser.push(": keepalive\r");
    parser.push("\n\r\nevent: token\r");
    parser.push("\ndata: {\"message_id\":\"m1\",\"delta\":\"你");
    parser.push("好\"}\r\n\r");
    parser.push("\n");
    parser.finish();
    expect(received).toEqual([
      { event: "token", data: { message_id: "m1", delta: "你好" } }
    ]);
  });

  it("accepts a final event without a trailing blank line", () => {
    const received: SseEvent[] = [];
    const parser = new SseParser((event) => received.push(event));
    parser.push("event: usage\ndata: {\"message_id\":\"m1\",\"usage\":{}}\n");
    parser.finish();
    expect(received).toEqual([
      { event: "usage", data: { message_id: "m1", usage: {} } }
    ]);
  });

  it("reports malformed JSON with the event name", () => {
    const parser = new SseParser(() => {});
    expect(() => parser.push("event: token\ndata: {bad}\n\n")).toThrow(
      "生成流事件 token 的 JSON 数据无效。"
    );
  });

  it("reports an event with no name rather than silently skipping it", () => {
    const parser = new SseParser(() => {});
    expect(() => parser.push("data: {}\n\n")).toThrow("生成流缺少事件名称。");
  });
});
