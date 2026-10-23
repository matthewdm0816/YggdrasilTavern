import { useMacroDisplayMode, type MacroDisplayMode } from "../features/chat/macroDisplay";
import { useEffect, useState, type ReactNode } from "react";
import { Palette } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { userStorageKey } from "../lib/userStorage";

const storageKey = "yggdrasil-tavern.font-sizes";
const defaults = { desktop: 14, mobile: 14 };
const storageVersion = 4;

export function loadSizes() {
  if (typeof window === "undefined") return defaults;
  try {
    const stored = window.localStorage.getItem(userStorageKey(storageKey));
    if (!stored) return defaults;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed.desktop === "number" && parsed.desktop >= 12 && parsed.desktop <= 22
      && typeof parsed.mobile === "number" && parsed.mobile >= 10 && parsed.mobile <= 22) {
      const version = typeof parsed.version === "number" ? parsed.version : 0;
      // Older versions saved their own default on mount, so a stored old default is not a user choice.
      return {
        desktop: version < 3 && parsed.desktop === 16 ? defaults.desktop : parsed.desktop,
        mobile: version < storageVersion && parsed.mobile === 10 ? defaults.mobile : parsed.mobile
      };
    }
    console.error("保存的字号设置无效，使用默认字号。", parsed);
  } catch (cause) {
    console.error("无法读取字号设置，使用默认字号。", cause);
  }
  return defaults;
}

export function applyFontSizeSettings(sizes = loadSizes()) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--desktop-font-size", `${sizes.desktop}px`);
  document.documentElement.style.setProperty("--mobile-font-size", `${sizes.mobile}px`);
}

export function DisplaySettings({ children }: { children?: ReactNode }) {
  const [sizes, setSizes] = useState(loadSizes);
  const macroDisplay = useMacroDisplayMode();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    applyFontSizeSettings(sizes);
    try {
      window.localStorage.setItem(userStorageKey(storageKey), JSON.stringify({ version: storageVersion, ...sizes }));
      setError(null);
    } catch (cause) {
      console.error("字号已应用，但无法保存到浏览器。", cause);
      setError("字号已应用，但无法保存；刷新后可能恢复默认值。");
    }
  }, [sizes]);
  return <CollapsibleSection contentId="display-settings-content" title="外观与字号" icon={<Palette size={16} />} storageKey="yggdrasil-tavern.display.expanded">
    {children}
    <label className="form-field"><span>宏显示方式</span><select aria-label="宏显示方式" value={macroDisplay.mode} onChange={(event) => macroDisplay.setMode(event.target.value as MacroDisplayMode)}><option value="expanded">直接显示替换后</option><option value="hover">显示原文，悬停或点按看替换后</option></select></label>
    {macroDisplay.error && <p className="field-error" role="alert">{macroDisplay.error}</p>}
    {(["desktop", "mobile"] as const).map((target) => <label className="form-field font-size-setting" key={target}>
      <span>{target === "desktop" ? "电脑字号" : "移动端字号"} · {sizes[target]} px</span>
      <input aria-label={target === "desktop" ? "电脑字号" : "移动端字号"} type="range" min={target === "mobile" ? 10 : 12} max="22" step="1" value={sizes[target]} onChange={(event) => setSizes((current) => ({ ...current, [target]: Number(event.target.value) }))} />
    </label>)}
    <button className="secondary-button" type="button" onClick={() => setSizes(defaults)}>恢复默认字号</button>
    {error && <p className="field-error" role="alert">{error}</p>}
  </CollapsibleSection>;
}
