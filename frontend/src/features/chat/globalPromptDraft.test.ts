import { describe, expect, it } from "vitest";
import type { PromptSlot } from "../../lib/api";
import { reconcileSavedPromptSlots, samePromptSlots } from "./globalPromptDraft";

function slots(content: string): PromptSlot[] {
  return [{ id: "custom", kind: "custom", name: "Custom", enabled: true, role: "system", content }];
}

describe("global prompt save snapshots", () => {
  it("uses normalized server values when the form still matches the submission", () => {
    const submitted = slots("submitted");
    const saved = slots("normalized");
    expect(reconcileSavedPromptSlots(slots("submitted"), submitted, saved)).toBe(saved);
  });

  it("keeps changes made while saving and leaves them dirty against saved data", () => {
    const submitted = slots("submitted");
    const current = slots("new edit");
    const result = reconcileSavedPromptSlots(current, submitted, submitted);
    expect(result).toBe(current);
    expect(samePromptSlots(result, submitted)).toBe(false);
  });
});
