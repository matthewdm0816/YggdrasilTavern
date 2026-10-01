export class SessionTreeEpoch {
  private readonly revisions = new Map<string, number>();

  capture(sessionId: string): number {
    return this.revisions.get(sessionId) || 0;
  }

  advance(sessionId: string): void {
    this.revisions.set(sessionId, this.capture(sessionId) + 1);
  }

  isCurrent(sessionId: string, revision: number): boolean {
    return this.capture(sessionId) === revision;
  }
}
