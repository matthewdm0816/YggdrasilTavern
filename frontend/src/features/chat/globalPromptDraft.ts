import type { PromptSlot } from "../../lib/api";

export function samePromptSlots(left: PromptSlot[], right: PromptSlot[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A successful request only replaces the form if no newer edits were made. */
export function reconcileSavedPromptSlots(
  current: PromptSlot[], submitted: PromptSlot[], saved: PromptSlot[]
): PromptSlot[] {
  return samePromptSlots(current, submitted) ? saved : current;
}
