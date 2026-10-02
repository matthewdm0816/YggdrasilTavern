import { describe, expect, it } from "vitest";
import source from "../../../public/themes.json";
import { buildThemeVariables, parseThemeConfig, resolveThemeMode } from "./schema";

const clone = () => JSON.parse(JSON.stringify(source)) as typeof source;

describe("runtime theme configuration", () => {
  it("validates both supplied themes and migrates the original palette completely", () => {
    const config = parseThemeConfig(source);
    expect(config.themes.map((item) => item.id)).toEqual(["default", "purple"]);
    const light = buildThemeVariables(config.themes[0], "light");
    const dark = buildThemeVariables(config.themes[0], "dark");
    expect(light["--bg"]).toBe("#f4f2ee");
    expect(dark["--bg"]).toBe("#0f1310");
    expect(light["--modal-shadow"]).toBe("0 25px 80px rgba(0, 0, 0, 0.26)");
    const originalVariables = ["bg", "pane", "pane-strong", "line", "text", "muted", "green", "green-dark", "red", "amber", "blue", "shadow", "surface", "surface-hover", "surface-selected", "chat-bg", "surface-soft", "chip-bg", "warning-bg", "warning-text", "danger-bg", "veil-bg", "code-bg", "code-text", "skeleton-low", "skeleton-high", "glass-bg", "reveal-bg", "checker-a", "checker-b", "on-accent", "accent-text", "overlay-bg", "modal-shadow", "drawer-shadow"];
    originalVariables.forEach((name) => {
      expect(light[`--${name}`]).toEqual(expect.any(String));
      expect(dark[`--${name}`]).toEqual(expect.any(String));
    });
    expect(light["--color-primary"]).toBe(light["--green"]);
    expect(light["--sidebar-width"]).toBe("260px");
    expect(light["--message-max-width"]).toBe("760px");
  });

  it("reports a misspelled field at its exact location", () => {
    const value = clone();
    Object.assign(value.themes[0].modes.dark.colors, { primray: "#ffffff" });
    expect(() => parseThemeConfig(value)).toThrow("themes[0].modes.dark.colors.primray：未知字段");
  });

  it("rejects missing colors rather than leaving stale variables from the previous theme", () => {
    const value = clone();
    Reflect.deleteProperty(value.themes[0].modes.light.colors, "codeBackground");
    expect(() => parseThemeConfig(value)).toThrow("themes[0].modes.light.colors.codeBackground");
  });

  it("rejects invalid channels and CSS expressions", () => {
    const value = clone();
    value.themes[0].modes.light.colors.background = "rgba(900, 0, 0, 1)";
    expect(() => parseThemeConfig(value)).toThrow("colors.background");
    value.themes[0].modes.light.colors.background = "var(--other-color)";
    expect(() => parseThemeConfig(value)).toThrow("colors.background");
  });

  it("bounds dimensions so replacement files cannot make the interface unusable", () => {
    const value = clone();
    value.themes[0].layout.messageMaxWidth = 10000;
    expect(() => parseThemeConfig(value)).toThrow("layout.messageMaxWidth：必须是 560 至 1000");
  });

  it("rejects external font URLs and unknown layout fields", () => {
    const value = clone();
    value.themes[0].typography.fontUI = "url(https://example.com/font)";
    expect(() => parseThemeConfig(value)).toThrow("typography.fontUI");
    value.themes[0].typography.fontUI = '"Segoe UI';
    expect(() => parseThemeConfig(value)).toThrow("typography.fontUI");
    value.themes[0].typography.fontUI = "Inter,,sans-serif";
    expect(() => parseThemeConfig(value)).toThrow("typography.fontUI");
    value.themes[0].typography.fontUI = "system-ui";
    Object.assign(value.themes[0].layout, { sidebarWitdh: 260 });
    expect(() => parseThemeConfig(value)).toThrow("layout.sidebarWitdh");
  });

  it("requires unique IDs, an existing default, and a supported format version", () => {
    const duplicate = clone();
    duplicate.themes[1].id = duplicate.themes[0].id;
    expect(() => parseThemeConfig(duplicate)).toThrow("皮肤标识 default 重复");
    const missing = clone();
    missing.defaultThemeId = "missing";
    expect(() => parseThemeConfig(missing)).toThrow("defaultThemeId：找不到皮肤 missing");
    expect(() => parseThemeConfig({ ...source, version: 2 })).toThrow("仅支持配置格式版本 1");
  });

  it("resolves system mode without overriding explicit choices", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });
});
