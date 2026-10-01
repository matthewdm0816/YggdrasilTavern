import type { GenerateInput } from "./contracts";
import { API_BASE, notifyAuthenticationRequired, responseError } from "./http";
import { SseParser, type SseEvent } from "./sse";
import type { Message } from "./types";

export type StreamHandlers = {
  onCreated?: (message: Message) => void;
  onToken?: (messageId: string, delta: string) => void;
  onThinking?: (messageId: string, delta: string) => void;
  onUsage?: (messageId: string, usage: Record<string, unknown>) => void;
  onComplete?: (message: Message) => void;
  onError?: (messageId: string | undefined, detail: string) => void;
};

function record(value: unknown, event: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("生成流事件 " + event + " 的数据必须是对象。");
  }
  return value as Record<string, unknown>;
}

function stringField(data: Record<string, unknown>, field: string, event: string): string {
  const value = data[field];
  if (typeof value !== "string") throw new Error("生成流事件 " + event + " 缺少字符串字段 " + field + "。");
  return value;
}

function messageData(data: unknown, event: string): Message {
  const value = record(data, event);
  for (const field of [
    "id", "session_id", "role", "speaker", "content", "thinking_content",
    "status", "created_at", "updated_at"
  ]) {
    stringField(value, field, event);
  }
  for (const field of ["token_count", "thinking_token_count", "cached_tokens", "sort_order"]) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
      throw new Error("生成流事件 " + event + " 缺少数字字段 " + field + "。");
    }
  }
  record(value.provider_metadata, event);
  record(value.usage, event);
  return value as Message;
}

function dispatchGenerationEvent(
  parsed: SseEvent,
  handlers: StreamHandlers,
  onTerminal: (error: Error | null) => void
): void {
  const data = record(parsed.data, parsed.event);
  switch (parsed.event) {
    case "message_created": {
      const message = messageData(data, parsed.event);
      handlers.onCreated?.(message);
      return;
    }
    case "token": {
      const messageId = stringField(data, "message_id", parsed.event);
      const delta = stringField(data, "delta", parsed.event);
      handlers.onToken?.(messageId, delta);
      return;
    }
    case "thinking": {
      const messageId = stringField(data, "message_id", parsed.event);
      const delta = stringField(data, "delta", parsed.event);
      handlers.onThinking?.(messageId, delta);
      return;
    }
    case "usage": {
      const messageId = stringField(data, "message_id", parsed.event);
      const usage = record(data.usage, parsed.event);
      handlers.onUsage?.(messageId, usage);
      return;
    }
    case "message_completed": {
      const message = messageData(data, parsed.event);
      handlers.onComplete?.(message);
      onTerminal(null);
      return;
    }
    case "error": {
      const messageId = data.message_id;
      if (messageId !== undefined && typeof messageId !== "string") {
        throw new Error("生成流事件 error 的 message_id 必须是字符串。");
      }
      const detail = stringField(data, "detail", parsed.event);
      handlers.onError?.(messageId as string | undefined, detail);
      onTerminal(new Error(detail));
      return;
    }
    default:
      throw new Error("未知的生成流事件：" + parsed.event + "。");
  }
}

export async function streamGenerate(
  sessionId: string,
  payload: GenerateInput,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const path = "/api/sessions/" + sessionId + "/generate/stream";
  const response = await fetch(API_BASE + path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok || !response.body) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let terminalSeen = false;
  let terminalError: Error | null = null;
  const parser = new SseParser((event) => {
    if (terminalSeen) throw new Error("生成流在结束后又收到事件 " + event.event + "。");
    dispatchGenerationEvent(event, handlers, (error) => {
      terminalSeen = true;
      terminalError = error;
    });
  });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
    if (signal?.aborted) return;
    if (!terminalSeen) throw new Error("生成流已断开，但没有收到完成或错误事件。");
    if (terminalError) throw terminalError;
  } finally {
    reader.releaseLock();
  }
}
