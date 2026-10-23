import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegexMessage } from "./RegexMessage";
import { MessageMacroContext } from "./MessageMacroProvider";
import fixture from "../../../shared/macro-cases.json";
import { setStorageUser } from "../lib/userStorage";

afterEach(() => { vi.unstubAllGlobals(); setStorageUser(null); });

describe("macro display preferences", () => {
  it("expands by default without replacing the authored input", () => {
    const raw = "**{{char}}** meets <USER>";
    const html = renderToStaticMarkup(<MessageMacroContext.Provider value={{ character: fixture.cases[0].character, user_name: "Owner" }}>
      <RegexMessage content={raw} role="assistant" rules={[]} />
    </MessageMacroContext.Provider>);
    expect(html).toContain("<strong>Apeiria</strong> meets Owner");
    expect(raw).toBe("**{{char}}** meets <USER>");
  });

  it("uses the current account preference and keeps legacy macros visible in preview mode", () => {
    const getItem = vi.fn((key: string) => key.endsWith(".user.qa-user") ? "hover" : "expanded");
    vi.stubGlobal("window", { localStorage: { getItem }, matchMedia: () => ({ matches: false }) });
    setStorageUser({ id: "qa-user", is_owner: false });
    const html = renderToStaticMarkup(<MessageMacroContext.Provider value={{ character: fixture.cases[0].character, user_name: "Owner" }}>
      <RegexMessage content={"**{{char}}** meets <USER> and \u0060<BOT>\u0060"} role="assistant" rules={[]} />
    </MessageMacroContext.Provider>);
    expect(getItem).toHaveBeenCalledWith("yggdrasil-tavern.macro-display.user.qa-user");
    expect(html).toContain("{{char}}");
    expect(html).toContain("&lt;USER&gt;");
    expect(html).toContain("&lt;BOT&gt;");
    expect(html).not.toContain("\uE000");
    expect(html.match(/class="text-preview"/g)).toHaveLength(3);
  });
});
