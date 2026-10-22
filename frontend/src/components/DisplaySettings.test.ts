import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSizes } from "./DisplaySettings";

const storageKey = "yggdrasil-tavern.font-sizes";
let saved: Map<string, string>;

beforeEach(() => {
  saved = new Map();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => saved.get(key) ?? null } });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("font size settings", () => {
  it("uses 14px on phones by default", () => {
    expect(loadSizes()).toEqual({ desktop: 14, mobile: 14 });
  });

  it("moves the old 10px phone default saved by an earlier version to 14px", () => {
    saved.set(storageKey, JSON.stringify({ version: 3, desktop: 14, mobile: 10 }));
    expect(loadSizes()).toEqual({ desktop: 14, mobile: 14 });
  });

  it("keeps sizes saved by the current version", () => {
    saved.set(storageKey, JSON.stringify({ version: 4, desktop: 16, mobile: 10 }));
    expect(loadSizes()).toEqual({ desktop: 16, mobile: 10 });
  });
});
