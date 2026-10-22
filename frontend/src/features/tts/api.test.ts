import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_EVENT } from "../../lib/api/http";
import { setStorageUser } from "../../lib/userStorage";
import { ttsApi } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setStorageUser(null);
});

describe("TTS audio requests", () => {
  it("binds audio requests to the current account, includes cookies and forwards cancellation", async () => {
    setStorageUser({ id: "alice", is_owner: false });
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => new Response(new Blob(["audio"]), { headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await ttsApi.synthesize("reply/id", "已确认的正文", signal);
    expect(result.size).toBe(5);
    expect(fetchMock).toHaveBeenCalledWith("/api/messages/reply%2Fid/tts", {
      method: "POST", credentials: "include", signal,
      headers: { "Content-Type": "application/json", "X-Yggdrasil-User": "alice" },
      body: JSON.stringify({ text: "已确认的正文" })
    });
  });

  it("shows the provider error and notifies the app when the account needs authentication", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "登录已失效" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    })));
    await expect(ttsApi.synthesize("reply")).rejects.toThrow("登录已失效");
    expect(dispatchEvent.mock.calls[0][0].type).toBe(AUTH_REQUIRED_EVENT);
  });

  it("rejects successful HTTP responses containing HTML or empty audio instead of creating playback", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html>proxy page</html>", { headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(new Response("", { headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(ttsApi.synthesize("reply")).rejects.toThrow("没有返回可播放的音频");
    await expect(ttsApi.synthesize("reply")).rejects.toThrow("空音频");
  });

  it("forwards transport cancellation without converting it into a provider error", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url, input: RequestInit) => {
      expect(input.signal).toBe(controller.signal);
      throw new DOMException("Aborted", "AbortError");
    }));
    controller.abort();
    await expect(ttsApi.synthesize("reply", undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
