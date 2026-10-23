import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatWorkspace } from "./ChatWorkspace";
import { RegexMessage } from "./RegexMessage";
import type { Message, RegexRule, SessionTree } from "../lib/api";

const invalidRule: RegexRule = {
  id: "broken", name: "Broken preview", enabled: true, scope: "global",
  mode: "hover", targets: ["display"], pattern: "[", replacement: "x", flags: "",
};

describe("chat-level Regex errors", () => {
  it("renders an invalid enabled rule only once in a long conversation", () => {
    const messages: Message[] = Array.from({ length: 20 }, (_, index) => ({
      id: "m" + index, session_id: "session", parent_id: index ? "m" + (index - 1) : null,
      selected_child_id: index < 19 ? "m" + (index + 1) : null,
      role: "assistant", speaker: "A", content: "Message " + index, thinking_content: "",
      status: "complete", sort_order: index, token_count: 1, thinking_token_count: 0, cached_tokens: 0,
      provider_metadata: {}, usage: {}, created_at: "", updated_at: "",
    }));
    const tree: SessionTree = {
      session: { id: "session", title: "QA", preset: {}, active_root_child_id: "m0" },
      messages, active_path_ids: messages.map((message) => message.id),
    };
    const noop = () => {};
    const nothing = async () => {};
    const html = renderToStaticMarkup(<ChatWorkspace tree={tree} activeSession={tree.session} characters={[]}
      loading={false} loadError={null} streaming={false} mutating={false} canGenerate={false}
      onSend={nothing} onGenerate={noop} onStop={noop} onRegenerate={noop} onSelectMessage={nothing}
      onCreateSwipe={nothing} onUpdateMessage={nothing} onChangeMessageRole={nothing}
      onDeleteMessage={async () => 0} onPruneEmptyBranches={async () => 0}
      onToggleLeft={noop} onToggleRight={noop} leftOpen={false} rightOpen={false}
      treeViewOpen={false} onOpenTree={noop} onCloseTree={noop} modelPicker={null} regexRules={[invalidRule]} />);
    expect(html.match(/Broken preview/g)).toHaveLength(1);
    expect(html.match(/class="regex-message"/g)).toHaveLength(20);
    expect(html).toContain('class="composer-error regex-errors" role="alert"');
  });

  it("leaves rule error presentation to the workspace instead of repeating it inside each message", () => {
    const html = renderToStaticMarkup(<RegexMessage content="Original text" role="assistant" rules={[invalidRule]} />);
    expect(html).toContain("Original text");
    expect(html).not.toContain("Broken preview");
    expect(html).not.toContain('role="alert"');
  });
});
