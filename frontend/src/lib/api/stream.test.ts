import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationRequestError, GenerationStreamDropped, resumeGeneration, streamGenerate } from "./stream";

const encoder = new TextEncoder();
const message = {
  id: "m1",
  session_id: "s1",
  role: "assistant",
  speaker: "Assistant",
  content: "你好",
  thinking_content: "",
  status: "complete",
  token_count: 2,
  thinking_token_count: 0,
  cached_tokens: 0,
  sort_order: 0,
  provider_metadata: {},
  usage: {},
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z"
};

function streamResponse(chunks: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  }), { headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("streamGenerate", () => {
  it("delivers a fragmented stream and accepts its completion event", async () => {
    const completed = vi.fn();
    const token = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "event: token\r",
      "\ndata: {\"message_id\":\"m1\",\"delta\":\"你\"}\r\n\r\n",
      "event: message_completed\r\ndata: " + JSON.stringify(message) + "\r\n\r\n"
    ])));
    await streamGenerate("s1", {}, { onToken: token, onComplete: completed });
    expect(token).toHaveBeenCalledWith("m1", "你");
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", content: "你好" }));
  });

  it("reports an invalid event payload instead of dropping it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "event: token\ndata: {invalid}\n\n",
      "event: message_completed\ndata: " + JSON.stringify(message) + "\n\n"
    ])));
    await expect(streamGenerate("s1", {}, {})).rejects.toThrow("生成流事件 token 的 JSON 数据无效。");
  });

  it("reports a completed message missing a required numeric field", async () => {
    const incomplete = { ...message, token_count: undefined };
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "event: message_completed\ndata: " + JSON.stringify(incomplete) + "\n\n"
    ])));
    await expect(streamGenerate("s1", {}, {})).rejects.toThrow("缺少数字字段 token_count");
  });
  it("reports a connection that ends without a completion or error event as a drop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "event: token\ndata: {\"message_id\":\"m1\",\"delta\":\"你\"}\n\n"
    ])));
    const dropped = streamGenerate("s1", {}, {});
    await expect(dropped).rejects.toBeInstanceOf(GenerationStreamDropped);
    await expect(dropped).rejects.toThrow("生成流已断开，但没有收到完成或错误事件。");
  });

  it("ends normally with the stopped reply", async () => {
    const stopped = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "event: message_stopped\ndata: " + JSON.stringify({ ...message, status: "cancelled" }) + "\n\n"
    ])));
    await streamGenerate("s1", {}, { onStopped: stopped });
    expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", status: "cancelled" }));
  });

  it("resumes a run by id and reports a finished run with its status", async () => {
    const fetch = vi.fn(async () => streamResponse([
      "event: message_created\ndata: " + JSON.stringify({ ...message, status: "streaming" }) + "\n\n",
      "event: message_completed\ndata: " + JSON.stringify(message) + "\n\n"
    ]));
    vi.stubGlobal("fetch", fetch);
    const created = vi.fn();
    await resumeGeneration("run/1", { onCreated: created });
    expect(fetch).toHaveBeenCalledWith("/api/generation-runs/run%2F1/stream", expect.objectContaining({ credentials: "include" }));
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ status: "streaming" }));

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "这条回复已经不在生成中" }), { status: 404 })));
    const gone = resumeGeneration("run", {});
    await expect(gone).rejects.toBeInstanceOf(GenerationRequestError);
    await expect(gone).rejects.toMatchObject({ status: 404, message: "这条回复已经不在生成中" });
  });

  it("passes provider errors to the callback and rejects with the same detail", async () => {
    const onError = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "event: error\ndata: {\"message_id\":\"m1\",\"detail\":\"provider failed\"}\n\n"
    ])));
    await expect(streamGenerate("s1", {}, { onError })).rejects.toThrow("provider failed");
    expect(onError).toHaveBeenCalledWith("m1", "provider failed");
  });
});
