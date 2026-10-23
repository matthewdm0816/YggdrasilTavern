import { useEffect, useState } from "react";
import { userStorageKey } from "../../lib/userStorage";

export type MacroDisplayMode = "expanded" | "hover";
const key = "yggdrasil-tavern.macro-display";
const changeEvent = "yggdrasil-macro-display-change";
type State = { mode: MacroDisplayMode; error: string | null };

function read(): State {
  if (typeof window === "undefined") return { mode: "expanded", error: null };
  try {
    const value = window.localStorage.getItem(userStorageKey(key));
    if (value === null || value === "expanded" || value === "hover") return { mode: value ?? "expanded", error: null };
    throw new Error("保存的宏显示方式无效：" + value);
  } catch (cause) {
    const error = "宏显示设置读取失败，当前显示替换后文字：" + (cause instanceof Error ? cause.message : String(cause));
    console.error(error, cause);
    return { mode: "expanded", error };
  }
}

export function useMacroDisplayMode() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    window.addEventListener(changeEvent, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(changeEvent, update); window.removeEventListener("storage", update); };
  }, []);
  function setMode(mode: MacroDisplayMode) {
    try {
      window.localStorage.setItem(userStorageKey(key), mode);
      window.dispatchEvent(new Event(changeEvent));
    } catch (cause) {
      const error = "宏显示方式保存失败：" + (cause instanceof Error ? cause.message : String(cause));
      console.error(error, cause);
      setState((current) => ({ ...current, error }));
    }
  }
  return { ...state, setMode };
}
