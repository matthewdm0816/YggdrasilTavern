export type SseEvent = { event: string; data: unknown };

/** Incrementally reads the event/data lines emitted by the generation endpoint. */
export class SseParser {
  private line = "";
  private skipLineFeed = false;
  private eventName: string | null = null;
  private dataLines: string[] = [];

  constructor(private readonly onEvent: (event: SseEvent) => void) {}

  push(chunk: string): void {
    for (const character of chunk) {
      if (this.skipLineFeed) {
        this.skipLineFeed = false;
        if (character === "\n") continue;
      }
      if (character === "\r") {
        this.acceptLine();
        this.skipLineFeed = true;
      } else if (character === "\n") {
        this.acceptLine();
      } else {
        this.line += character;
      }
    }
  }

  finish(): void {
    if (this.line) this.acceptLine();
    this.dispatch();
  }

  private acceptLine(): void {
    const line = this.line;
    this.line = "";
    if (!line) {
      this.dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const rawValue = colon < 0 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") this.eventName = value;
    if (field === "data") this.dataLines.push(value);
  }

  private dispatch(): void {
    if (this.eventName === null && this.dataLines.length === 0) return;
    const event = this.eventName;
    const dataText = this.dataLines.join("\n");
    this.eventName = null;
    this.dataLines = [];
    if (!event) throw new Error("生成流缺少事件名称。");
    if (!dataText) throw new Error("生成流事件 " + event + " 缺少 JSON 数据。");
    let data: unknown;
    try {
      data = JSON.parse(dataText);
    } catch (cause) {
      throw new Error("生成流事件 " + event + " 的 JSON 数据无效。" + (cause instanceof Error ? " " + cause.message : ""));
    }
    this.onEvent({ event, data });
  }
}
