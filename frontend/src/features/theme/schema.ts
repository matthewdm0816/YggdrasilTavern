export type ThemeMode = "light" | "dark" | "system";
export type ResolvedThemeMode = "light" | "dark";

export const COLOR_VARIABLES = {
  background: "--bg", panel: "--pane", panelStrong: "--pane-strong",
  border: "--line", text: "--text", textMuted: "--muted",
  primary: "--green", primaryHover: "--green-dark", danger: "--red",
  warning: "--amber", link: "--blue", surface: "--surface",
  surfaceHover: "--surface-hover", surfaceSelected: "--surface-selected",
  chatBackground: "--chat-bg", surfaceSoft: "--surface-soft",
  chipBackground: "--chip-bg", warningBackground: "--warning-bg",
  warningText: "--warning-text", dangerBackground: "--danger-bg",
  veilBackground: "--veil-bg", codeBackground: "--code-bg", codeText: "--code-text",
  skeletonLow: "--skeleton-low", skeletonHigh: "--skeleton-high",
  glassBackground: "--glass-bg", revealBackground: "--reveal-bg",
  checkerA: "--checker-a", checkerB: "--checker-b",
  buttonText: "--on-accent", accentText: "--accent-text", overlay: "--overlay-bg",
  userBorder: "--color-user-border", assistantBorder: "--color-assistant-border"
} as const;

export type ThemePalette = {
  colors: Record<keyof typeof COLOR_VARIABLES, string>;
  shadows: { panel: string; modal: string; drawer: string };
};

export type ThemeDefinition = {
  id: string;
  label: string;
  description?: string;
  modes: Record<ResolvedThemeMode, ThemePalette>;
  typography: { fontUI: string; fontMessage: string; fontSizeUI: number; fontSizeMessage: number; lineHeightMessage: number };
  shape: { radiusSmall: number; radiusMedium: number; radiusLarge: number };
  spacing: { unit: number };
  layout: { sidebarWidth: number; inspectorWidth: number; messageMaxWidth: number };
};

export type ThemeConfig = { version: 1; defaultThemeId: string; themes: ThemeDefinition[] };

function fail(path: string, message: string): never {
  throw new Error(`主题配置 ${path}：${message}`);
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "必须是对象");
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !keys.includes(key));
  if (unknown) fail(`${path}.${unknown}`, "未知字段，请检查拼写");
  return record;
}

function string(value: unknown, path: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(path, `必须是 1 至 ${max} 个字符的字符串`);
  return value;
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(path, `必须是 ${min} 至 ${max} 的数值`);
  return value;
}

/** Deliberately accepts literal colors only: hex or numeric rgb()/rgba(). */
function color(value: unknown, path: string): string {
  const result = string(value, path, 80);
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(result)) return result;
  const rgb = result.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/);
  if (rgb && rgb.slice(1, 4).every((channel) => Number(channel) <= 255)
    && (rgb[4] === undefined || Number(rgb[4]) <= 1)
    && (result.startsWith("rgba(") === (rgb[4] !== undefined))) return result;
  return fail(path, "必须是十六进制颜色或 rgb()/rgba()，颜色通道范围为 0 至 255，透明度为 0 至 1");
}

