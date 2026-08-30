import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fallbackProfileIdAfterDelete, formatTokenLimit, Sidebar, titleForSelectedCharacter } from "./Sidebar";

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
  it("keeps the Profile editor hidden and requires a character-oriented session form", () => {
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
    expect(html).toContain("扮演角色（必选）");
    expect(html).toContain("会话标题（可选）");
    expect(html).not.toContain("生成模型 Profile");
  });
});
