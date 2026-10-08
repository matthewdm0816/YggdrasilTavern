import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { fallbackProfileIdAfterDelete, formatTokenLimit, Sidebar, titleForSelectedCharacter } from "./Sidebar";

function renderToStaticMarkup(element: ReactElement) {
  return renderMarkup(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);
}

describe("titleForSelectedCharacter", () => {
  it("uses the selected character name for an empty or automatic title", () => {
    expect(titleForSelectedCharacter("", "", "Alice")).toBe("Alice");
    expect(titleForSelectedCharacter("Alice", "Alice", "Bob")).toBe("Bob");
  });

  it("preserves a title the user has overridden", () => {
    expect(titleForSelectedCharacter("Chapter One", "Alice", "Bob")).toBe("Chapter One");
  });
});

describe("fallbackProfileIdAfterDelete", () => {
  it("selects the first remaining Profile without returning the deleted id", () => {
    expect(fallbackProfileIdAfterDelete([{ id: "deleted" }, { id: "fallback" }], "deleted")).toBe("fallback");
    expect(fallbackProfileIdAfterDelete([{ id: "deleted" }], "deleted")).toBe("");
  });
});

describe("formatTokenLimit", () => {
  it("renders binary token limits in compact K units", () => {
    expect(formatTokenLimit(262144)).toBe("256K");
    expect(formatTokenLimit(32768)).toBe("32K");
    expect(formatTokenLimit(null)).toBe("未知");
  });
});

describe("Sidebar defaults", () => {
  it("keeps creation editors hidden so the session list remains primary", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        profiles={[]}
        activeProfileId=""
        onActiveProfileChange={() => undefined}
        characters={[]}
        worldbooks={[]}
        sessions={[]}
        selectedSessionId={null}
        showArchived={false}
        onSelectSession={() => undefined}
        creatingSession={false}
        createSessionError={null}
        onCreateSession={async () => { throw new Error("not called during server render"); }}
        onRefresh={async () => undefined}
        onToggleArchived={() => undefined}
      />
    );

    expect(html).toContain("当前 Profile");
    expect(html).toContain("新建 Profile");
    expect(html).not.toContain("Profile 名称");
    expect(html).toContain("新建会话");
    expect(html).not.toContain("扮演角色（必选）");
    expect(html).not.toContain("会话标题（可选）");
    expect(html).not.toContain("生成模型 Profile");
  });

  it("renders the bound character avatar and larger two-line session identity", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        profiles={[]}
        activeProfileId=""
        onActiveProfileChange={() => undefined}
        characters={[{
          id: "character-1",
          name: "Alice",
          avatar_data_url: "data:image/webp;base64,avatar",
          tags: [],
          creator: "",
          character_version: ""
        }]}
        worldbooks={[]}
        sessions={[{
          id: "session-1",
          title: "Moonlit Path",
          character_id: "character-1",
          folder_id: null,
          pinned: false,
          archived: false,
          preset: {}
        }]}
        selectedSessionId="session-1"
        showArchived={false}
        onSelectSession={() => undefined}
        creatingSession={false}
        createSessionError={null}
        onCreateSession={async () => { throw new Error("not called during server render"); }}
        onRefresh={async () => undefined}
        onToggleArchived={() => undefined}
      />
    );

    expect(html).toContain("session-character-avatar");
    expect(html).toContain("data:image/webp;base64,avatar");
    expect(html).toContain("Moonlit Path");
    expect(html).toContain("Alice");
  });
});
