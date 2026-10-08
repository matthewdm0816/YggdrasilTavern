export const API_BASE = import.meta.env.VITE_API_BASE || "";
export const AUTH_REQUIRED_EVENT = "yggdrasil:auth-required";

export function notifyAuthenticationRequired(path: string, response: Response): void {
  if (response.status !== 401 || path === "/api/auth/login" || typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

export async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `请求失败（HTTP ${response.status}）：${response.statusText || "服务器没有返回错误详情"}`;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      const messages = payload.detail.map((item) => {
        if (!item || typeof item !== "object") return "请求内容无效";
        const value = item as { loc?: unknown; msg?: unknown };
        const location = Array.isArray(value.loc)
          ? value.loc.slice(1).map(String).join(".")
          : "";
        const message = typeof value.msg === "string" ? value.msg : "内容无效";
        return location ? `${location}：${message}` : message;
      });
      return messages.join("；");
    }
    if (payload.detail && typeof payload.detail === "object") {
      const detail = payload.detail as { message?: unknown; diagnostics?: unknown };
      if (typeof detail.message === "string") {
        const diagnostics = Array.isArray(detail.diagnostics) ? detail.diagnostics.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const diagnostic = item as { message?: unknown };
          return typeof diagnostic.message === "string" ? [diagnostic.message] : [];
        }) : [];
        return [detail.message, ...diagnostics].join("\n");
      }
    }
  } catch {
    // Non-JSON provider errors are intentionally returned as plain text.
  }
  if (text.trimStart().startsWith("<")) return `请求失败（HTTP ${response.status}）：服务器返回了网页，未返回 API 错误详情，请检查服务地址和代理配置。`;
  return `请求失败（HTTP ${response.status}）：${text.slice(0, 2000)}`;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }
  return response.json() as Promise<T>;
}

export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", body: form, credentials: "include" });
  if (!response.ok) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }
  return response.json() as Promise<T>;
}

export async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simpleName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : simpleName || fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
