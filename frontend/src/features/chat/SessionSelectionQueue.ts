import { SessionTree } from "../../lib/api";

export class SessionSelectionQueue {
  private readonly revisions = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();

  async run(sessionId: string, request: () => Promise<SessionTree>, apply: (tree: SessionTree) => void, applyIntermediate = false): Promise<void> {
    const revision = (this.revisions.get(sessionId) || 0) + 1;
    this.revisions.set(sessionId, revision);
    const previous = this.queues.get(sessionId) || Promise.resolve();
    const pending = previous.then(request);
    const tail = pending.then(() => undefined, () => undefined);
    this.queues.set(sessionId, tail);
    let next: SessionTree;
    try {
      next = await pending;
    } finally {
      if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId);
    }
    // Persisted changes must reach the cache even if a later queued choice fails.
    if ((applyIntermediate || revision === this.revisions.get(sessionId)) && next.session.id === sessionId) apply(next);
  }
}
