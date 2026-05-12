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
