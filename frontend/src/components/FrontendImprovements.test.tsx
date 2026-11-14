import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileDeletedSessionCache } from "../AppShell";
import { useChatController } from "../features/chat/useChatController";
import { treeQueryKey } from "../features/chat/treeCache";
import {
  api,
  resumeGeneration,
  streamGenerate,
  type AvatarTransform,
  type Character,
  type ChatSession,
  type Message,
  type SessionTree,
  type WorldBook
} from "../lib/api";
import { useAppStore } from "../state/useAppStore";
import { ChatWorkspace, handleMessageEditKeyDown } from "./ChatWorkspace";
import { GenerationStatus, generationStatusLabel } from "./GenerationStatus";
import {
  applyCharacterAvatarChange,
  CharacterEditorDialog,
  CharacterManager,
  emptyEditorDraft,
  modifyEditorDraft,
  openEditorDraft,
  startCharacterSession,
  WorldbookEditorDialog
} from "./ResourceEditors";
import {
  fallbackSessionIdAfterDelete,
  performDeleteSession,
  performRenameFolder,
  performRenameSession,
  SessionActionItems,
  SessionListPanel
} from "./SessionListPanel";
import { Sidebar } from "./Sidebar";

function renderWithQuery(element: ReactElement) {
  return renderMarkup(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);
}

function sampleCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "char-1",
    name: "Apeiria",
    description: "AI companion",
    personality: "Calm and curious",
    scenario: "Cyberspace",
    first_mes: "Positive, Owner.",
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: ["sci-fi"],
    creator: "Owner",
    character_version: "1.0",
    avatar_data_url: "",
    avatar_original_data_url: "",
    avatar_transform: null,
    extensions: {},
    raw_json: {},
    ...overrides
  };
}

function sampleWorldbook(overrides: Partial<WorldBook> = {}): WorldBook {
  return {
    id: "wb-1",
    name: "Lore",
    description: "World settings",
    scan_depth: 4,
    token_budget: 1024,
    recursive_scanning: false,
    max_recursion_steps: 0,
    raw_json: {},
    entries: [],
    ...overrides
  };
}

function sampleSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "sess-1",
    title: "Session One",
    character_id: "char-1",
    folder_id: null,
    pinned: false,
    archived: false,
    preset: {},
    ...overrides
  };
}

function sampleMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    session_id: "sess-1",
    parent_id: null,
    selected_child_id: null,
    role: "assistant",
    speaker: "Apeiria",
    content: "Hello",
    thinking_content: "",
    status: "complete",
    sort_order: 0,
    token_count: 2,
    thinking_token_count: 0,
    cached_tokens: 0,
    provider_metadata: {},
    usage: {},
    created_at: "2026-11-15T00:00:00Z",
    updated_at: "2026-11-15T00:00:00Z",
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAppStore.setState({ selectedSessionId: null, drafts: {}, edits: {} });
});

