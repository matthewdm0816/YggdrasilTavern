import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatWorkspace } from "./ChatWorkspace";
import type { Message, SessionTree } from "../lib/api";

function message(overrides: Partial<Message>): Message {
  return {
    id: "prompt", session_id: "session", parent_id: null, selected_child_id: null,
    role: "user", speaker: "User", content: "Prompt", thinking_content: "",
    status: "complete", sort_order: 0, token_count: 1, thinking_token_count: 0, cached_tokens: 0,
    provider_metadata: {}, usage: {}, created_at: "", updated_at: "", ...overrides
  };
}

const prompt = message({ selected_child_id: "reply" });
const reply = message({ id: "reply", parent_id: "prompt", role: "assistant", speaker: "A", content: "Partial", status: "streaming" });
const tree: SessionTree = {
  session: { id: "session", title: "QA", preset: {}, active_root_child_id: "prompt" },
  messages: [prompt, reply], active_path_ids: ["prompt", "reply"]
};

function renderStreaming() {
  const noop = () => {};
  const nothing = async () => {};
  return renderToStaticMarkup(<ChatWorkspace tree={tree} activeSession={tree.session} characters={[]}
    loading={false} loadError={null} streaming={true} mutating={false} canGenerate={true}
    onSend={nothing} onGenerate={noop} onGenerateFrom={noop} onRegenerate={noop}
    generation={{ active: [], unread: [], sessionTitles: {}, onStop: noop, onDismissUnread: noop, onOpenSessionMessage: noop }} onSelectMessage={nothing}
    onCreateSwipe={nothing} onUpdateMessage={nothing} onChangeMessageRole={nothing}
    onDeleteMessage={async () => 0} onPruneEmptyBranches={async () => 0}
    onToggleLeft={noop} onToggleRight={noop} leftOpen={false} rightOpen={false}
    treeViewOpen={false} onOpenTree={noop} onCloseTree={noop} modelPicker={null} regexRules={[]} />);
}

function messageHtml(html: string, messageId: string) {
  return html.split(`data-message-id="${messageId}"`)[1].split("data-message-id=")[0];
}

describe("editing while a reply streams", () => {
  it("keeps other messages editable and locks only the streaming message", () => {
    const html = renderStreaming();
    const editButton = (messageId: string) => messageHtml(html, messageId).match(/<button[^>]*aria-label="编辑消息"[^>]*>/)?.[0];
    expect(editButton("prompt")).not.toContain("disabled");
    expect(editButton("reply")).toContain("disabled");
  });
});
