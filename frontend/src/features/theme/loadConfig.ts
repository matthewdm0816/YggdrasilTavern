import { parseThemeConfig, ThemeConfig } from "./schema";

/** Fetches a replacement file at runtime. No generated app bundle is required. */
export async function loadThemeConfig(url: string, fetcher: typeof fetch = fetch, timeoutMs = 5000): Promise<ThemeConfig> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { cache: "no-store", signal: controller.signal, credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const source: unknown = await response.json();
    return parseThemeConfig(source);
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(`读取主题配置 ${url} 超时（${timeoutMs / 1000} 秒），当前可用主题已保留。`);
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`读取主题配置 ${url} 失败：${reason}。当前可用主题已保留。`);
  } finally {
    clearTimeout(timeout);
  }
}