describe("Character card quick new-session button", () => {
  it("renders the quick new-session button on character rows and disables it while creating", () => {
    const characters = [{
      id: "char-1",
      name: "Apeiria",
      avatar_data_url: "",
      tags: [],
      creator: "",
      character_version: ""
    }];
    const enabledHtml = renderWithQuery(
      <CharacterManager
        characters={characters}
        onChanged={() => undefined}
        onCreateSession={async () => sampleSession()}
        creatingSession={false}
      />
    );
    const buttonMatch = enabledHtml.match(/<button[^>]*aria-label="用此角色新建会话"[^>]*>/)?.[0];
    expect(buttonMatch).toBeDefined();
    expect(buttonMatch).toContain('title="用此角色新建会话"');
    expect(buttonMatch).not.toContain("disabled");

    const disabledHtml = renderWithQuery(
      <Sidebar
        initialTab="resources"
        settingsOpen={false}
        onCloseSettings={() => undefined}
        profiles={[]}
        activeProfileId=""
        onActiveProfileChange={() => undefined}
        characters={characters}
        worldbooks={[]}
        sessions={[]}
        selectedSessionId={null}
        showArchived={false}
        onSelectSession={() => undefined}
        creatingSession={true}
        createSessionError={null}
        onCreateSession={async () => sampleSession()}
        onRefresh={async () => undefined}
        onToggleArchived={() => undefined}
      />
    );
    const disabledMatch = disabledHtml.match(/<button[^>]*aria-label="用此角色新建会话"[^>]*>/)?.[0];
    expect(disabledMatch).toBeDefined();
    expect(disabledMatch).toContain("disabled");
  });

  it("creates a session with auto_greeting preset and forwards errors via onError", async () => {
    const create = vi.fn().mockResolvedValue(sampleSession({ id: "sess-new", title: "Apeiria" }));
    const onError = vi.fn();

    const created = await startCharacterSession({ id: "char-1", name: "Apeiria" }, create, onError);
    expect(create).toHaveBeenCalledWith({
      title: "Apeiria",
      character_id: "char-1",
      preset: { auto_greeting: true }
    });
    expect(created?.id).toBe("sess-new");
    expect(onError).not.toHaveBeenCalled();

    const failingCreate = vi.fn().mockRejectedValue(new Error("角色不存在"));
    const failed = await startCharacterSession({ id: "char-missing", name: "Ghost" }, failingCreate, onError);
    expect(failed).toBeNull();
    expect(onError).toHaveBeenCalledWith("角色不存在");
  });
});

