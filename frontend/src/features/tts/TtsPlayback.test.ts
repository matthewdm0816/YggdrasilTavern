import { describe, expect, it, vi } from "vitest";
import type { Message } from "../../lib/api";
import type { TtsPreview, TtsSettings } from "./api";
import { TtsPlayback } from "./TtsPlayback";

const settings: TtsSettings = {
  enabled: true, provider: "minimax", endpoint: "https://api.minimax.cn/v1/t2a_v2", model: "speech-2.8-hd",
  voice: "voice", speed: 1, volume: 1, pitch: 0, emotion: "", language_boost: "auto",
  text_mode: "dialogue", trigger_mode: "auto", instruct_model: true, revision: 1, has_api_key: true
};
function message(id = "reply", overrides: Partial<Message> = {}): Message {
  return {
    id, session_id: "one", parent_id: null, selected_child_id: null, role: "assistant", speaker: "Character",
    content: "“你好。”", thinking_content: "", status: "complete", token_count: 4, thinking_token_count: 0,
    cached_tokens: 0, sort_order: 0, provider_metadata: {}, usage: {}, created_at: "", updated_at: "", ...overrides
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
function fixture(configuration: TtsSettings | undefined = settings) {
  const audio = {
    src: "",
    play: vi.fn(async (): Promise<void> => undefined),
    pause: vi.fn(),
    load: vi.fn(),
    onended: null as HTMLAudioElement["onended"],
    onerror: null as HTMLAudioElement["onerror"]
  };
  const dependencies = {
    preview: vi.fn(async (id: string, _signal: AbortSignal): Promise<TtsPreview> => ({
      message_id: id, text: "你好。", segments: ["你好。"], warnings: [], max_characters: 10000
    })),
    synthesize: vi.fn(async (_id: string, _text: string | undefined, _signal: AbortSignal) => audioBlob),
    createAudio: vi.fn(() => audio),
    createObjectURL: vi.fn(() => "blob:audio"),
    revokeObjectURL: vi.fn()
  };
  const runtime = new TtsPlayback(dependencies);
  runtime.configure("one", configuration, "alice");
  return { runtime, dependencies, audio };
}
async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("TTS playback", () => {
  it("does not scan history or automatically play while disabled, loading settings, or in manual mode", async () => {
    const { runtime, dependencies } = fixture({ ...settings, trigger_mode: "manual" });
    await flush();
    expect(dependencies.preview).not.toHaveBeenCalled();
    runtime.onGenerated(message());
    runtime.configure("one", { ...settings, enabled: false }, "alice");
    runtime.onGenerated(message("disabled"));
    runtime.configure("one", undefined, "alice");
    runtime.onGenerated(message("loading"));
    await flush();
    expect(dependencies.synthesize).not.toHaveBeenCalled();
    runtime.configure("one", settings, "alice");
    runtime.onGenerated(message());
    runtime.onGenerated(message("disabled"));
    runtime.onGenerated(message("loading"));
    await flush();
    expect(dependencies.synthesize).not.toHaveBeenCalled();
  });

  it("requires explicit completion of a character message in the selected session", async () => {
    const { runtime, dependencies } = fixture();
    runtime.onGenerated(message("user", { role: "user" }));
    runtime.onGenerated(message("streaming", { status: "streaming" }));
    runtime.onGenerated(message("other", { session_id: "two" }));
    await flush();
    expect(dependencies.preview).not.toHaveBeenCalled();
    runtime.onGenerated(message());
    await flush();
    expect(dependencies.synthesize).toHaveBeenCalledTimes(1);
    expect(dependencies.synthesize.mock.calls[0].slice(0, 2)).toEqual(["reply", "你好。"]);
    expect(runtime.getSnapshot().phase).toBe("playing");
  });

  it("deduplicates completion events and serializes automatic playback until the previous audio ends", async () => {
    const { runtime, dependencies, audio } = fixture();
    runtime.onGenerated(message("first"));
    runtime.onGenerated(message("first"));
    runtime.onGenerated(message("second"));
    await flush();
    expect(dependencies.synthesize).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().queuedCount).toBe(1);
    audio.onended!.call(audio as unknown as HTMLAudioElement, new Event("ended"));
    await flush();
    expect(dependencies.synthesize).toHaveBeenCalledTimes(2);
    expect(dependencies.synthesize.mock.calls[1][0]).toBe("second");
    expect(runtime.getSnapshot()).toMatchObject({ phase: "playing", messageId: "second", queuedCount: 0 });
    expect(dependencies.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("skips messages with no detected speech without calling the paid synthesis endpoint", async () => {
    const { runtime, dependencies } = fixture();
    dependencies.preview.mockResolvedValueOnce({ message_id: "empty", text: "", segments: [], warnings: [], max_characters: 10000 });
    runtime.onGenerated(message("empty"));
    runtime.onGenerated(message("spoken"));
    await flush();
    expect(dependencies.synthesize).toHaveBeenCalledTimes(1);
    expect(dependencies.synthesize.mock.calls[0][0]).toBe("spoken");
  });

  it("manual playback cancels the current automatic request and drops the remaining queue", async () => {
    const { runtime, dependencies } = fixture();
    const old = deferred<Blob>();
    dependencies.synthesize.mockReturnValueOnce(old.promise);
    runtime.onGenerated(message("old"));
    runtime.onGenerated(message("queued"));
    await flush();
    const previousSignal = dependencies.synthesize.mock.calls[0][2];
    await runtime.play(message("manual"), "修改后的朗读正文");
    expect(previousSignal.aborted).toBe(true);
    old.resolve(audioBlob);
    await flush();
    expect(dependencies.synthesize).toHaveBeenCalledTimes(2);
    expect(dependencies.synthesize.mock.calls[1].slice(0, 2)).toEqual(["manual", "修改后的朗读正文"]);
    expect(dependencies.createObjectURL).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot()).toMatchObject({ phase: "playing", messageId: "manual", queuedCount: 0 });
  });

  it("discards a late preview or audio response when switching sessions", async () => {
    const previewFixture = fixture();
    const preview = deferred<TtsPreview>();
    previewFixture.dependencies.preview.mockReturnValueOnce(preview.promise);
    previewFixture.runtime.onGenerated(message());
    const previewSignal = previewFixture.dependencies.preview.mock.calls[0][1];
    previewFixture.runtime.configure("two", settings, "alice");
    preview.resolve({ message_id: "reply", text: "old", segments: ["old"], warnings: [], max_characters: 10000 });
    await flush();
    expect(previewSignal.aborted).toBe(true);
    expect(previewFixture.dependencies.synthesize).not.toHaveBeenCalled();

    const { runtime, dependencies } = fixture();
    const response = deferred<Blob>();
    dependencies.synthesize.mockReturnValueOnce(response.promise);
    const playback = runtime.play(message());
    const signal = dependencies.synthesize.mock.calls[0][2];
    runtime.configure("two", settings, "alice");
    response.resolve(audioBlob);
    await playback;
    expect(signal.aborted).toBe(true);
    expect(dependencies.createObjectURL).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().phase).toBe("idle");
  });

  it.each([
    ["account", "bob", settings],
    ["manual mode", "alice", { ...settings, trigger_mode: "manual" as const }],
    ["disabled", "alice", { ...settings, enabled: false }],
    ["voice", "alice", { ...settings, voice: "other" }],
    ["revision", "alice", { ...settings, revision: 2 }]
  ])("stops and releases audio after changing %s", async (_label, account, nextSettings) => {
    const { runtime, dependencies, audio } = fixture();
    await runtime.play(message());
    runtime.configure("one", nextSettings, account);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe("");
    expect(dependencies.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
    expect(runtime.getSnapshot().phase).toBe("idle");
  });

  it("keeps blocked audio and resumes it without another synthesis request", async () => {
    const { runtime, dependencies, audio } = fixture();
    audio.play.mockRejectedValueOnce(new DOMException("Autoplay blocked", "NotAllowedError"));
    await runtime.play(message());
    expect(runtime.getSnapshot()).toMatchObject({ phase: "blocked", messageId: "reply" });
    expect(dependencies.revokeObjectURL).not.toHaveBeenCalled();
    await runtime.resume();
    expect(runtime.getSnapshot()).toMatchObject({ phase: "playing", error: null });
    expect(dependencies.synthesize).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    runtime.stop();
    expect(dependencies.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("surfaces provider and playback errors, and clears queued automatic work after failure", async () => {
    const { runtime, dependencies } = fixture();
    dependencies.synthesize.mockRejectedValueOnce(new Error("TTS API Key 无效"));
    runtime.onGenerated(message());
    runtime.onGenerated(message("queued"));
    await flush();
    expect(runtime.getSnapshot()).toMatchObject({ phase: "error", error: "TTS API Key 无效", queuedCount: 0 });
    expect(dependencies.synthesize).toHaveBeenCalledTimes(1);
    runtime.clearError();
    expect(runtime.getSnapshot().phase).toBe("idle");

    const broken = fixture();
    broken.audio.play.mockRejectedValueOnce(new Error("Decode failed"));
    await broken.runtime.play(message());
    expect(broken.runtime.getSnapshot()).toMatchObject({ phase: "error", error: "Decode failed" });
    expect(broken.dependencies.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("stopping ignores late rejection and late playback resolution without showing an error", async () => {
    const { runtime, dependencies } = fixture();
    const response = deferred<Blob>();
    dependencies.synthesize.mockReturnValueOnce(response.promise);
    const playback = runtime.play(message());
    runtime.stop();
    response.reject(new DOMException("Aborted", "AbortError"));
    await playback;
    expect(runtime.getSnapshot()).toMatchObject({ phase: "idle", error: null });

    const delayed = fixture();
    const started = deferred<void>();
    delayed.audio.play.mockReturnValueOnce(started.promise);
    const pendingPlay = delayed.runtime.play(message());
    await flush();
    delayed.runtime.stop();
    started.resolve();
    await pendingPlay;
    expect(delayed.runtime.getSnapshot()).toMatchObject({ phase: "idle", error: null });
    expect(delayed.dependencies.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects manual playback outside the current session or when disabled", async () => {
    const { runtime, dependencies } = fixture({ ...settings, enabled: false });
    await runtime.play(message());
    expect(runtime.getSnapshot().error).toContain("启用");
    runtime.configure("one", settings, "alice");
    await runtime.play(message("foreign", { session_id: "two" }));
    expect(runtime.getSnapshot().error).toContain("当前会话");
    expect(dependencies.synthesize).not.toHaveBeenCalled();
  });
});
