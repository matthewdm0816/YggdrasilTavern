import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../../public/themes.json";

type ThemeModule = typeof import("./useTheme");
let module: ThemeModule;
let saved: Map<string, string>;
let properties: Map<string, string>;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn> };
let changed: (() => void) | undefined;

function validResponse(value: unknown = source): Response { return new Response(JSON.stringify(value)); }

beforeEach(async () => {
  vi.resetModules();
  saved = new Map();
  properties = new Map();
  changed = undefined;
  media = { matches: false, addEventListener: vi.fn((_event: string, callback: () => void) => { changed = callback; }) };
  vi.stubGlobal("window", {
    matchMedia: vi.fn(() => media),
    localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) }
  });
  vi.stubGlobal("document", { documentElement: { dataset: {}, style: { setProperty: (key: string, value: string) => properties.set(key, value) } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(validResponse()));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  module = await import("./useTheme");
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("theme runtime state", () => {
  it("applies the bundled palette before waiting for a request and preserves the existing dark preference", async () => {
    saved.set(module.THEME_MODE_STORAGE_KEY, "dark");
    saved.set(module.THEME_ID_STORAGE_KEY, "purple");
    let finish: (response: Response) => void = () => { throw new Error("fetch not started"); };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const loading = module.initializeTheme();
    expect(properties.get("--bg")).toBe("#16121d");
    expect(module.useTheme.getState().mode).toBe("dark");
    expect(module.useTheme.getState().loading).toBe(true);
    finish(validResponse());
    await loading;
    expect(module.useTheme.getState().themeId).toBe("purple");
    expect(module.useTheme.getState().error).toBeNull();
  });

  it("uses the configured default when there is no saved skin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(validResponse({ ...source, defaultThemeId: "purple" })));
    await module.initializeTheme();
    expect(module.useTheme.getState().themeId).toBe("purple");
    expect(properties.get("--bg")).toBe("#f4f1fa");
  });

  it("keeps the current palette when a replacement file is invalid and makes the error visible", async () => {
    await module.initializeTheme();
    module.useTheme.getState().setThemeId("purple");
    const previous = new Map(properties);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(validResponse({ ...source, unknownField: true })));
    await module.useTheme.getState().reloadThemes();
    expect(properties).toEqual(previous);
    expect(module.useTheme.getState().themeId).toBe("purple");
    expect(module.useTheme.getState().error).toContain("root.unknownField");
    expect(console.error).toHaveBeenCalled();
  });

  it("re-reads changed colors and follows system changes only when requested", async () => {
    await module.initializeTheme();
    module.useTheme.getState().setThemeId("purple");
    const next = JSON.parse(JSON.stringify(source)) as typeof source;
    next.themes[1].modes.light.colors.background = "#abcdef";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(validResponse(next)));
    await module.useTheme.getState().reloadThemes();
    expect(properties.get("--bg")).toBe("#abcdef");
    media.matches = true;
    changed?.();
    expect(module.useTheme.getState().resolvedMode).toBe("dark");
    module.useTheme.getState().setMode("light");
    changed?.();
    expect(module.useTheme.getState().resolvedMode).toBe("light");
    expect(saved.get(module.THEME_MODE_STORAGE_KEY)).toBe("light");
    expect(saved.get(module.THEME_ID_STORAGE_KEY)).toBe("purple");
  });

  it("reports storage failures and missing saved skins rather than quietly discarding preferences", async () => {
    saved.set(module.THEME_ID_STORAGE_KEY, "removed-theme");
    await module.initializeTheme();
    expect(module.useTheme.getState().themeId).toBe("default");
    expect(module.useTheme.getState().error).toContain("removed-theme");
    window.localStorage.setItem = () => { throw new Error("storage denied"); };
    module.useTheme.getState().setMode("dark");
    expect(module.useTheme.getState().resolvedMode).toBe("dark");
    expect(module.useTheme.getState().error).toContain("storage denied");
  });
});
