import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SessionTree } from "../../lib/api";
import { useChatController } from "./useChatController";
import { treeQueryKey } from "./treeCache";

afterEach(() => vi.unstubAllGlobals());

function captureTreeQuery(initial: SessionTree) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(treeQueryKey(initial.session.id), initial);
  function Capture() {
    useChatController({ selectedSessionId: initial.session.id, activeProfileId: "profile" });
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Capture)));
  return client;
}

describe("session tree request cancellation", () => {
  it("still loads a session tree when no cancellation signal is supplied", async () => {
    const initial: SessionTree = { session: { id: "one", title: "initial", preset: {} }, messages: [], active_path_ids: [] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(initial)));
    vi.stubGlobal("fetch", fetch);
    expect(await api.tree("one")).toEqual(initial);
    expect(fetch).toHaveBeenCalledWith("/api/sessions/one/tree", expect.objectContaining({ signal: undefined }));
  });

  it("aborts the HTTP request and preserves the newer cache after query cancellation", async () => {
    const initial: SessionTree = { session: { id: "one", title: "initial", preset: {} }, messages: [], active_path_ids: [] };
    const client = captureTreeQuery(initial);
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    let finishRequest!: () => void;
    let aborted = false;
    let requestSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      requestSignal = options.signal;
      finishRequest = () => resolve(new Response(JSON.stringify(initial)));
      requestSignal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
      requestStarted();
    })));
    const pending = client.refetchQueries({ queryKey: treeQueryKey("one"), exact: true, type: "all" });
    await started;
    try {
      await client.cancelQueries({ queryKey: treeQueryKey("one"), exact: true });
      const newer = { ...initial, session: { ...initial.session, title: "newer selection" } };
      client.setQueryData(treeQueryKey("one"), newer);
      finishRequest();
      await pending;
      expect(aborted).toBe(true);
      expect(requestSignal?.aborted).toBe(true);
      expect(client.getQueryData<SessionTree>(treeQueryKey("one"))?.session.title).toBe("newer selection");
    } finally {
      finishRequest();
      await pending;
      client.clear();
    }
  });
});
