import { userStorageKey } from "../../lib/userStorage";

const storageKey = "yggdrasil-tavern.generation-limit";
export const DEFAULT_GENERATION_LIMIT = 4;
export const GENERATION_LIMIT_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

/** How many replies this browser page may generate at once, across all sessions. */
export function loadGenerationLimit(): number {
  try {
    const stored = window.localStorage.getItem(userStorageKey(storageKey));
    if (stored === null) return DEFAULT_GENERATION_LIMIT;
    const value = Number(stored);
    if (GENERATION_LIMIT_OPTIONS.includes(value)) return value;
    console.error("保存的同时生成上限无效，使用默认值。", stored);
  } catch (cause) {
    console.error("无法读取同时生成上限，使用默认值。", cause);
  }
  return DEFAULT_GENERATION_LIMIT;
}

export function saveGenerationLimit(limit: number): void {
  window.localStorage.setItem(userStorageKey(storageKey), String(limit));
}
