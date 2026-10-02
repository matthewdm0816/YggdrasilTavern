import type { Message, SessionTree } from "../../lib/api";
import { sortMessages } from "../../lib/tree";

export type NearbyBranchGroup = {
  parentId: string | null;
  messagePosition: number;
  activeMessageId: string | null;
  branches: Message[];
};

/** Read same-parent alternatives on the active path, nearest to the tip first. */
export function nearbyBranchGroups(tree?: SessionTree): NearbyBranchGroup[] {
  if (!tree) return [];
  const messagesById = new Map(tree.messages.map((message) => [message.id, message]));
  const childrenByParent = new Map<string | null, Message[]>();
  for (const message of tree.messages) {
    const parentId = message.parent_id ?? null;
    const children = childrenByParent.get(parentId) || [];
    children.push(message);
    childrenByParent.set(parentId, children);
  }
  const groups: NearbyBranchGroup[] = [];
  const visitedParents = new Set<string | null>();
  for (let index = 0; index < tree.active_path_ids.length; index += 1) {
    const message = messagesById.get(tree.active_path_ids[index]);
    if (!message) continue;
    const parentId = message.parent_id ?? null;
    if (visitedParents.has(parentId)) continue;
    visitedParents.add(parentId);
    const siblings = childrenByParent.get(parentId) || [];
    if (siblings.length > 1) groups.push({
      parentId,
      messagePosition: index + 1,
      activeMessageId: message.id,
      branches: sortMessages(siblings)
    });
  }
  const tipId = tree.active_path_ids[tree.active_path_ids.length - 1] || null;
  const nextBranches = childrenByParent.get(tipId) || [];
  if (!visitedParents.has(tipId) && nextBranches.length) groups.push({
    parentId: tipId,
    messagePosition: tree.active_path_ids.length + 1,
    activeMessageId: null,
    branches: sortMessages(nextBranches)
  });
  return groups.reverse();
}
