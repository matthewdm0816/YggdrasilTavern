import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { Message, SessionTree } from "../../lib/api";
import { SessionGenerationRegistry } from "./SessionGenerationRegistry";
import { SessionSelectionQueue } from "./SessionSelectionQueue";
import { loadTreeSnapshot, reconcileTreeSnapshot, treeQueryKey, upsertTreeMessage } from "./treeCache";
import { SessionTreeEpoch } from "./SessionTreeEpoch";

function tree(sessionId: string, messages: Message[] = []): SessionTree {
  return { session: { id: sessionId, title: sessionId, preset: {} }, messages, active_path_ids: messages.map((message) => message.id) };
}

function message(sessionId: string, content: string, status = "streaming"): Message {
  return {
    id: sessionId + "-reply",
    session_id: sessionId,
    parent_id: null,
    selected_child_id: null,
    role: "assistant",
    speaker: "A",
    content,
    thinking_content: "",
    status,
    token_count: 0,
    thinking_token_count: 0,
    cached_tokens: 0,
    sort_order: 0,
    provider_metadata: {},
    usage: {},
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00"
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("session concurrency", () => {
  it("runs different sessions independently and stops only the selected session", () => {
    const registry = new SessionGenerationRegistry();
    const first = registry.begin("one")!;
    expect(registry.begin("one")).toBeNull();
    const second = registry.begin("two")!;
    registry.stop("one");
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    registry.finish("one", first);
    expect(registry.begin("one")).not.toBeNull();
  });

  it("serializes choices in one session and applies only the newest choice", async () => {
    const queue = new SessionSelectionQueue();
    const first = deferred<SessionTree>();
    const second = deferred<SessionTree>();
    const requested: string[] = [];
    const applied: string[] = [];
    const a = queue.run("one", () => { requested.push("first"); return first.promise; }, (value) => applied.push(value.session.title));
    const b = queue.run("one", () => { requested.push("second"); return second.promise; }, (value) => applied.push(value.session.title));
    await Promise.resolve();
    expect(requested).toEqual(["first"]);
    first.resolve({ ...tree("one"), session: { id: "one", title: "first", preset: {} } });
    await a;
    await Promise.resolve();
    expect(requested).toEqual(["first", "second"]);
    second.resolve({ ...tree("one"), session: { id: "one", title: "second", preset: {} } });
    await b;
    expect(applied).toEqual(["second"]);
  });

  it("does not queue one session behind another", async () => {
    const queue = new SessionSelectionQueue();
    const one = deferred<SessionTree>();
    const two = deferred<SessionTree>();
    const requested: string[] = [];
    const a = queue.run("one", () => { requested.push("one"); return one.promise; }, () => undefined);
    const b = queue.run("two", () => { requested.push("two"); return two.promise; }, () => undefined);
    await Promise.resolve();
    expect(requested).toEqual(["one", "two"]);
    one.resolve(tree("one"));
    two.resolve(tree("two"));
    await Promise.all([a, b]);
  });

  it("reconciles an older server snapshot without changing another session", () => {
    const client = new QueryClient();
    const localOne = tree("one", [message("one", "long partial")]);
    const localTwo = tree("two", [message("two", "other session")]);
    client.setQueryData(treeQueryKey("one"), localOne);
    client.setQueryData(treeQueryKey("two"), localTwo);
    const result = reconcileTreeSnapshot(client, tree("one", [message("one", "long")]));
    expect(result.messages[0].content).toBe("long partial");
    expect(client.getQueryData(treeQueryKey("two"))).toBe(localTwo);
    const terminal = reconcileTreeSnapshot(client, tree("one", [message("one", "final", "complete")]));
    expect(terminal.messages[0].content).toBe("final");
  });
  it("keeps a locally created message when an older GET omits it", async () => {
    const client = new QueryClient();
    const epoch = new SessionTreeEpoch();
    const oldGet = deferred<SessionTree>();
    client.setQueryData(treeQueryKey("one"), tree("one"));
    const pending = loadTreeSnapshot(client, "one", () => oldGet.promise, epoch);
    epoch.advance("one");
    const created = tree("one", [message("one", "new stream")]);
    client.setQueryData(treeQueryKey("one"), created);
    oldGet.resolve(tree("one"));
    const result = await pending;
    expect(result.messages.map((item) => item.content)).toEqual(["new stream"]);
    expect(result.active_path_ids).toEqual(created.active_path_ids);
  });

  it("keeps a local terminal message when a delayed server snapshot still says streaming", () => {
    const client = new QueryClient();
    client.setQueryData(treeQueryKey("one"), tree("one", [message("one", "final answer", "complete")]));
    const delayed = tree("one", [message("one", "partial")]);
    delayed.active_path_ids = [];
    const result = reconcileTreeSnapshot(client, delayed);
    expect(result.messages[0].status).toBe("complete");
    expect(result.messages[0].content).toBe("final answer");
    expect(result.active_path_ids).toEqual([]);
  });

  it("discards a GET started before a branch selection but accepts a later branch snapshot", async () => {
    const client = new QueryClient();
    const epoch = new SessionTreeEpoch();
    const oldGet = deferred<SessionTree>();
    const first = { ...message("one", "first"), id: "first" };
    const second = { ...message("one", "second"), id: "second" };
    const initial = { ...tree("one", [first, second]), active_path_ids: ["first"] };
    client.setQueryData(treeQueryKey("one"), initial);
    const pending = loadTreeSnapshot(client, "one", () => oldGet.promise, epoch);
    epoch.advance("one");
    const selected = { ...initial, active_path_ids: ["second"] };
    reconcileTreeSnapshot(client, selected);
    epoch.advance("one");
    oldGet.resolve(initial);
    expect((await pending).active_path_ids).toEqual(["second"]);
    const later = await loadTreeSnapshot(client, "one", async () => initial, epoch);
    expect(later.active_path_ids).toEqual(["first"]);
  });
  it("does not switch back to a completed reply after the user chose another branch", () => {
    const earlier = { ...message("one", "streamed"), id: "generated" };
    const chosen = { ...message("one", "chosen"), id: "chosen" };
    const current = { ...tree("one", [earlier, chosen]), active_path_ids: ["chosen"] };
    const completed = upsertTreeMessage(current, { ...earlier, status: "complete", content: "finished" }, false)!;
    expect(completed.active_path_ids).toEqual(["chosen"]);
    expect(completed.messages.find((item) => item.id === "generated")?.content).toBe("finished");
  });
});
