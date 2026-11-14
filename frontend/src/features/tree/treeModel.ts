import { Message } from "../../lib/api";
import { displayMessageText, type MacroContext } from "../../lib/macros";
import { markdownPreviewText } from "../../lib/markdownPreview";
import { messageStatusLabel } from "../../lib/messageStatus";
import { sortMessages } from "../../lib/tree";

export type ForestNode = {
  message: Message;
  children: ForestNode[];
  descendantCount: number;
};

export type ForestModel = {
  roots: ForestNode[];
  warnings: string[];
};

export type VisibleForestRow = {
  node: ForestNode;
  depth: number;
  expanded: boolean;
  hiddenDescendantCount: number;
  isSearchMatch: boolean;
  siblingIndex: number;
  siblingCount: number;
};

export type RecollapseChainMeta = {
  nodeIds: string[];
  count: number;
};

export type DisplayMessageItem = {
  kind: "message";
  id: string;
  node: ForestNode;
  isOnActivePath: boolean;
  isCurrent: boolean;
  isPinned: boolean;
  isSearchMatch: boolean;
  expanded: boolean;
  hiddenDescendantCount: number;
  siblingIndex: number;
  siblingCount: number;
  recollapseChain?: RecollapseChainMeta;
  children: DisplayTreeItem[];
};

export type DisplayChainItem = {
  kind: "chain";
  id: string;
  nodeIds: string[];
  messages: Message[];
  count: number;
  isOnActivePath: boolean;
  siblingIndex: number;
  siblingCount: number;
  child: DisplayTreeItem;
};

export type DisplayTreeItem = DisplayMessageItem | DisplayChainItem;

export type BuildDisplayForestOptions = {
  expandedIds: ReadonlySet<string>;
  compressChains?: boolean;
  expandedChainNodeIds?: ReadonlySet<string>;
  activePathIds?: readonly string[];
  activeLeafId?: string | null;
  pinnedId?: string | null;
  searchQuery?: string;
  macroContext?: MacroContext;
};

export type DisplayForestResult = {
  roots: DisplayTreeItem[];
  totalVisibleMessages: number;
  compressedChainCount: number;
  compressedMessageCount: number;
  searchMatchCount: number;
};

export type TextSegment = {
  text: string;
  matched: boolean;
};

export function roleLabel(role: Message["role"]): string {
  if (role === "assistant") return "角色";
  if (role === "user") return "用户";
  return "系统";
}

export function messageSummary(message: Message, context?: MacroContext, maxLength = 110): string {
  const compact = markdownPreviewText(displayMessageText(message.content, context));
  if (!compact) {
    const thinkingCompact = markdownPreviewText(displayMessageText(message.thinking_content, context));
    if (thinkingCompact) {
      const snippet = thinkingCompact.length > maxLength ? `${thinkingCompact.slice(0, maxLength)}…` : thinkingCompact;
      return `（思考）${snippet}`;
    }
    return "（空消息）";
  }
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

export function searchableMessageText(message: Message, context?: MacroContext): string {
  return [
    message.id,
    message.speaker,
    roleLabel(message.role),
    message.role,
    message.status,
    messageStatusLabel(message.status),
    message.content,
    displayMessageText(message.content, context),
    message.thinking_content,
    displayMessageText(message.thinking_content, context)
  ]
    .join("\n")
    .toLocaleLowerCase();
}

export function thinkingMatchesQuery(message: Message, searchQuery: string, context?: MacroContext): boolean {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query || !message.thinking_content) return false;
  const combined = `${message.thinking_content}\n${displayMessageText(message.thinking_content, context)}`.toLocaleLowerCase();
  return combined.includes(query);
}

