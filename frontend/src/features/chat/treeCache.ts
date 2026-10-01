import { QueryClient } from "@tanstack/react-query";
import { Message, SessionTree } from "../../lib/api";
import { mergeStreamingMessages } from "../../lib/tree";
import { SessionTreeEpoch } from "./SessionTreeEpoch";

export function treeQueryKey(sessionId: string) {
  return ["tree", sessionId] as const;
}

export function reconcileTreeSnapshot(queryClient: QueryClient, incoming: SessionTree): SessionTree {
  const key = treeQueryKey(incoming.session.id);
  const current = queryClient.getQueryData<SessionTree>(key);
  const reconciled = mergeStreamingMessages(current, incoming);
  queryClient.setQueryData(key, reconciled);
  return reconciled;
}

export async function loadTreeSnapshot(
  queryClient: QueryClient,
  sessionId: string,
  load: () => Promise<SessionTree>,
  epoch: SessionTreeEpoch,
  signal?: AbortSignal
): Promise<SessionTree> {
  const revision = epoch.capture(sessionId);
  const incoming = await load();
  if (incoming.session.id !== sessionId) throw new Error("Session tree response belongs to another session.");
  const current = queryClient.getQueryData<SessionTree>(treeQueryKey(sessionId));
  if (signal?.aborted || !epoch.isCurrent(sessionId, revision)) {
    // A mutation completed after this GET began. Keep its newer path and messages.
    return current || incoming;
  }
  return mergeStreamingMessages(current, incoming);
}

export function upsertTreeMessage(tree: SessionTree | undefined, message: Message, activate = true): SessionTree | undefined {
  if (!tree || tree.session.id !== message.session_id) return tree;
  const exists = tree.messages.some((item) => item.id === message.id);
  const activeSiblingIndex = tree.active_path_ids.findIndex((id) => {
    const active = tree.messages.find((item) => item.id === id);
    return Boolean(active && active.parent_id === message.parent_id && active.id !== message.id);
  });
  const activePath = !activate
    ? tree.active_path_ids
    : activeSiblingIndex >= 0
      ? [...tree.active_path_ids.slice(0, activeSiblingIndex), message.id]
      : tree.active_path_ids.includes(message.id)
        ? tree.active_path_ids
        : [...tree.active_path_ids, message.id];
  return {
    ...tree,
    messages: exists ? tree.messages.map((item) => (item.id === message.id ? message : item)) : [...tree.messages, message],
    active_path_ids: activePath
  };
}
