import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Message } from "../../lib/api";
import { AUTH_REQUIRED_EVENT } from "../../lib/api/http";
import { accountHeaders } from "../../lib/userStorage";
import { ttsApi, ttsSettingsQueryKey } from "./api";
import { idleTtsState, TtsPlayback } from "./TtsPlayback";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useTtsPlayback(selectedSessionId: string | null) {
  const settingsQuery = useQuery({
    queryKey: ttsSettingsQueryKey,
    queryFn: ({ signal }) => ttsApi.settings(signal),
    retry: 1
  });
  const runtimeRef = useRef<TtsPlayback | null>(null);
  if (!runtimeRef.current) runtimeRef.current = new TtsPlayback({
    preview: ttsApi.preview,
    synthesize: ttsApi.synthesize,
    createAudio: () => new Audio(),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url)
  });
  const runtime = runtimeRef.current;
  const mountedRef = useRef(true);
  const contextRef = useRef({ selectedSessionId, settings: settingsQuery.data });
  contextRef.current = { selectedSessionId, settings: settingsQuery.data };
  const syncContext = useCallback(() => {
    const context = contextRef.current;
    runtime.configure(context.selectedSessionId, context.settings, accountHeaders()["X-Yggdrasil-User"] || "local");
  }, [runtime]);
  useBrowserLayoutEffect(syncContext, [syncContext, selectedSessionId, settingsQuery.data]);
  useBrowserLayoutEffect(() => {
    mountedRef.current = true;
    window.addEventListener(AUTH_REQUIRED_EVENT, runtime.stop);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(AUTH_REQUIRED_EVENT, runtime.stop);
      runtime.stop();
    };
  }, [runtime]);
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, () => idleTtsState);
  const onGenerated = useCallback((message: Message) => {
    if (!mountedRef.current) return;
    syncContext();
    runtime.onGenerated(message);
  }, [runtime, syncContext]);
  const play = useCallback((message: Message, text?: string) => {
    if (!mountedRef.current) return Promise.resolve();
    syncContext();
    return runtime.play(message, text);
  }, [runtime, syncContext]);
  const resume = useCallback(() => {
    if (!mountedRef.current) return Promise.resolve();
    syncContext();
    return runtime.resume();
  }, [runtime, syncContext]);
  return { settingsQuery, onGenerated, play, stop: runtime.stop, resume, state, error: state.error, clearError: runtime.clearError };
}
