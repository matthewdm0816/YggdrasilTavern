import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, streamGenerate, type Message, type MessageTreeMutation, type SessionTree } from "../../lib/api";
import { useChatController } from "./useChatController";
import { treeQueryKey } from "./treeCache";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  streamGenerate: vi.fn()
}));

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

function controller(initial: SessionTree, generationLimit = 4) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(treeQueryKey(initial.session.id), initial);
  let chat!: ReturnType<typeof useChatController>;
  function Capture() {
    chat = useChatController({ selectedSessionId: initial.session.id, activeProfileId: "profile", generationLimit });
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Capture)));
  return { client, chat };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(streamGenerate).mockReset();
});

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

  it("saves edits and new branches of other messages while a reply is streaming", async () => {
    const prompt = message({ id: "prompt", role: "user", speaker: "User", content: "Old prompt", thinking_content: "" });
    const reply = message({ id: "reply", parent_id: "prompt", status: "streaming", content: "Streamed so far" });
    const { client, chat } = controller(tree([prompt, reply]));
    const edited = message({ ...prompt, content: "New prompt", updated_at: "2026-10-23" });
    const update = vi.spyOn(api, "updateMessage").mockResolvedValue(edited);
    // The server snapshot lags behind the text already streamed into the cache.
    vi.spyOn(api, "tree").mockResolvedValue(tree([edited, { ...reply, content: "Streamed" }]));
    await chat.handleUpdateMessage(prompt, "New prompt", "");
    expect(update).toHaveBeenCalledWith("prompt", { content: "New prompt", thinking_content: "" });
    const cached = client.getQueryData<SessionTree>(treeQueryKey("one"))?.messages;
    expect(cached?.find((item) => item.id === "prompt")?.content).toBe("New prompt");
    expect(cached?.find((item) => item.id === "reply")?.content).toBe("Streamed so far");

    const branch = message({ ...prompt, id: "prompt-branch", content: "Branch prompt", updated_at: "2026-10-23" });
    const create = vi.spyOn(api, "createSwipe").mockResolvedValue({ ...tree([edited, reply, branch]), active_path_ids: ["prompt-branch"] });
    await chat.handleCreateSwipe(prompt, "Branch prompt", "");
    expect(create).toHaveBeenCalledWith("prompt", expect.objectContaining({ content: "Branch prompt" }));
    expect(client.getQueryData<SessionTree>(treeQueryKey("one"))?.active_path_ids).toEqual(["prompt-branch"]);
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

describe("parallel generation", () => {
  it("streams several replies in one session from their own parents up to the page limit", async () => {
    const prompt = message({ id: "prompt", role: "user", speaker: "User", content: "Prompt" });
    const other = message({ id: "other", role: "user", speaker: "User", content: "Other branch" });
    const reply = message({ id: "reply", parent_id: "prompt" });
    const { chat } = controller(tree([prompt, other, reply]), 2);
    const releases: Array<() => void> = [];
    const stream = vi.mocked(streamGenerate).mockImplementation(() => new Promise<void>((resolve) => { releases.push(resolve); }));
    vi.spyOn(api, "tree").mockResolvedValue(tree([prompt, other, reply]));
    const first = chat.handleGenerate({ parentMessageId: "prompt" });
    const second = chat.handleGenerate({ regenerateMessageId: "reply" });
    const refused = chat.handleGenerate({ parentMessageId: "other" });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls.map((call) => [call[1].parent_message_id, call[1].regenerate_message_id]))
      .toEqual([["prompt", null], [null, "reply"]]);
    releases.forEach((release) => release());
    await Promise.all([first, second, refused]);
    void chat.handleGenerate({ parentMessageId: "other" });
    expect(stream).toHaveBeenCalledTimes(3);
    expect(stream.mock.calls[2][1].parent_message_id).toBe("other");
  });

  it("refuses to send below a reply that is still streaming", async () => {
    const prompt = message({ id: "prompt", role: "user", speaker: "User", content: "Prompt" });
    const reply = message({ id: "reply", parent_id: "prompt", status: "streaming" });
    const { chat } = controller(tree([prompt, reply]));
    const append = vi.spyOn(api, "appendMessage");
    await expect(chat.handleSend("next")).rejects.toThrow("还在生成");
    expect(append).not.toHaveBeenCalled();
    expect(streamGenerate).not.toHaveBeenCalled();
  });

  it("sends below the displayed path end and generates from the new prompt", async () => {
    const reply = message();
    const { chat } = controller(tree([reply]));
    const prompt = message({ id: "new-prompt", parent_id: "reply", role: "user", speaker: "User", content: "next" });
    const append = vi.spyOn(api, "appendMessage").mockResolvedValue(prompt);
    vi.spyOn(api, "tree").mockResolvedValue(tree([reply, prompt]));
    const stream = vi.mocked(streamGenerate).mockResolvedValue();
    await chat.handleSend("next");
    expect(append).toHaveBeenCalledWith("one", expect.objectContaining({ parent_id: "reply", content: "next" }));
    expect(stream).toHaveBeenCalledWith("one", expect.objectContaining({ parent_message_id: "new-prompt" }),
      expect.anything(), expect.anything());
  });
});
