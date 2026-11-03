import { GenerationStreamDropped } from "../../lib/api";

/** Consecutive failed reconnects before the page gives up and shows an error. */
export const MAX_RECONNECT_FAILURES = 8;
/** A phone can kill a stream silently while the page is hidden; reconnect after this long away. */
export const RECONNECT_AFTER_HIDDEN_MS = 5000;

/** The first retry is immediate; later ones back off up to ten seconds. */
export function reconnectDelay(failures: number): number {
  return failures <= 1 ? 0 : Math.min(1000 * 2 ** (failures - 2), 10_000);
}

/** How a lost connection surfaces: a stream that ended early, a fetch network failure, or our own reconnect abort. */
export function isConnectionLoss(cause: unknown): boolean {
  return cause instanceof GenerationStreamDropped
    || cause instanceof TypeError
    || (cause instanceof DOMException && cause.name === "AbortError");
}

/** Wait the delay, then until the page is visible and online; hidden phones throttle the network anyway. */
export async function waitUntilReachable(delayMs: number): Promise<void> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (typeof document === "undefined") return;
  while (document.visibilityState !== "visible" || !navigator.onLine) {
    await new Promise<void>((resolve) => {
      const done = () => {
        document.removeEventListener("visibilitychange", done);
        window.removeEventListener("online", done);
        resolve();
      };
      document.addEventListener("visibilitychange", done);
      window.addEventListener("online", done);
    });
  }
}
