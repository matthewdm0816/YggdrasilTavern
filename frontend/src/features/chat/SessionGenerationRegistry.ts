export class SessionGenerationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  begin(sessionId: string): AbortController | null {
    if (this.controllers.has(sessionId)) return null;
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    return controller;
  }

  stop(sessionId: string): void {
    this.controllers.get(sessionId)?.abort();
  }

  finish(sessionId: string, controller: AbortController): void {
    if (this.controllers.get(sessionId) === controller) this.controllers.delete(sessionId);
  }

  abortAll(): void {
    this.controllers.forEach((controller) => controller.abort());
  }
}