/** Splits plain text into matched and unmatched segments for safe search highlighting. */
export function highlightTextSegments(text: string, searchQuery: string): TextSegment[] {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query || !text) return [{ text, matched: false }];

  const lower = text.toLocaleLowerCase();
  if (lower.length !== text.length) {
    return [{ text, matched: lower.includes(query) }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hit = lower.indexOf(query, cursor);
    if (hit < 0) {
      segments.push({ text: text.slice(cursor), matched: false });
      break;
    }
    if (hit > cursor) {
      segments.push({ text: text.slice(cursor, hit), matched: false });
    }
    segments.push({ text: text.slice(hit, hit + query.length), matched: true });
    cursor = hit + query.length;
  }
  return segments.length > 0 ? segments : [{ text, matched: false }];
}

function walkForest(nodes: ForestNode[], visit: (node: ForestNode) => void) {
  for (const node of nodes) {
    visit(node);
    walkForest(node.children, visit);
  }
}

export function buildForest(messages: Message[]): ForestModel {
  const ids = new Set(messages.map((message) => message.id));
  const childrenByParent = new Map<string, Message[]>();
  const warnings = new Set<string>();
  let missingParentCount = 0;

  for (const message of messages) {
    if (!message.parent_id || !ids.has(message.parent_id)) {
      if (message.parent_id) missingParentCount += 1;
      continue;
    }
    const children = childrenByParent.get(message.parent_id) || [];
    children.push(message);
    childrenByParent.set(message.parent_id, children);
  }

  if (missingParentCount > 0) {
    warnings.add(`${missingParentCount} 个节点引用了不存在的父节点，已将它们作为根节点显示。`);
  }
  const visited = new Set<string>();

  function visit(message: Message, ancestors: Set<string>): ForestNode {
    visited.add(message.id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(message.id);
    const children: ForestNode[] = [];

    for (const child of sortMessages(childrenByParent.get(message.id) || [])) {
      if (nextAncestors.has(child.id)) {
        warnings.add("检测到聊天树中的循环引用；循环边已断开，其余节点仍会显示。");
        continue;
      }
      if (visited.has(child.id)) {
        warnings.add("检测到重复连接的聊天节点；重复边已忽略。");
        continue;
      }
      children.push(visit(child, nextAncestors));
    }

    const descendantCount = children.reduce((total, child) => total + child.descendantCount + 1, 0);
    return { message, children, descendantCount };
  }

  const rootMessages = sortMessages(messages.filter((message) => !message.parent_id || !ids.has(message.parent_id)));
  const roots = rootMessages.map((message) => visit(message, new Set<string>()));

  for (const message of sortMessages(messages)) {
    if (visited.has(message.id)) continue;
    warnings.add("检测到未连接到根节点的消息，已将它们作为独立树显示。");
    roots.push(visit(message, new Set<string>()));
  }

  return { roots, warnings: [...warnings] };
}

export function allExpandableNodeIds(model: ForestModel): Set<string> {
  const ids = new Set<string>();
  walkForest(model.roots, (node) => {
    if (node.children.length > 0) ids.add(node.message.id);
  });
  return ids;
}

export function activePathExpandedNodeIds(model: ForestModel, activePathIds: string[]): Set<string> {
  const activePath = new Set(activePathIds);
  const ids = new Set<string>();
  walkForest(model.roots, (node) => {
    if (node.children.length > 0 && activePath.has(node.message.id)) ids.add(node.message.id);
  });
  return ids;
}

export function visibleForestRows(
  model: ForestModel,
  expandedIds: ReadonlySet<string>,
  searchQuery = "",
  context?: MacroContext
): VisibleForestRow[] {
  const query = searchQuery.trim().toLocaleLowerCase();
  const subtreeMatches = new Map<string, boolean>();

  function isMatch(node: ForestNode): boolean {
    return Boolean(query) && searchableMessageText(node.message, context).includes(query);
  }

  function hasMatch(node: ForestNode): boolean {
    const cached = subtreeMatches.get(node.message.id);
    if (cached !== undefined) return cached;
    const matches = isMatch(node) || node.children.some(hasMatch);
    subtreeMatches.set(node.message.id, matches);
    return matches;
  }

  const rows: VisibleForestRow[] = [];
  function visit(nodes: ForestNode[], depth: number) {
    const visibleSiblings = query ? nodes.filter(hasMatch) : nodes;
    visibleSiblings.forEach((node, index) => {
      const matchingChildren = query ? node.children.filter(hasMatch) : node.children;
      const expanded = node.children.length > 0 && (query ? matchingChildren.length > 0 : expandedIds.has(node.message.id));
      rows.push({
        node,
        depth,
        expanded,
        hiddenDescendantCount: !query && !expanded ? node.descendantCount : 0,
        isSearchMatch: isMatch(node),
        siblingIndex: index + 1,
        siblingCount: visibleSiblings.length
      });
      if (expanded) visit(matchingChildren, depth + 1);
    });
  }

  visit(model.roots, 0);
  return rows;
}

export function shouldJumpToNode(pinnedId: string | null, messageId: string): boolean {
  return pinnedId === messageId;
}

type RawVisibleNode = {
  node: ForestNode;
  expanded: boolean;
  hiddenDescendantCount: number;
  isSearchMatch: boolean;
  siblingIndex: number;
  siblingCount: number;
  visibleChildren: RawVisibleNode[];
};

/**
 * Builds the shared display forest used by both canvas and metro modes,
 * applying search path expansion and contiguous single-line chain compression.
 */
export function buildDisplayForest(model: ForestModel, options: BuildDisplayForestOptions): DisplayForestResult {
  const {
    expandedIds,
    compressChains = true,
    expandedChainNodeIds = new Set<string>(),
    activePathIds = [],
    activeLeafId = null,
    pinnedId = null,
    searchQuery = "",
    macroContext
  } = options;

  const query = searchQuery.trim().toLocaleLowerCase();
  const activePath = new Set(activePathIds);
  const subtreeMatches = new Map<string, boolean>();
  const directMatches = new Map<string, boolean>();

  function isMatch(node: ForestNode): boolean {
    const cached = directMatches.get(node.message.id);
    if (cached !== undefined) return cached;
    const matched = Boolean(query) && searchableMessageText(node.message, macroContext).includes(query);
    directMatches.set(node.message.id, matched);
    return matched;
  }

  function hasMatch(node: ForestNode): boolean {
    const cached = subtreeMatches.get(node.message.id);
    if (cached !== undefined) return cached;
    const matched = isMatch(node) || node.children.some(hasMatch);
    subtreeMatches.set(node.message.id, matched);
    return matched;
  }

  let totalVisibleMessages = 0;
  let searchMatchCount = 0;

  function buildRawNodes(nodes: ForestNode[]): RawVisibleNode[] {
    const visibleSiblings = query ? nodes.filter(hasMatch) : nodes;
    return visibleSiblings.map((node, index) => {
      const matchingChildren = query ? node.children.filter(hasMatch) : node.children;
      const expanded = node.children.length > 0 && (query ? matchingChildren.length > 0 : expandedIds.has(node.message.id));
      const matched = isMatch(node);
      totalVisibleMessages += 1;
      if (matched) searchMatchCount += 1;
      return {
        node,
        expanded,
        hiddenDescendantCount: !query && !expanded ? node.descendantCount : 0,
        isSearchMatch: matched,
        siblingIndex: index + 1,
        siblingCount: visibleSiblings.length,
        visibleChildren: expanded ? buildRawNodes(matchingChildren) : []
      };
    });
  }

  const rawRoots = buildRawNodes(model.roots);
  let compressedChainCount = 0;
  let compressedMessageCount = 0;

  function isStructuralChainCandidate(raw: RawVisibleNode, isRoot: boolean): boolean {
    if (isRoot) return false;
    if (raw.node.children.length !== 1 || raw.visibleChildren.length !== 1) return false;
    const id = raw.node.message.id;
    if (id === activeLeafId) return false;
    if (raw.isSearchMatch) return false;
    return true;
  }

  function makeMessageItem(
    raw: RawVisibleNode,
    children: DisplayTreeItem[],
    recollapseChain?: RecollapseChainMeta
  ): DisplayMessageItem {
    const id = raw.node.message.id;
    return {
      kind: "message",
      id,
      node: raw.node,
      isOnActivePath: activePath.has(id),
      isCurrent: activeLeafId === id,
      isPinned: pinnedId === id,
      isSearchMatch: raw.isSearchMatch,
      expanded: raw.expanded,
      hiddenDescendantCount: raw.hiddenDescendantCount,
      siblingIndex: raw.siblingIndex,
      siblingCount: raw.siblingCount,
      ...(recollapseChain ? { recollapseChain } : {}),
      children
    };
  }

  function makeChainOrNodes(segment: RawVisibleNode[], tail: DisplayTreeItem): DisplayTreeItem {
    if (segment.length === 0) return tail;
    if (segment.length === 1) return makeMessageItem(segment[0], [tail]);
    compressedChainCount += 1;
    compressedMessageCount += segment.length;
    const first = segment[0];
    return {
      kind: "chain",
      id: `chain:${first.node.message.id}`,
      nodeIds: segment.map((entry) => entry.node.message.id),
      messages: segment.map((entry) => entry.node.message),
      count: segment.length,
      isOnActivePath: segment.every((entry) => activePath.has(entry.node.message.id)),
      siblingIndex: first.siblingIndex,
      siblingCount: first.siblingCount,
      child: tail
    };
  }

  function convert(raw: RawVisibleNode, isRoot: boolean): DisplayTreeItem {
    if (!compressChains || !isStructuralChainCandidate(raw, isRoot)) {
      return makeMessageItem(raw, raw.visibleChildren.map((child) => convert(child, false)));
    }

    const chain: RawVisibleNode[] = [];
    let cursor: RawVisibleNode = raw;
    while (isStructuralChainCandidate(cursor, false)) {
      chain.push(cursor);
      cursor = cursor.visibleChildren[0];
    }

    const tailItem = convert(cursor, false);
    if (chain.length < 2) {
      return makeMessageItem(chain[0], [tailItem]);
    }

    const nodeIds = chain.map((entry) => entry.node.message.id);
    const manuallyExpanded = nodeIds.some((id) => expandedChainNodeIds.has(id));
    if (manuallyExpanded) {
      let currentChild: DisplayTreeItem = tailItem;
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        const recollapse = index === 0 ? { nodeIds, count: chain.length } : undefined;
        currentChild = makeMessageItem(chain[index], [currentChild], recollapse);
      }
      return currentChild;
    }

    const pinnedIndex = chain.findIndex((entry) => entry.node.message.id === pinnedId);
    if (pinnedIndex < 0) {
      return makeChainOrNodes(chain, tailItem);
    }

    const before = chain.slice(0, pinnedIndex);
    const pinnedRaw = chain[pinnedIndex];
    const after = chain.slice(pinnedIndex + 1);
    const afterItem = makeChainOrNodes(after, tailItem);
    const pinnedItem = makeMessageItem(pinnedRaw, [afterItem]);
    return makeChainOrNodes(before, pinnedItem);
  }

  const roots = rawRoots.map((root) => convert(root, true));
  return {
    roots,
    totalVisibleMessages,
    compressedChainCount,
    compressedMessageCount,
    searchMatchCount
  };
}

export function getDisplayChildren(item: DisplayTreeItem): DisplayTreeItem[] {
  return item.kind === "chain" ? [item.child] : item.children;
}

export function itemHasSearchMatch(item: DisplayTreeItem): boolean {
  if (item.kind === "message" && item.isSearchMatch) return true;
  return getDisplayChildren(item).some(itemHasSearchMatch);
}
