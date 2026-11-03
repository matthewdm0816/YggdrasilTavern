export type ActiveGeneration = {
  key: string;
  sessionId: string;
  /** The message the new reply continues from; null for a reply at the root. */
  parentId: string | null;
  /** Set once the server has created the streaming reply. */
  messageId: string | null;
  /** The server run to resume or stop; set together with messageId. */
  runId: string | null;
  /** Short excerpt of the parent message for the status list. */
  label: string;
};

type Entry = {
  info: ActiveGeneration;
  /** The current HTTP stream; each reconnect replaces it. */
  connection: AbortController | null;
  stopRequested: boolean;
  /** The page stopped following this reply; the server keeps generating it. */
  closed: boolean;
};

/** Every reply this page follows, so several branches and sessions can stream at once. */
export class GenerationRegistry {
  private readonly entries = new Map<string, Entry>();
  private nextKey = 0;

  get size(): number {
    return this.entries.size;
  }

  isActive(sessionId: string): boolean {
    return this.list().some((info) => info.sessionId === sessionId);
  }

  begin(info: Omit<ActiveGeneration, "key" | "messageId" | "runId">): string {
    this.nextKey += 1;
    const key = "generation-" + this.nextKey;
    this.entries.set(key, { info: { ...info, key, messageId: null, runId: null }, connection: null, stopRequested: false, closed: false });
    return key;
  }

  /** Record the server's reply and run; true when a stop was requested before they were known. */
  attach(key: string, messageId: string, runId: string | null): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    entry.info = { ...entry.info, messageId, runId };
    return entry.stopRequested;
  }

  /** A signal for one HTTP stream of this reply, aborted by reconnectAll or abortAll. */
  connect(key: string): AbortSignal {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("没有找到要连接的生成：" + key);
    entry.connection = new AbortController();
    if (entry.closed) entry.connection.abort();
    return entry.connection.signal;
  }

  /** Mark the reply as stopping; returns its run when the server can be asked now. */
  requestStop(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.stopRequested = true;
    return entry.info.runId;
  }

  info(key: string): ActiveGeneration | undefined {
    return this.entries.get(key)?.info;
  }

  stopRequested(key: string): boolean {
    return Boolean(this.entries.get(key)?.stopRequested);
  }

  isClosed(key: string): boolean {
    return Boolean(this.entries.get(key)?.closed);
  }

  hasRun(runId: string): boolean {
    return this.list().some((info) => info.runId === runId);
  }

  /** True while a local start has not yet learned its server run. */
  hasPendingStart(): boolean {
    return this.list().some((info) => info.runId === null);
  }

  finish(key: string): void {
    this.entries.delete(key);
  }

  list(): ActiveGeneration[] {
    return Array.from(this.entries.values(), (entry) => entry.info);
  }

  /** Drop every current stream so each reply reconnects and catches up. */
  reconnectAll(): void {
    this.entries.forEach((entry) => entry.connection?.abort());
  }

  /** Stop following every reply without stopping its generation on the server. */
  abortAll(): void {
    this.entries.forEach((entry) => {
      entry.closed = true;
      entry.connection?.abort();
    });
  }
}

export function generationExcerpt(text: string | null | undefined): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  return flat.length > 24 ? flat.slice(0, 24) + "…" : flat;
}