describe("Session rename/delete, folder rename, and inline message shortcuts", () => {
  it("renders session rename/delete actions and folder rename buttons", () => {
    const actionsHtml = renderMarkup(
      <SessionActionItems
        session={sampleSession()}
        orderedCharacters={[]}
        folders={[]}
        busy={false}
        copyingSession={false}
        onStartRename={() => undefined}
        onCopy={() => undefined}
        onTogglePin={() => undefined}
        onToggleArchive={() => undefined}
        onRebindCharacter={() => undefined}
        onMoveToFolder={() => undefined}
        onDelete={() => undefined}
      />
    );
    expect(actionsHtml).toContain("重命名会话");
    expect(actionsHtml).toContain("删除会话…");

    const panelHtml = renderWithQuery(
      <SessionListPanel
        characters={[]}
        sessions={[]}
        selectedSessionId={null}
        showArchived={false}
        creatingSession={false}
        createSessionError={null}
        onSelectSession={() => undefined}
        onCreateSession={async () => sampleSession()}
        onRefresh={async () => undefined}
        onToggleArchived={() => undefined}
        defaultCollapsible={false}
        initialFolders={[{ id: "folder-1", name: "主线剧情", sort_order: 0 }]}
      />
    );
    expect(panelHtml).toContain('aria-label="重命名文件夹“主线剧情”"');
  });

  it("renames sessions and folders through the API and refreshes state", async () => {
    const updateSession = vi.spyOn(api, "updateSession").mockResolvedValue(sampleSession({ title: "新标题" }));
    const updateFolder = vi.spyOn(api, "updateFolder").mockResolvedValue({ id: "folder-1", name: "支线剧情", sort_order: 0 });
    const reloadFolders = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    expect(await performRenameSession("sess-1", "   ", onRefresh, onError)).toBe(false);
    expect(updateSession).not.toHaveBeenCalled();

    expect(await performRenameSession("sess-1", "  新标题  ", onRefresh, onError)).toBe(true);
    expect(updateSession).toHaveBeenCalledWith("sess-1", { title: "新标题" });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    expect(await performRenameFolder("folder-1", "  支线剧情 ", reloadFolders, onRefresh, onError)).toBe(true);
    expect(updateFolder).toHaveBeenCalledWith("folder-1", { name: "支线剧情" });
    expect(reloadFolders).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("confirms session deletion and safely switches or clears selectedSessionId without dangling cache", async () => {
    const deleteSession = vi.spyOn(api, "deleteSession").mockResolvedValue({ ok: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const sessions = [sampleSession({ id: "sess-1", title: "First" }), sampleSession({ id: "sess-2", title: "Second" })];

    expect(fallbackSessionIdAfterDelete(sessions, "sess-1")).toBe("sess-2");
    expect(fallbackSessionIdAfterDelete([sessions[0]], "sess-1")).toBeNull();

    // Cancelled confirmation does not call deleteSession.
    const cancelled = await performDeleteSession({
      session: sessions[0],
      sessions,
      selectedSessionId: "sess-1",
      confirm: () => false,
      onRefresh
    });
    expect(cancelled).toBe(false);
    expect(deleteSession).not.toHaveBeenCalled();

    // Deleting the active session switches to the remaining session and purges the deleted tree cache.
    const queryClient = new QueryClient();
    queryClient.setQueryData(["sessions", false], sessions);
    queryClient.setQueryData(["tree", "sess-1"], { session: sessions[0], messages: [], active_path_ids: [] });
    useAppStore.setState({ selectedSessionId: "sess-1" });

    const deletedFirst = await performDeleteSession({
      session: sessions[0],
      sessions,
      selectedSessionId: "sess-1",
      confirm: () => true,
      onSessionDeleted: (deletedId, nextId) => reconcileDeletedSessionCache(queryClient, deletedId, nextId),
      onRefresh
    });
    expect(deletedFirst).toBe(true);
    expect(deleteSession).toHaveBeenCalledWith("sess-1");
    expect(useAppStore.getState().selectedSessionId).toBe("sess-2");
    expect(queryClient.getQueryData(["tree", "sess-1"])).toBeUndefined();
    expect(queryClient.getQueryData<ChatSession[]>(["sessions", false])?.map((item) => item.id)).toEqual(["sess-2"]);

    // Deleting the last remaining session clears selectedSessionId to null.
    let treeClosed = false;
    const deletedLast = await performDeleteSession({
      session: sessions[1],
      sessions: [sessions[1]],
      selectedSessionId: "sess-2",
      confirm: () => true,
      onSessionDeleted: (deletedId, nextId) => reconcileDeletedSessionCache(queryClient, deletedId, nextId, () => { treeClosed = true; }),
      onRefresh
    });
    expect(deletedLast).toBe(true);
    expect(useAppStore.getState().selectedSessionId).toBeNull();
    expect(queryClient.getQueryData<ChatSession[]>(["sessions", false])).toEqual([]);
    expect(treeClosed).toBe(true);
  });

  it("supports Ctrl/Cmd+Enter save and clean Escape cancel in inline message editor", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const makeEvent = (key: string, opts: { ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean } = {}) => ({
      key,
      ctrlKey: Boolean(opts.ctrlKey),
      metaKey: Boolean(opts.metaKey),
      nativeEvent: { isComposing: opts.isComposing },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });

    // Ctrl+Enter saves when dirty and not busy.
    const ctrlEnter = makeEvent("Enter", { ctrlKey: true });
    handleMessageEditKeyDown(ctrlEnter, { canSave: true, canCancelClean: false, onSave, onCancel });
    expect(ctrlEnter.preventDefault).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);

    // Cmd+Enter saves on macOS as well.
    const cmdEnter = makeEvent("Enter", { metaKey: true });
    handleMessageEditKeyDown(cmdEnter, { canSave: true, canCancelClean: false, onSave, onCancel });
    expect(onSave).toHaveBeenCalledTimes(2);

    // Escape cancels immediately when there are no unsaved changes.
    const cleanEscape = makeEvent("Escape");
    handleMessageEditKeyDown(cleanEscape, { canSave: false, canCancelClean: true, onSave, onCancel });
    expect(cleanEscape.preventDefault).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Escape does not discard edits when dirty.
    const dirtyEscape = makeEvent("Escape");
    handleMessageEditKeyDown(dirtyEscape, { canSave: true, canCancelClean: false, onSave, onCancel });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("updates the regenerate button tooltip during streaming without disabling it", () => {
    const noop = () => undefined;
    const asyncNoop = async () => undefined;
    const streamingReply = sampleMessage({ id: "reply-stream", status: "streaming" });
    const completeReply = sampleMessage({ id: "reply-done", status: "complete" });
    const renderFor = (reply: Message, streaming: boolean) => {
      const tree: SessionTree = {
        session: sampleSession(),
        messages: [reply],
        active_path_ids: [reply.id]
      };
      return renderMarkup(
        <ChatWorkspace
          tree={tree}
          activeSession={tree.session}
          characters={[]}
          loading={false}
          loadError={null}
          streaming={streaming}
          mutating={false}
          canGenerate={true}
          onSend={asyncNoop}
          onGenerate={noop}
          onGenerateFrom={noop}
          onRegenerate={noop}
          generation={{ active: [], unread: [], sessionTitles: {}, onStop: noop, onDismissUnread: noop, onOpenSessionMessage: noop }}
          onSelectMessage={asyncNoop}
          onCreateSwipe={asyncNoop}
          onUpdateMessage={asyncNoop}
          onChangeMessageRole={asyncNoop}
          onDeleteMessage={async () => 0}
          onPruneEmptyBranches={async () => 0}
          onToggleLeft={noop}
          onToggleRight={noop}
          leftOpen={false}
          rightOpen={false}
          treeViewOpen={false}
          onOpenTree={noop}
          onCloseTree={noop}
          modelPicker={null}
          regexRules={[]}
        />
      );
    };

    const streamingBtn = renderFor(streamingReply, true).match(/<button[^>]*aria-label="重新生成此回复"[^>]*>/)?.[0];
    expect(streamingBtn).toContain('title="并行再生成一条回复"');
    expect(streamingBtn).not.toContain("disabled");

    const completeBtn = renderFor(completeReply, false).match(/<button[^>]*aria-label="重新生成此回复"[^>]*>/)?.[0];
    expect(completeBtn).toContain('title="重新生成此回复"');
    expect(completeBtn).not.toContain("disabled");
  });
});

describe("Resource editor dirty tracking, avatar deduplication, and inline error banners", () => {
  it("tracks dirty state via lightweight boolean transitions without JSON.stringify", () => {
    const stringifySpy = vi.spyOn(JSON, "stringify");
    let state = emptyEditorDraft<WorldBook>();
    expect(state.isDirty).toBe(false);

    const original = sampleWorldbook({ name: "Original" });
    state = openEditorDraft(original);
    expect(state.isDirty).toBe(false);
    expect(state.draft).not.toBe(original);

    state = modifyEditorDraft(state, (draft) => ({ ...draft, name: "Updated" }));
    expect(state.isDirty).toBe(true);
    expect(state.draft?.name).toBe("Updated");
    expect(original.name).toBe("Original");
    expect(stringifySpy).not.toHaveBeenCalled();
  });

  it("removes redundant extensions.yggdrasil_avatar original image duplication on avatar apply", () => {
    const transform: AvatarTransform = { zoom: 1.2, offset_x: 0.1, offset_y: -0.1, rotation: 90, flip_x: true, flip_y: false };
    const character = sampleCharacter({
      extensions: {
        custom_key: "preserved",
        yggdrasil_avatar: { original_data_url: "data:image/png;base64,HUGE_DUPLICATE", transform }
      }
    });
    const updated = applyCharacterAvatarChange(character, "data:image/webp;base64,derived", "data:image/png;base64,orig", transform);
    expect(updated.avatar_data_url).toBe("data:image/webp;base64,derived");
    expect(updated.avatar_original_data_url).toBe("data:image/png;base64,orig");
    expect(updated.avatar_transform).toEqual(transform);
    expect(updated.extensions).toEqual({ custom_key: "preserved" });
    expect("yggdrasil_avatar" in updated.extensions).toBe(false);
  });

  it("renders inline role=alert error banners inside CharacterEditorDialog and WorldbookEditorDialog", () => {
    const noop = () => undefined;
    const charHtml = renderMarkup(
      <CharacterEditorDialog
        draft={sampleCharacter()}
        busy={false}
        error="保存失败：字段超长"
        onDismissError={noop}
        onClose={noop}
        onUpdate={noop}
        onApplyAvatar={noop}
        onAvatarError={noop}
        onSave={noop}
      />
    );
    expect(charHtml).toContain('class="resource-modal-error" role="alert"');
    expect(charHtml).toContain("保存失败：字段超长");

    const wbHtml = renderMarkup(
      <WorldbookEditorDialog
        draft={sampleWorldbook()}
        busy={false}
        error="保存失败：网络断开"
        onDismissError={noop}
        onClose={noop}
        onUpdateBook={noop}
        onPatchEntry={noop}
        onDeleteEntry={noop}
        onAddEntry={noop}
        onSave={noop}
      />
    );
    expect(wbHtml).toContain('class="resource-modal-error" role="alert"');
    expect(wbHtml).toContain("保存失败：网络断开");
  });
});

describe("Stream abort propagation, background error surfacing, and GenerationStatus label", () => {
  it("throws AbortError when a generation stream is aborted before or during reading", async () => {
    // Pre-aborted signal throws AbortError immediately without calling fetch.
    const preAborted = new AbortController();
    preAborted.abort();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(streamGenerate("sess-1", { api_profile_id: "p1" }, {}, preAborted.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Mid-stream abort while blocked on reader.read() rejects with AbortError instead of silently returning.
    const midAbort = new AbortController();
    fetchSpy.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start() {
        // Keep stream open until aborted, as happens during GenerationRegistry.reconnectAll().
      }
    }), { status: 200 }));

    const pending = resumeGeneration("run-1", {}, midAbort.signal);
    midAbort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns boolean from handleGenerate and invokes onError when a background session fails before message_created", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "上游配额耗尽" }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    })));
    vi.spyOn(api, "activeGenerations").mockResolvedValue([]);
    vi.spyOn(api, "tree").mockImplementation(async (id) => ({
      session: sampleSession({ id }),
      messages: [],
      active_path_ids: []
    }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(treeQueryKey("sess-fg"), { session: sampleSession({ id: "sess-fg" }), messages: [], active_path_ids: [] });
    client.setQueryData(treeQueryKey("sess-bg"), { session: sampleSession({ id: "sess-bg" }), messages: [], active_path_ids: [] });

    const onError = vi.fn();
    let chat!: ReturnType<typeof useChatController>;
    function Capture() {
      chat = useChatController({
        selectedSessionId: "sess-fg",
        activeProfileId: "profile-1",
        generationLimit: 4,
        onError
      });
      return null;
    }
    renderMarkup(createElement(QueryClientProvider, { client }, createElement(Capture)));

    const ok = await chat.handleGenerate({ sessionId: "sess-bg" });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("上游配额耗尽"));
  });

  it("renders Chinese '生成中' status label in GenerationStatus", () => {
    expect(generationStatusLabel("streaming")).toBe("生成中");

    const html = renderMarkup(
      <GenerationStatus
        defaultExpanded
        active={[]}
        unread={[{ sessionId: "sess-2", messageId: "msg-2", status: "streaming", label: "正在输出" }]}
        sessionTitles={{ "sess-2": "平行宇宙" }}
        currentSessionId="sess-1"
        onStop={() => undefined}
        onOpen={() => undefined}
        onDismiss={() => undefined}
      />
    );
    expect(html).toContain("生成中 · 平行宇宙");
  });
});
