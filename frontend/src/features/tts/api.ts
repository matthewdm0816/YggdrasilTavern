import type { components } from "../../lib/api/generated";
import { API_BASE, notifyAuthenticationRequired, request, responseError } from "../../lib/api/http";
import { accountHeaders } from "../../lib/userStorage";

type Schemas = components["schemas"];
export type TtsSettings = Schemas["TtsSettingsOut"];
export type TtsSettingsUpdate = Omit<Schemas["TtsSettingsUpdate"], "clear_api_key">
  & Partial<Pick<Schemas["TtsSettingsUpdate"], "clear_api_key">>;
export type TtsPreview = Schemas["TtsPreviewOut"];
export type TtsVoice = Schemas["TtsVoiceOut"];
export const ttsSettingsQueryKey = ["tts-settings"] as const;

export const ttsApi = {
  settings: (signal?: AbortSignal) => request<TtsSettings>("/api/settings/tts", { signal }),
  saveSettings: (input: TtsSettingsUpdate, signal?: AbortSignal) => request<TtsSettings>("/api/settings/tts", {
    method: "PUT", body: JSON.stringify(input), signal
  }),
  voices: (signal?: AbortSignal) => request<{ voices: TtsVoice[] }>("/api/tts/voices", { method: "POST", signal }),
  preview: (messageId: string, signal?: AbortSignal, mode?: TtsSettings["text_mode"]) => request<TtsPreview>(
    `/api/messages/${encodeURIComponent(messageId)}/tts/preview`,
    { method: "POST", body: JSON.stringify(mode ? { mode } : {}), signal }
  ),
  async synthesize(messageId: string, text?: string, signal?: AbortSignal): Promise<Blob> {
    const path = `/api/messages/${encodeURIComponent(messageId)}/tts`;
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST", credentials: "include", signal,
      headers: { "Content-Type": "application/json", ...accountHeaders() },
      body: JSON.stringify(text === undefined ? {} : { text })
    });
    if (!response.ok) {
      notifyAuthenticationRequired(path, response);
      throw new Error(await responseError(response));
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("audio/")) {
      throw new Error(`TTS 接口返回了 ${contentType || "未知格式"}，没有返回可播放的音频。`);
    }
    const audio = await response.blob();
    if (!audio.size) throw new Error("TTS 接口返回了空音频，请检查语音模型配置。");
    return audio;
  }
};
