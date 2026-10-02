import { create } from "zustand";
import bundledSource from "../../../public/themes.json";
import { loadThemeConfig } from "./loadConfig";
import { buildThemeVariables, parseThemeConfig, resolveThemeMode, ThemeDefinition, ThemeMode, ResolvedThemeMode } from "./schema";

export const THEME_MODE_STORAGE_KEY = "yggdrasil-tavern.theme";
export const THEME_ID_STORAGE_KEY = "yggdrasil-tavern.theme-id";
const bundledConfig = parseThemeConfig(bundledSource);
let config = bundledConfig;
let preferredThemeId: string | null = null;
let storageError: string | null = null;
let configError: string | null = null;
let initialized = false;
let pendingLoad: Promise<void> | null = null;

export type ThemeState = {
  themes: ThemeDefinition[];
  themeId: string;
  mode: ThemeMode;
  resolvedMode: ResolvedThemeMode;
  loading: boolean;
  error: string | null;
  setThemeId: (id: string) => void;
  setMode: (mode: ThemeMode) => void;
  reloadThemes: () => Promise<void>;
};

function refreshError(): void {
  useTheme.setState({ error: [configError, storageError].filter(Boolean).join("\n") || null });
}

function reportStorageError(message: string, cause: unknown): void {
  console.error(message, cause);
  storageError = `${message}：${cause instanceof Error ? cause.message : String(cause)}。本次外观仍可使用，但可能无法在刷新后保留。`;
  refreshError();
}

function reportConfigError(message: string, cause?: unknown): void {
  console.error(message, ...(cause === undefined ? [] : [cause]));
  configError = message;
  refreshError();
}

function persist(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (cause) {
    reportStorageError("无法保存主题选择", cause);
  }
}

function apply(themeId: string, mode: ThemeMode): void {
  const definition = config.themes.find((item) => item.id === themeId);
  if (!definition) throw new Error(`无法应用皮肤 ${themeId}：配置中不存在这个标识。`);
  const resolvedMode = resolveThemeMode(mode, window.matchMedia("(prefers-color-scheme: dark)").matches);
  const element = document.documentElement;
  Object.entries(buildThemeVariables(definition, resolvedMode)).forEach(([name, value]) => element.style.setProperty(name, value));
  element.dataset.theme = resolvedMode;
  element.dataset.themeId = themeId;
  element.style.colorScheme = resolvedMode;
  useTheme.setState({ themeId, mode, resolvedMode });
}

async function reloadThemes(): Promise<void> {
  if (pendingLoad) return pendingLoad;
  useTheme.setState({ loading: true });
  pendingLoad = (async () => {
    try {
      const nextConfig = await loadThemeConfig(`${import.meta.env.BASE_URL}themes.json`);
      const chosen = preferredThemeId && nextConfig.themes.some((item) => item.id === preferredThemeId)
        ? preferredThemeId : nextConfig.defaultThemeId;
      const missingSavedTheme = preferredThemeId !== null && chosen !== preferredThemeId;
      config = nextConfig;
      useTheme.setState({ themes: config.themes });
      apply(chosen, useTheme.getState().mode);
      if (missingSavedTheme) {
        reportConfigError(`主题配置中找不到之前选择的皮肤 ${preferredThemeId}，已使用配置中的默认皮肤 ${chosen}。`);
      } else {
        configError = null;
        refreshError();
      }
    } catch (cause) {
      reportConfigError(cause instanceof Error ? cause.message : String(cause), cause);
    } finally {
      useTheme.setState({ loading: false });
      pendingLoad = null;
    }
  })();
  return pendingLoad;
}

export const useTheme = create<ThemeState>(() => ({
  themes: bundledConfig.themes, themeId: bundledConfig.defaultThemeId, mode: "system", resolvedMode: "light", loading: false, error: null,
  setThemeId: (id) => {
    if (!config.themes.some((item) => item.id === id)) {
      reportConfigError(`无法切换皮肤：主题配置中找不到 ${id}。当前可用主题已保留。`);
      return;
    }
    preferredThemeId = id;
    apply(id, useTheme.getState().mode);
    persist(THEME_ID_STORAGE_KEY, id);
  },
  setMode: (mode) => {
    if (!["light", "dark", "system"].includes(mode)) {
      reportConfigError(`无法切换明暗模式：${mode} 不是有效的选择。当前可用主题已保留。`);
      return;
    }
    apply(useTheme.getState().themeId, mode);
    persist(THEME_MODE_STORAGE_KEY, mode);
  },
  reloadThemes
}));

/** Applies the bundled config synchronously before the auth screen renders. */
export function initializeTheme(): Promise<void> {
  if (initialized) return pendingLoad || Promise.resolve();
  initialized = true;
  let mode: ThemeMode = "system";
  try {
    const savedMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    const savedId = window.localStorage.getItem(THEME_ID_STORAGE_KEY);
    if (savedMode === "light" || savedMode === "dark" || savedMode === "system") mode = savedMode;
    else if (savedMode !== null) reportStorageError("已保存的明暗模式无效，改用跟随系统", savedMode);
    if (savedId) preferredThemeId = savedId;
  } catch (cause) {
    reportStorageError("无法读取已保存的主题选择", cause);
  }
  apply(preferredThemeId && config.themes.some((item) => item.id === preferredThemeId) ? preferredThemeId : config.defaultThemeId, mode);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = useTheme.getState();
    if (current.mode === "system") apply(current.themeId, current.mode);
  });
  return reloadThemes();
}
