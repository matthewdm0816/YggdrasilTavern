import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ChatSession, type SessionTree } from "../lib/api";
import { containsMacros, type MacroContext } from "../lib/macros";

export const MessageMacroContext = createContext<MacroContext | undefined>(undefined);
export const useMessageMacroContext = () => useContext(MessageMacroContext);

export function MessageMacroProvider({ session, tree, children }: { session?: ChatSession; tree?: SessionTree; children: ReactNode }) {
  const needed = useMemo(() => tree?.messages.some((message) => containsMacros(message.content) || containsMacros(message.thinking_content)) ?? false, [tree?.messages]);
  const characterId = session?.character_id;
  const character = useQuery({
    queryKey: ["character", characterId], queryFn: () => api.character(characterId!),
    enabled: Boolean(characterId && needed), staleTime: Infinity, refetchOnWindowFocus: false, retry: false,
  });
  // Match Python's str(preset.get("user_name") or "User") for valid stored names.
  const userName = String(session?.preset?.user_name || "User");
  const value = useMemo<MacroContext>(() => ({
    character: character.data ?? null, user_name: userName, original: "",
    ready: !characterId || !needed || character.isSuccess,
  }), [character.data, character.isSuccess, characterId, needed, userName]);
  return <MessageMacroContext.Provider value={value}>
    {children}
    {needed && character.isError && <div className="toast" role="alert">
      <span>角色资料读取失败，宏暂时显示原文：{character.error instanceof Error ? character.error.message : String(character.error)}</span>
      <button type="button" className="secondary-button" onClick={() => void character.refetch()}>重试</button>
    </div>}
  </MessageMacroContext.Provider>;
}
