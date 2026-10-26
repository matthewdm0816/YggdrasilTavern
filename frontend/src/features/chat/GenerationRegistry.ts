export type ActiveGeneration = {
  key: string;
  sessionId: string;
  /** The message the new reply continues from; null for a reply at the root. */
  parentId: string | null;
  /** Set once the server has created the streaming reply. */
  messageId: string | null;
  /** Short excerpt of the parent message for the status list. */
  label: string;
};

/** Every in-flight generation, so several branches and sessions can stream at once. */
export class GenerationRegistry {
  private readonly entries = new Map<string, { info: ActiveGeneration; controller: AbortController }>();
  private nextKey = 0;

  get size(): number {
    return this.entries.size;
  }

  isActive(sessionId: string): boolean {
    return this.list().some((info) => info.sessionId === sessionId);
  }

  begin(info: Omit<ActiveGeneration, "key" | "messageId">): { key: string; controller: AbortController } {
    this.nextKey += 1;
    const key = "generation-" + this.nextKey;
    const controller = new AbortController();
    this.entries.set(key, { info: { ...info, key, messageId: null }, controller });
    return { key, controller };
  }

  attach(key: string, messageId: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.info = { ...entry.info, messageId };
  }

  stop(key: string): void {
    this.entries.get(key)?.controller.abort();
  }

  finish(key: string): void {
    this.entries.delete(key);
  }

  list(): ActiveGeneration[] {
    return Array.from(this.entries.values(), (entry) => entry.info);
  }

  abortAll(): void {
    this.entries.forEach((entry) => entry.controller.abort());
  }
}

export function generationExcerpt(text: string | null | undefined): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  return flat.length > 24 ? flat.slice(0, 24) + "…" : flat;
}
