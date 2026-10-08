import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message, SessionTree } from "../lib/api";
import { WorkspaceInspector } from "./WorkspaceInspector";

function message(id: string, parentId: string | null): Message {
  return {
    id, session_id: "one", parent_id: parentId, selected_child_id: null,
    role: "assistant", speaker: "A", content: id, thinking_content: "",
    status: "complete", token_count: 0, thinking_token_count: 0, cached_tokens: 0,
    sort_order: 0, provider_metadata: {}, usage: {},
    created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00"
  };
}

function renderInspector(tree: SessionTree, selectedSessionId = tree.session.id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkspaceInspector tree={tree} selectedSessionId={selectedSessionId} activeProfileId="profile"
        worldbooks={[]} onSelectMessage={async () => undefined} onOpenTree={() => undefined}
        onCloseMobile={() => undefined} />
    </QueryClientProvider>
  );
}

describe("workspace inspector", () => {
  it("shows nearby forks first, keeps the complete-tree entry and disables unchanged saves", () => {
    const html = renderInspector({
      session: { id: "one", title: "One", preset: {} },
      messages: [message("root-active", null), message("root-alternate", null),
        message("inactive-descendant", "root-alternate")],
      active_path_ids: ["root-active"]
    });
    expect(html.indexOf("附近分叉")).toBeLessThan(html.indexOf("全局 Prompt Profile"));
    expect(html).toContain("root-alternate");
    expect(html).not.toContain("inactive-descendant");
    expect(html).toContain("打开完整树");
    expect(html).toContain('class="secondary-button inspector-save" disabled=""');
    expect(html).toContain('aria-label="关闭分支与设置"');
  });

  it("does not show a previous session tree while the newly selected session loads", () => {
    const html = renderInspector({
      session: { id: "one", title: "One", preset: {} },
      messages: [message("old-root", null), message("old-alternate", null)],
      active_path_ids: ["old-root"]
    }, "two");
    expect(html).not.toContain("old-alternate");
    expect(html).toContain("未选择会话");
  });
});
