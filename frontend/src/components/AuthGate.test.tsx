import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, AUTH_REQUIRED_EVENT, streamGenerate } from "../lib/api";
import { AuthGate, authAllowsApplication, readableAuthError } from "./AuthGate";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthGate", () => {
  it("blocks application children until the initial status check succeeds", () => {
    const html = renderToStaticMarkup(<AuthGate><div>private application</div></AuthGate>);
    expect(html).toContain("正在验证访问权限");
    expect(html).not.toContain("private application");
  });

  it("allows disabled or authenticated instances and provides Chinese errors", () => {
    expect(authAllowsApplication({ enabled: false, authenticated: false, username: null })).toBe(true);
    expect(authAllowsApplication({ enabled: true, authenticated: true, username: "owner" })).toBe(true);
    expect(authAllowsApplication({ enabled: true, authenticated: false, username: null })).toBe(false);
    expect(readableAuthError(new Error("Invalid username or password"))).toBe("用户名或密码错误。");
  });
});

describe("authenticated API transport", () => {
  it("includes cookies for ordinary requests, uploads, downloads, and streams", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, options });
      if (url.includes("/export")) return jsonResponse({ detail: "download denied" }, 401);
      if (url.includes("/generate/stream")) {
        const message = {
          id: "message-id", session_id: "session-id", parent_id: null, selected_child_id: null,
          role: "assistant", speaker: "Assistant", content: "", thinking_content: "",
          status: "complete", token_count: 0, thinking_token_count: 0, cached_tokens: 0,
          sort_order: 0, provider_metadata: {}, usage: {}, created_at: "", updated_at: ""
        };
        return new Response("event: message_completed\ndata: " + JSON.stringify(message) + "\n\n", {
          headers: { "Content-Type": "text/event-stream" }
        });
      }
      return jsonResponse({ enabled: false, authenticated: true, username: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.authStatus();
    await api.importCharacter(new Blob(["card"]) as File);
    await expect(api.exportCharacter("character-id")).rejects.toThrow("download denied");
    await streamGenerate("session-id", { api_profile_id: "profile-id" }, {});

    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.options.credentials).toBe("include");
    expect(calls[3].options.body).toBe(JSON.stringify({ api_profile_id: "profile-id" }));
  });

  it("exposes typed login and logout calls with cookie credentials", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options: RequestInit = {}) => {
      calls.push({ url: String(input), options });
      return jsonResponse({ enabled: true, authenticated: true, username: "owner" });
    }));

    await api.authLogin({ username: "owner", password: "secret" });
    await api.authLogout();

    expect(calls.map((call) => call.url)).toEqual(["/api/auth/login", "/api/auth/logout"]);
    expect(calls[0].options).toMatchObject({ method: "POST", credentials: "include" });
    expect(calls[0].options.body).toBe(JSON.stringify({ username: "owner", password: "secret" }));
    expect(calls[1].options).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("emits auth-required on protected 401 responses but not failed login", async () => {
    const browserWindow = new EventTarget();
    let authRequiredCount = 0;
    browserWindow.addEventListener(AUTH_REQUIRED_EVENT, () => { authRequiredCount += 1; });
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "Authentication required" }, 401)));

    await expect(api.characters()).rejects.toThrow("Authentication required");
    expect(authRequiredCount).toBe(1);

    await expect(api.authLogin({ username: "owner", password: "wrong" })).rejects.toThrow("Authentication required");
    expect(authRequiredCount).toBe(1);
  });
});