function shadow(value: unknown, path: string): string {
  const result = string(value, path, 160);
  const match = result.match(/^(.+?)\s+(#[\da-f]+|rgba?\(.+\))$/i);
  if (!match) fail(path, "必须包含 2 至 4 个像素长度和一个颜色，例如 0 12px 32px rgba(0, 0, 0, 0.2)");
  const lengths = match[1].split(/\s+/);
  if (lengths.length < 2 || lengths.length > 4) fail(path, "阴影必须包含 2 至 4 个长度");
  lengths.forEach((length, index) => {
    if (!/^(?:-?\d+(?:\.\d+)?px|0)$/.test(length)) fail(path, "阴影长度必须使用 px，零可不带单位");
    number(parseFloat(length), `${path}[${index}]`, index === 2 ? 0 : -128, index === 2 ? 160 : 128);
  });
  color(match[2], `${path}.color`);
  return result;
}

function font(value: unknown, path: string): string {
  const result = string(value, path, 240);
  const entries = result.split(",").map((entry) => entry.trim());
  if (!entries.every((entry) => /^(?:"[\p{L}\p{N} _-]+"|'[\p{L}\p{N} _-]+'|[-_\p{L}][\p{L}\p{N} _-]*)$/u.test(entry))) {
    fail(path, "必须是逗号分隔的字体名称列表，名称不可为空，引号必须成对；不允许 URL 或 CSS 声明");
  }
  return result;
}

function palette(value: unknown, path: string): ThemePalette {
  const source = object(value, path, ["colors", "shadows"]);
  const colors = object(source.colors, `${path}.colors`, Object.keys(COLOR_VARIABLES));
  const validatedColors = Object.fromEntries(Object.keys(COLOR_VARIABLES).map((key) => [key, color(colors[key], `${path}.colors.${key}`)])) as ThemePalette["colors"];
  const shadows = object(source.shadows, `${path}.shadows`, ["panel", "modal", "drawer"]);
  return { colors: validatedColors, shadows: {
    panel: shadow(shadows.panel, `${path}.shadows.panel`),
    modal: shadow(shadows.modal, `${path}.shadows.modal`),
    drawer: shadow(shadows.drawer, `${path}.shadows.drawer`)
  } };
}

function theme(value: unknown, index: number): ThemeDefinition {
  const path = `themes[${index}]`;
  const source = object(value, path, ["id", "label", "description", "modes", "typography", "shape", "spacing", "layout"]);
  const id = string(source.id, `${path}.id`, 40);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`${path}.id`, "必须以小写字母开头，仅使用小写字母、数字和连字符");
  const modes = object(source.modes, `${path}.modes`, ["light", "dark"]);
  const typography = object(source.typography, `${path}.typography`, ["fontUI", "fontMessage", "fontSizeUI", "fontSizeMessage", "lineHeightMessage"]);
  const shape = object(source.shape, `${path}.shape`, ["radiusSmall", "radiusMedium", "radiusLarge"]);
  const spacing = object(source.spacing, `${path}.spacing`, ["unit"]);
  const layout = object(source.layout, `${path}.layout`, ["sidebarWidth", "inspectorWidth", "messageMaxWidth"]);
  return {
    id, label: string(source.label, `${path}.label`, 48),
    ...(source.description === undefined ? {} : { description: string(source.description, `${path}.description`) }),
    modes: { light: palette(modes.light, `${path}.modes.light`), dark: palette(modes.dark, `${path}.modes.dark`) },
    typography: {
      fontUI: font(typography.fontUI, `${path}.typography.fontUI`),
      fontMessage: font(typography.fontMessage, `${path}.typography.fontMessage`),
      fontSizeUI: number(typography.fontSizeUI, `${path}.typography.fontSizeUI`, 12, 18),
      fontSizeMessage: number(typography.fontSizeMessage, `${path}.typography.fontSizeMessage`, 13, 24),
      lineHeightMessage: number(typography.lineHeightMessage, `${path}.typography.lineHeightMessage`, 1.35, 2)
    },
    shape: {
      radiusSmall: number(shape.radiusSmall, `${path}.shape.radiusSmall`, 0, 12),
      radiusMedium: number(shape.radiusMedium, `${path}.shape.radiusMedium`, 0, 24),
      radiusLarge: number(shape.radiusLarge, `${path}.shape.radiusLarge`, 0, 32)
    },
    spacing: { unit: number(spacing.unit, `${path}.spacing.unit`, 2, 8) },
    layout: {
      sidebarWidth: number(layout.sidebarWidth, `${path}.layout.sidebarWidth`, 220, 340),
      inspectorWidth: number(layout.inspectorWidth, `${path}.layout.inspectorWidth`, 280, 400),
      messageMaxWidth: number(layout.messageMaxWidth, `${path}.layout.messageMaxWidth`, 560, 1000)
    }
  };
}

export function parseThemeConfig(value: unknown): ThemeConfig {
  const source = object(value, "root", ["version", "defaultThemeId", "themes"]);
  if (source.version !== 1) fail("version", "目前仅支持配置格式版本 1");
  if (!Array.isArray(source.themes) || source.themes.length < 1 || source.themes.length > 16) fail("themes", "必须包含 1 至 16 套皮肤");
  const themes = source.themes.map(theme);
  const ids = new Set<string>();
  themes.forEach((item, index) => {
    if (ids.has(item.id)) fail(`themes[${index}].id`, `皮肤标识 ${item.id} 重复`);
    ids.add(item.id);
  });
  const defaultThemeId = string(source.defaultThemeId, "defaultThemeId", 40);
  if (!ids.has(defaultThemeId)) fail("defaultThemeId", `找不到皮肤 ${defaultThemeId}`);
  return { version: 1, defaultThemeId, themes };
}

export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): ResolvedThemeMode {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

export function buildThemeVariables(theme: ThemeDefinition, mode: ResolvedThemeMode): Record<string, string> {
  const { colors, shadows } = theme.modes[mode];
  return {
    ...Object.fromEntries(Object.entries(COLOR_VARIABLES).map(([key, variable]) => [variable, colors[key as keyof typeof COLOR_VARIABLES]])),
    "--color-primary": colors.primary, "--color-primary-hover": colors.primaryHover,
    "--color-link": colors.link, "--color-danger": colors.danger, "--color-warning": colors.warning,
    "--shadow": shadows.panel, "--modal-shadow": shadows.modal, "--drawer-shadow": shadows.drawer,
    "--font-ui": theme.typography.fontUI, "--font-message": theme.typography.fontMessage,
    "--font-size-ui": `${theme.typography.fontSizeUI}px`, "--font-size-message": `${theme.typography.fontSizeMessage}px`,
    "--line-height-message": String(theme.typography.lineHeightMessage),
    "--radius-sm": `${theme.shape.radiusSmall}px`, "--radius-md": `${theme.shape.radiusMedium}px`, "--radius-lg": `${theme.shape.radiusLarge}px`,
    "--space-unit": `${theme.spacing.unit}px`,
    "--sidebar-width": `${theme.layout.sidebarWidth}px`, "--inspector-width": `${theme.layout.inspectorWidth}px`,
    "--message-max-width": `${theme.layout.messageMaxWidth}px`
  };
}
