import type { Message } from "../../lib/api";
import type { TtsPreview, TtsSettings } from "./api";

export type TtsPlaybackState = {
  phase: "idle" | "loading" | "playing" | "blocked" | "error";
  messageId: string | null;
  queuedCount: number;
  error: string | null;
};
type AudioHandle = Pick<HTMLAudioElement, "src" | "play" | "pause" | "load" | "onended" | "onerror">;
type TtsJob = { message: Message; text?: string; automatic: boolean };
type TtsPlaybackDependencies = {
  preview: (messageId: string, signal: AbortSignal) => Promise<TtsPreview>;
  synthesize: (messageId: string, text: string | undefined, signal: AbortSignal) => Promise<Blob>;
  createAudio: () => AudioHandle;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};
export const idleTtsState: TtsPlaybackState = { phase: "idle", messageId: null, queuedCount: 0, error: null };

/** Owns the audio lifetime and queue. Only explicit completion events can enqueue automatic speech. */
export class TtsPlayback {
  private state: TtsPlaybackState = { ...idleTtsState };
  private sessionId: string | null = null;
  private accountId = "";
  private settings: TtsSettings | undefined;
  private settingsSignature = "";
  private epoch = 0;
  private controller: AbortController | null = null;
  private audio: AudioHandle | null = null;
  private audioUrl: string | null = null;
  private queue: TtsJob[] = [];
  private seen = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(private readonly dependencies: TtsPlaybackDependencies) {}
  getSnapshot = (): TtsPlaybackState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  configure(sessionId: string | null, settings: TtsSettings | undefined, accountId: string): void {
    const signature = JSON.stringify(settings) || "";
    if (this.sessionId === sessionId && this.settingsSignature === signature && this.accountId === accountId) return;
    if (this.accountId !== accountId) this.seen.clear();
    this.stop();
    this.sessionId = sessionId;
    this.settings = settings;
    this.settingsSignature = signature;
    this.accountId = accountId;
  }

  onGenerated(message: Message): void {
    if (!this.isPlayable(message)) return;
    const key = `${this.accountId}:${message.session_id}:${message.id}`;
    if (this.seen.has(key)) return;
    this.remember(key);
    if (!this.settings?.enabled || this.settings.trigger_mode !== "auto") return;
    this.queue.push({ message, automatic: true });
    this.publish({ queuedCount: this.queue.length });
    this.drain();
  }

  async play(message: Message, text?: string): Promise<void> {
    this.stop();
    if (!this.settings?.enabled) {
      this.publish({ phase: "error", messageId: message.id, error: "请先在 TTS 设置中启用语音播放。" });
      return;
    }
    if (!this.isPlayable(message)) {
      this.publish({ phase: "error", messageId: message.id, error: "只能播放当前会话中已生成完成的角色消息。" });
      return;
    }
    this.remember(`${this.accountId}:${message.session_id}:${message.id}`);
    await this.start({ message, text, automatic: false });
  }

  async resume(): Promise<void> {
    if (this.state.phase !== "blocked" || !this.audio) return;
    await this.attemptPlayback(this.epoch);
  }
  stop = (): void => {
    this.epoch += 1;
    this.queue = [];
    this.release();
    this.publish({ ...idleTtsState });
  };
  clearError = (): void => {
    if (this.state.phase === "error") this.publish({ ...idleTtsState });
    else this.publish({ error: null });
  };

  private isPlayable(message: Message): boolean {
    return Boolean(this.sessionId) && message.session_id === this.sessionId
      && message.role === "assistant" && message.status === "complete";
  }
  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
  }
  private publish(patch: Partial<TtsPlaybackState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private release(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio.load();
      this.audio = null;
    }
    if (this.audioUrl) this.dependencies.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
  }
  private current(epoch: number): boolean {
    return epoch === this.epoch;
  }
  private drain(): void {
    if (this.controller || this.audio) return;
    const job = this.queue.shift();
    if (job) void this.start(job);
  }
  private finish(epoch: number): void {
    if (!this.current(epoch)) return;
    this.epoch += 1;
    this.release();
    this.publish({ ...idleTtsState, queuedCount: this.queue.length });
    this.drain();
  }
  private fail(epoch: number, cause: unknown): void {
    if (!this.current(epoch)) return;
    this.epoch += 1;
    this.queue = [];
    this.release();
    this.publish({ phase: "error", queuedCount: 0, error: cause instanceof Error ? cause.message : String(cause) });
  }
  private async start(job: TtsJob): Promise<void> {
    const epoch = ++this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ phase: "loading", messageId: job.message.id, queuedCount: this.queue.length, error: null });
    try {
      let text = job.text;
      if (job.automatic) {
        const preview = await this.dependencies.preview(job.message.id, controller.signal);
        if (!this.current(epoch)) return;
        if (!preview.text.trim()) {
          this.finish(epoch);
          return;
        }
        text = preview.text;
      }
      const blob = await this.dependencies.synthesize(job.message.id, text, controller.signal);
      if (!this.current(epoch)) return;
      this.audioUrl = this.dependencies.createObjectURL(blob);
      this.audio = this.dependencies.createAudio();
      this.audio.src = this.audioUrl;
      this.audio.onended = () => { this.finish(epoch); };
      this.audio.onerror = () => { this.fail(epoch, new Error("音频播放失败，请检查浏览器是否支持接口返回的音频。")); };
      await this.attemptPlayback(epoch);
    } catch (cause) {
      this.fail(epoch, cause);
    }
  }
  private async attemptPlayback(epoch: number): Promise<void> {
    const audio = this.audio;
    if (!audio || !this.current(epoch)) return;
    try {
      await audio.play();
      if (this.current(epoch)) this.publish({ phase: "playing", error: null });
    } catch (cause) {
      if (!this.current(epoch)) return;
      if (cause instanceof Error && cause.name === "NotAllowedError") {
        this.publish({ phase: "blocked", error: "浏览器暂停了自动播放。请点击“播放已生成音频”，不会再次请求 TTS 接口。" });
      } else {
        this.fail(epoch, cause);
      }
    }
  }
}
