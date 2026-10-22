import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type Message, type MessageTreeMutation, type SessionTree } from "../../lib/api";
import { useChatController } from "./useChatController";
import { treeQueryKey } from "./treeCache";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "reply", session_id: "one", parent_id: null, selected_child_id: null,
    role: "assistant", speaker: "Character", content: "Keep this content", thinking_content: "Keep this thinking",
    status: "complete", token_count: 4, thinking_token_count: 4, cached_tokens: 0,
    sort_order: 0, provider_metadata: {}, usage: {}, created_at: "2026-10-22", updated_at: "2026-10-22", ...overrides
  };
}

function tree(messages: Message[] = [message()], id = "one"): SessionTree {
  return { session: { id, title: id, preset: {} }, messages, active_path_ids: messages.map((item) => item.id) };
}

function controller(initial: SessionTree) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(treeQueryKey(initial.session.id), initial);
  let chat!: ReturnType<typeof useChatController>;
  function Capture() {
    chat = useChatController({ selectedSessionId: initial.session.id, activeProfileId: "profile" });
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Capture)));
  return { client, chat };
}

afterEach(() => vi.restoreAllMocks());

describe("chat tree mutations", () => {
  it("replaces a deleted tree and returns the deleted count without affecting another session", async () => {
    const { client, chat } = controller(tree());
    const other = tree([message({ id: "other-reply", session_id: "two" })], "two");
    client.setQueryData(treeQueryKey("two"), other);
    const remove = vi.spyOn(api, "deleteMessage").mockResolvedValue({ ...tree([]), deleted_count: 1 });
    expect(await chat.handleDeleteMessage(message(), "layer")).toBe(1);
    expect(remove).toHaveBeenCalledWith("reply", "layer");
    expect(client.getQueryData<SessionTree>(treeQueryKey("one"))?.messages).toEqual([]);
    expect(client.getQueryData(treeQueryKey("two"))).toBe(other);
  });

  it("changes only the requested role and preserves the server's content and descendants", async () => {
    const child = message({ id: "child", parent_id: "reply", content: "Descendant" });
    const { client, chat } = controller(tree([message(), child]));
    const changed = message({ role: "user", speaker: "User" });
    const update = vi.spyOn(api, "updateMessage").mockResolvedValue(changed);
    vi.spyOn(api, "tree").mockResolvedValue(tree([changed, child]));
    await chat.handleChangeMessageRole(message(), "user");
    expect(update).toHaveBeenCalledWith("reply", { role: "user" });
    expect(client.getQueryData<SessionTree>(treeQueryKey("one"))?.messages).toEqual([changed, child]);
  });

  it("rejects deletion, clearing and role changes while any message is streaming", async () => {
    const { chat } = controller(tree([message({ status: "streaming" })]));
    const remove = vi.spyOn(api, "deleteMessage");
    const clear = vi.spyOn(api, "pruneEmptyBranches");
    const update = vi.spyOn(api, "updateMessage");
    await expect(chat.handleDeleteMessage(message(), "swipe")).rejects.toThrow("请先停止");
    await expect(chat.handlePruneEmptyBranches()).rejects.toThrow("请先停止");
    await expect(chat.handleChangeMessageRole(message(), "user")).rejects.toThrow("请先停止");
    expect(remove).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks sends while deletion is pending and releases the guard after failure", async () => {
    const { client, chat } = controller(tree());
    let fail!: (cause: Error) => void;
    const pending = new Promise<MessageTreeMutation>((_resolve, reject) => { fail = reject; });
    const remove = vi.spyOn(api, "deleteMessage").mockReturnValue(pending);
    const append = vi.spyOn(api, "appendMessage");
    const deletion = chat.handleDeleteMessage(message(), "swipe");
    const rejected = expect(deletion).rejects.toThrow("Delete failed");
    await expect(chat.handleSend("new message")).rejects.toThrow("正在更新会话");
    expect(append).not.toHaveBeenCalled();
    fail(new Error("Delete failed"));
    await rejected;
    expect(client.getQueryData<SessionTree>(treeQueryKey("one"))?.messages).toHaveLength(1);
    remove.mockResolvedValue({ ...tree([]), deleted_count: 1 });
    await expect(chat.handleDeleteMessage(message(), "swipe")).resolves.toBe(1);
  });

  it("uses the pruning response's tree so retained ancestors stay visible", async () => {
    const emptyParent = message({ id: "parent", content: "", thinking_content: "" });
    const preservedChild = message({ id: "child", parent_id: "parent" });
    const emptyLeaf = message({ id: "empty", parent_id: "parent", content: " ", thinking_content: "\n" });
    const { client, chat } = controller(tree([emptyParent, preservedChild, emptyLeaf]));
    vi.spyOn(api, "pruneEmptyBranches").mockResolvedValue({ ...tree([emptyParent, preservedChild]), deleted_count: 1 });
    expect(await chat.handlePruneEmptyBranches()).toBe(1);
    expect(client.getQueryData<SessionTree>(treeQueryKey("one"))?.messages).toEqual([emptyParent, preservedChild]);
  });
});
