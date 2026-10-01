import { describe, expect, it } from "vitest";
import { SessionTree } from "../../lib/api";
import {
  markSettingsSaved,
  reconcileSettingsDrafts,
  resetSettingsDraft,
  settingsConflict,
  settingsDirty,
  updateSettingsDraft,
  type SessionSettingsDrafts
} from "./sessionSettingsDraft";

function tree(sessionId: string, worldbookIds: string[]): SessionTree {
  return {
    session: { id: sessionId, title: sessionId, preset: { worldbook_ids: worldbookIds } },
    messages: [],
    active_path_ids: []
  };
}

describe("session settings drafts", () => {
  it("updates a clean form when the same session receives new server settings", () => {
    const original = reconcileSettingsDrafts({}, tree("one", ["a"]));
    const updated = reconcileSettingsDrafts(original, tree("one", ["b"]));
    expect(updated.one.value.worldbookIds).toEqual(["b"]);
    expect(settingsDirty(updated.one)).toBe(false);
    expect(settingsConflict(updated.one)).toBe(false);
    expect(reconcileSettingsDrafts(updated, tree("one", ["b"]))).toBe(updated);
  });

  it("preserves unsaved edits across sessions and shows a conflict only when server settings change", () => {
    let drafts: SessionSettingsDrafts = reconcileSettingsDrafts({}, tree("one", ["a"]));
    drafts = updateSettingsDraft(drafts, tree("one", ["a"]), (value) => ({ ...value, worldbookIds: ["local"] }));
    drafts = reconcileSettingsDrafts(drafts, tree("two", ["other"]));
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["a"]));
    expect(drafts.one.value.worldbookIds).toEqual(["local"]);
    expect(settingsConflict(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["remote"]));
    expect(drafts.one.value.worldbookIds).toEqual(["local"]);
    expect(drafts.two.value.worldbookIds).toEqual(["other"]);
    expect(settingsConflict(drafts.one)).toBe(true);
    drafts = resetSettingsDraft(drafts, "one");
    expect(drafts.one.value.worldbookIds).toEqual(["remote"]);
    expect(settingsDirty(drafts.one)).toBe(false);
  });

  it("marks a successful save as the new baseline before a refreshed server tree arrives", () => {
    let drafts = reconcileSettingsDrafts({}, tree("one", ["a"]));
    drafts = updateSettingsDraft(drafts, tree("one", ["a"]), (value) => ({ ...value, worldbookIds: ["saved"] }));
    drafts = markSettingsSaved(drafts, "one");
    expect(settingsDirty(drafts.one)).toBe(false);
    drafts = reconcileSettingsDrafts(drafts, tree("one", ["saved"]));
    expect(settingsConflict(drafts.one)).toBe(false);
  });
});
