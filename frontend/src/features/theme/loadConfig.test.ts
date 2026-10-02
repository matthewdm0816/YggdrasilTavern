import { describe, expect, it, vi } from "vitest";
import source from "../../../public/themes.json";
import { loadThemeConfig } from "./loadConfig";

describe("runtime theme file loading", () => {
  it("requests the replaceable file without using the browser cache", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(source), { status: 200 }));
    const config = await loadThemeConfig("/themes.json", fetcher);
    expect(config.defaultThemeId).toBe("default");
    expect(fetcher).toHaveBeenCalledWith("/themes.json", expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }));
  });

  it("reports HTTP, JSON syntax, and config field errors with the file URL", async () => {
    await expect(loadThemeConfig("/themes.json", vi.fn().mockResolvedValue(new Response("", { status: 404 })))).rejects.toThrow("/themes.json 失败：HTTP 404");
    await expect(loadThemeConfig("/themes.json", vi.fn().mockResolvedValue(new Response("{ broken")))).rejects.toThrow("/themes.json 失败");
    await expect(loadThemeConfig("/themes.json", vi.fn().mockResolvedValue(new Response('{"version": 2}')))).rejects.toThrow("主题配置 version");
  });

  it("aborts a stalled request and tells the user that the current theme is retained", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await expect(loadThemeConfig("/themes.json", fetcher, 10)).rejects.toThrow("超时（0.01 秒），当前可用主题已保留");
  });
});
