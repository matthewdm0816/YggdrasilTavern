import { AlertCircle, RotateCw } from "lucide-react";
import { useTheme } from "./useTheme";

export function ThemeErrorNotice() {
  const error = useTheme((state) => state.error);
  const loading = useTheme((state) => state.loading);
  const reloadThemes = useTheme((state) => state.reloadThemes);
  if (!error) return null;
  return (
    <aside className="theme-error-notice" role="alert" aria-label="主题配置错误">
      <AlertCircle size={18} aria-hidden="true" />
      <div><strong>主题配置未能完整应用</strong><p>{error}</p></div>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => void reloadThemes()}>
        <RotateCw size={15} aria-hidden="true" />{loading ? "正在重读" : "重读配置"}
      </button>
    </aside>
  );
}
