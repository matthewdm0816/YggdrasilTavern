import { Message, SessionTree } from "./api";

export function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

export function activeMessages(tree?: SessionTree): Message[] {
  if (!tree) return [];
  return tree.active_path_ids.map((id) => tree.messages.find((message) => message.id === id)).filter(Boolean) as Message[];
}

export function siblingsFor(tree: SessionTree | undefined, message: Message): Message[] {
  if (!tree) return [message];
  return sortMessages(tree.messages.filter((item) => item.parent_id === message.parent_id));
}

function freshestStreamText(remote: string, local: string, field: string, messageId: string): string {
  if (local.startsWith(remote)) return local;
  if (remote.startsWith(local)) return remote;
  console.error("Streaming message buffers diverged while switching swipes.", {
    messageId,
    field,
    remoteLength: remote.length,
    localLength: local.length
  });
  return local.length >= remote.length ? local : remote;
}

function reconcileMessage(local: Message | undefined, remote: Message): Message {
  if (!local) return remote;
  if (local.status !== "streaming" && remote.status === "streaming") return local;
  if (local.status === "streaming" && remote.status !== "streaming") return remote;
  if (local.status !== "streaming" && remote.status !== "streaming") {
    return local.updated_at > remote.updated_at ? local : remote;
  }
  return {
    ...remote,
    content: freshestStreamText(remote.content, local.content, "content", remote.id),
    thinking_content: freshestStreamText(remote.thinking_content, local.thinking_content, "thinking_content", remote.id),
    token_count: Math.max(remote.token_count, local.token_count),
    thinking_token_count: Math.max(remote.thinking_token_count, local.thinking_token_count),
    cached_tokens: Math.max(remote.cached_tokens, local.cached_tokens),
    provider_metadata: { ...remote.provider_metadata, ...local.provider_metadata },
    usage: { ...remote.usage, ...local.usage },
    generation_run: remote.generation_run || local.generation_run
  };
}

export function mergeStreamingMessages(current: SessionTree | undefined, incoming: SessionTree): SessionTree {
  if (!current || current.session.id !== incoming.session.id) return incoming;
  const currentById = new Map(current.messages.map((message) => [message.id, message]));
  const incomingIds = new Set(incoming.messages.map((message) => message.id));
  return {
    ...incoming,
    // There is no message deletion API. An absent local message means this
    // server snapshot started before the local message was created.
    messages: [
      ...incoming.messages.map((remote) => reconcileMessage(currentById.get(remote.id), remote)),
      ...current.messages.filter((local) => !incomingIds.has(local.id))
    ]
  };
}
